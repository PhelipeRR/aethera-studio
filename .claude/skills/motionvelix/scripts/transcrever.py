#!/usr/bin/env python3
"""Transcreve a fala com tempo POR PALAVRA → JSON pronto para os templates de legenda.

  python3 transcrever.py video.mp4 palavras.json [--modelo small] [--idioma pt] [--inicio 0 --dur 60]
  python3 transcrever.py --srt legenda.srt palavras.json

Saída: {"words":[{"w":"Esse","s":0.10,"e":0.32}, ...], "text":"..."}

Motores (escolha automática, --motor para forçar):
  1. faster-whisper: tempo por palavra nativo. Usado primeiro só se o modelo
     já estiver em cache (o download vem do HuggingFace, bloqueado em vários ambientes).
  2. sherpa-onnx: whisper em ONNX baixado do GitHub. Funciona onde o
     HuggingFace é bloqueado (ex.: Cowork). Tempo por palavra = VAD + ilhas
     de energia da voz.
  3. --srt: converte uma legenda existente (CapCut/Premiere/YouTube).
"""
import argparse, json, os, re, subprocess, sys, tarfile, urllib.request

CACHE = os.path.expanduser(os.environ.get('MV_MODELOS', '~/.cache/motionvelix/modelos'))
GH = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/'
SR = 16000


# ---------- SRT ----------
def from_srt(path):
    txt = open(path, encoding='utf-8-sig').read()
    words = []
    for blk in re.split(r'\n\s*\n', txt.strip()):
        m = re.search(r'(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)', blk)
        if not m:
            continue
        g = list(map(int, m.groups()))
        s = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        e = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        body = ' '.join(blk.split('\n')[2:]).strip()
        words += espalhar(body.split(), [(s, e)])
    return words


def espalhar(ws, ilhas):
    """Distribui palavras pelas ilhas de voz, proporcional ao tamanho de cada palavra."""
    if not ws or not ilhas:
        return []
    total_t = sum(b - a for a, b in ilhas)
    pesos = [len(w) + 2 for w in ws]
    tot = sum(pesos)
    out, acc = [], 0.0
    def pos(x):  # x em segundos de "voz" → tempo real
        for a, b in ilhas:
            if x <= b - a:
                return a + x
            x -= b - a
        return ilhas[-1][1]
    for w, p in zip(ws, pesos):
        d = total_t * p / tot
        s, e = pos(acc + 0.001), pos(acc + d)
        out.append(dict(w=w, s=round(s, 3), e=round(max(e, s + 0.06), 3)))
        acc += d
    return out


# ---------- áudio ----------
def ler_pcm(inp, inicio=0.0, dur=None):
    import numpy as np
    cmd = ['ffmpeg', '-v', 'error', '-ss', str(inicio)] + (['-t', str(dur)] if dur else []) + \
          ['-i', inp, '-f', 's16le', '-ac', '1', '-ar', str(SR), '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768


def ilhas_de_voz(x, t0):
    """Ilhas de energia (pausas > 90 ms separam) dentro de um trecho de VAD."""
    import numpy as np
    hop = int(SR * 0.02)
    n = max(1, len(x) // hop)
    rms = np.array([np.sqrt(np.mean(x[i * hop:(i + 1) * hop] ** 2) + 1e-12) for i in range(n)])
    lim = max(np.percentile(rms, 30) * 1.8, rms.max() * 0.08)
    on = rms > lim
    ilhas, i = [], 0
    while i < n:
        if on[i]:
            j = i
            while j < n and (on[j] or (j + 4 < n and on[j:j + 5].any())):
                j += 1
            ilhas.append((t0 + i * 0.02, t0 + j * 0.02))
            i = j
        else:
            i += 1
    ilhas = [(a, b) for a, b in ilhas if b - a >= 0.06]
    return ilhas or [(t0, t0 + len(x) / SR)]


# ---------- sherpa-onnx ----------
def baixar(nome, destino):
    os.makedirs(CACHE, exist_ok=True)
    if os.path.exists(destino):
        return
    url = GH + nome
    tmp = os.path.join(CACHE, nome + '.part')
    print(f'⤓ baixando {nome} (1ª vez, fica em cache)…', flush=True)
    urllib.request.urlretrieve(url, tmp)
    if nome.endswith('.tar.bz2'):
        with tarfile.open(tmp) as t:
            try:
                t.extractall(CACHE, filter='data')
            except TypeError:
                t.extractall(CACHE)
        os.remove(tmp)
    else:
        os.rename(tmp, destino)


def preparar_sherpa(modelo):
    pasta = os.path.join(CACHE, f'sherpa-onnx-whisper-{modelo}')
    baixar(f'sherpa-onnx-whisper-{modelo}.tar.bz2', pasta)
    vad = os.path.join(CACHE, 'silero_vad.onnx')
    baixar('silero_vad.onnx', vad)
    return pasta, vad


def sherpa(inp, modelo, idioma, inicio, dur):
    import sherpa_onnx
    pasta, vadm = preparar_sherpa(modelo)
    rec = sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=f'{pasta}/{modelo}-encoder.int8.onnx', decoder=f'{pasta}/{modelo}-decoder.int8.onnx',
        tokens=f'{pasta}/{modelo}-tokens.txt', language=idioma, task='transcribe',
        num_threads=max(1, (os.cpu_count() or 2) - 1))
    cfg = sherpa_onnx.VadModelConfig()
    cfg.silero_vad.model = vadm
    cfg.silero_vad.min_silence_duration = 0.18
    cfg.silero_vad.min_speech_duration = 0.25
    cfg.silero_vad.max_speech_duration = 5
    cfg.sample_rate = SR
    vad = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=120)
    x = ler_pcm(inp, inicio, dur)
    words = []

    def esvaziar():
        while not vad.empty():
            seg = vad.front
            st = rec.create_stream()
            st.accept_waveform(SR, seg.samples)
            rec.decode_stream(st)
            txt = st.result.text.strip()
            if txt:
                import numpy as np
                a = inicio + seg.start / SR
                words.extend(espalhar(txt.split(), ilhas_de_voz(np.array(seg.samples, dtype='float32'), a)))
            vad.pop()

    for i in range(0, len(x), 512):
        vad.accept_waveform(x[i:i + 512])
        esvaziar()
    vad.flush()
    esvaziar()
    return words


# ---------- faster-whisper ----------
def faster_em_cache(modelo):
    hub = os.path.expanduser(os.environ.get('HF_HUB_CACHE', '~/.cache/huggingface/hub'))
    import glob
    return bool(glob.glob(os.path.join(hub, f'models--Systran--faster-whisper-{modelo}', 'snapshots', '*', 'model.bin')))


def faster(inp, modelo, idioma, inicio, dur):
    from faster_whisper import WhisperModel
    m = WhisperModel(modelo, device='auto', compute_type='int8')
    src = inp
    if inicio or dur:
        src = '/tmp/_mv_trecho.wav'
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', str(inicio)] + (['-t', str(dur)] if dur else []) +
                       ['-i', inp, '-ac', '1', '-ar', str(SR), src], check=True)
    segs, _ = m.transcribe(src, language=idioma, word_timestamps=True, vad_filter=True)
    return [dict(w=w.word.strip(), s=round(inicio + w.start, 3), e=round(inicio + w.end, 3))
            for sg in segs for w in (sg.words or [])]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('inp', nargs='?')
    p.add_argument('out')
    p.add_argument('--modelo', default='small', help='tiny | base | small (padrão) | medium')
    p.add_argument('--idioma', default='pt')
    p.add_argument('--motor', choices=['auto', 'faster', 'sherpa'], default='auto')
    p.add_argument('--inicio', type=float, default=0.0)
    p.add_argument('--dur', type=float)
    p.add_argument('--srt')
    a = p.parse_args()
    if a.srt:
        words, motor = from_srt(a.srt), 'srt'
    else:
        words, motor, erros = None, None, []
        ordem = (['faster', 'sherpa'] if faster_em_cache(a.modelo) else ['sherpa', 'faster']) \
            if a.motor == 'auto' else [a.motor]
        for mot in ordem:
            try:
                words = (faster if mot == 'faster' else sherpa)(a.inp, a.modelo, a.idioma, a.inicio, a.dur)
                motor = mot
                break
            except Exception as e:  # sem pacote, HuggingFace bloqueado, etc.
                erros.append(f'{mot}: {str(e).splitlines()[0][:160] if str(e) else type(e).__name__}')
                print(f'⚠ {erros[-1]} → tentando o próximo motor', file=sys.stderr)
        if words is None:
            sys.exit('✘ nenhum motor funcionou:\n  ' + '\n  '.join(erros) +
                     '\n  instale: pip install sherpa-onnx   (ou use --srt arquivo.srt)')
    json.dump(dict(words=words, text=' '.join(w['w'] for w in words)),
              open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(f'✔ {len(words)} palavras → {a.out}  (motor: {motor})')


if __name__ == '__main__':
    main()
