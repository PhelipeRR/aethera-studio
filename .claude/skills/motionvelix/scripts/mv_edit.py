#!/usr/bin/env python3
"""MotionVelix EDIT — receitas de edição profissional com FFmpeg (sem programa de edição).

Uso:  python3 mv_edit.py <comando> [args]   (python3 mv_edit.py <comando> -h para detalhes)

  info        IN                         mostra resolução, fps, duração, áudio
  silencio    IN OUT                     remove pausas/respiros (jump cut automático)
  vertical    IN OUT                     converte qualquer vídeo para 1080x1920 (crop ou fundo desfocado)
  zoom        IN OUT --em 2.1,5.4:6.2    punch-ins (zoom no rosto) nos tempos de ênfase
  compor      BASE OVERLAY.mov OUT       aplica overlay com transparência (legendas/títulos do MotionVelix)
  split       CIMA BAIXO OUT             tela dividida (B-roll em cima, rosto embaixo) — estilo V04
  comparar    A B OUT                    dois vídeos empilhados para "qual o melhor?" — estilo V14
  antesdepois ANTES DEPOIS OUT           layout antes/depois — estilo V15
  musica      VIDEO TRILHA OUT           mistura trilha com ducking automático sob a voz
  grade       IN OUT --look cinema       color grade (quente, frio, cinema, teal-orange, vibrante, matte, pb, neon)
  qc          IN                         controle de qualidade automático (gancho, telas paradas, LUFS, pico…)
  exportar    IN OUT                     export final p/ Reels/TikTok (-14 LUFS, H.264, 1080x1920, faststart)
  batidas     AUDIO                      lista os tempos das batidas (para cortar/animar no ritmo)
  analisar    VIDEO PASTA                folha de contato + cortes + BPM (estudar referências)
"""
import argparse, json, os, re, subprocess, sys, tempfile, shutil


def _find_ff():
    f = shutil.which('ffmpeg')
    if f:
        return f
    try:
        c = json.load(open(os.path.join(os.path.expanduser('~'), '.motionvelix', 'config.json')))
        if c.get('ffmpeg') and os.path.exists(c['ffmpeg']):
            return c['ffmpeg']
    except Exception:
        pass
    return 'ffmpeg'

FF = _find_ff()
FP = shutil.which('ffprobe')
ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']


def run(cmd, quiet=False):
    if not quiet:
        print('»', ' '.join(str(c)[:60] for c in cmd[:6]), '…')
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
    if r.returncode:
        sys.stderr.write(r.stderr[-3000:])
        sys.exit(f'ffmpeg falhou ({r.returncode})')
    return r


def probe(path):
    if not FP:   # sem ffprobe (ex.: ffmpeg do imageio): lê o cabeçalho pelo próprio ffmpeg
        e = subprocess.run([FF, '-hide_banner', '-i', path], capture_output=True, text=True).stderr
        m = re.search(r'Video:.*?(\d{2,5})x(\d{2,5})', e); f = re.search(r'([\d.]+) fps', e); d = re.search(r'Duration: (\d+):(\d+):([\d.]+)', e)
        dur = int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3)) if d else 0
        return dict(w=int(m.group(1)) if m else 0, h=int(m.group(2)) if m else 0, fps=float(f.group(1)) if f else 30, dur=dur, audio='Audio:' in e)
    r = run([FP, '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], quiet=True)
    j = json.loads(r.stdout)
    v = next((s for s in j['streams'] if s['codec_type'] == 'video'), {})
    a = next((s for s in j['streams'] if s['codec_type'] == 'audio'), None)
    num, den = (v.get('r_frame_rate', '30/1').split('/') + ['1'])[:2]
    rot = 0
    for sd in v.get('side_data_list', []) or []:
        rot = int(sd.get('rotation', 0) or 0)
    w, h = v.get('width', 0), v.get('height', 0)
    if abs(rot) == 90:
        w, h = h, w
    return dict(w=w, h=h, fps=round(int(num) / max(1, int(den)), 3), dur=float(j['format'].get('duration', 0)), audio=a is not None)


# ---------------------------------------------------------------- comandos
def c_info(a):
    print(json.dumps(probe(a.inp), indent=1))


def c_silencio(a):
    """Detecta silêncios e mantém só a fala, com 'respiro' (pad) nas bordas."""
    info = probe(a.inp)
    r = run([FF, '-hide_banner', '-i', a.inp, '-af', f'silencedetect=noise={a.db}dB:d={a.min}', '-f', 'null', '-'], quiet=True)
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', r.stderr)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', r.stderr)]
    sil = list(zip(starts, ends + [info['dur']] * (len(starts) - len(ends))))
    keep, cur = [], 0.0
    for s, e in sil:
        s2, e2 = s + a.pad, e - a.pad
        if s2 > cur:
            keep.append((cur, s2))
        cur = max(cur, e2)
    if cur < info['dur']:
        keep.append((cur, info['dur']))
    keep = [(s, e) for s, e in keep if e - s > 0.12]
    removed = info['dur'] - sum(e - s for s, e in keep)
    print(f'  {len(keep)} trechos de fala — removendo {removed:.1f}s de pausas ({removed / max(info["dur"], .01) * 100:.0f}%)')
    # passo único com select/aselect: pouca memória mesmo em vídeos longos/4K (trim+concat estoura a RAM)
    expr = '+'.join(f'between(t,{s:.3f},{e:.3f})' for s, e in keep)
    fc = (f"[0:v]select='{expr}',setpts=N/FRAME_RATE/TB[v];"
          f"[0:a]aselect='{expr}',asetpts=N/SR/TB[a]")
    with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False) as f:
        f.write(fc)
    run([FF, '-y', '-i', a.inp, '-filter_complex_script', f.name, '-map', '[v]', '-map', '[a]', *ENC, a.out])
    json.dump(keep, open(os.path.splitext(a.out)[0] + '.cortes.json', 'w'))
    print('✔', a.out, '(+ .cortes.json com os trechos mantidos)')


def c_vertical(a):
    i = probe(a.inp)
    W, H = 1080, 1920
    if a.modo == 'crop':
        fx = a.foco
        vf = f"scale=-2:{H},crop={W}:{H}:(iw-{W})*{fx}:0" if i['w'] / i['h'] > W / H else f"scale={W}:-2,crop={W}:{H}:0:(ih-{H})/2"
        run([FF, '-y', '-i', a.inp, '-vf', vf + ',setsar=1', '-r', '30', *ENC, a.out])
    else:  # fundo desfocado + vídeo inteiro no centro (bom p/ 16:9 → 9:16)
        fc = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=30:3,eq=brightness=-0.08[bg];"
              f"[0:v]scale={W}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]")
        run([FF, '-y', '-i', a.inp, '-filter_complex', fc, '-map', '[v]', '-map', '0:a?', '-r', '30', *ENC, a.out])
    print('✔', a.out)


def c_zoom(a):
    """--em '2.1,5.4:6.2'  => zoom em 2.1s (dura --dur) e zoom de 5.4 a 6.2s. Rampa suave de 0.12s."""
    i = probe(a.inp)
    W, H = i['w'] - i['w'] % 2, i['h'] - i['h'] % 2
    f, r = a.fator, (0.001 if a.corte else 0.12)
    terms = []
    for it in a.em.split(','):
        s, e = (it.split(':') + [None])[:2]
        s = float(s)
        e = float(e) if e else s + a.dur
        terms.append(f"between(t,{s},{e})*min(1,(t-{s})/{r})*min(1,({e}-t)/{r})")
    z = f"(1+{f - 1}*min(1,{'+'.join(terms)}))"
    fy = a.foco_y
    vf = (f"scale=w='trunc({W}*{z}/2)*2':h='trunc({H}*{z}/2)*2':eval=frame,"
          f"crop={W}:{H}:'(iw-{W})/2':'(ih-{H})*{fy}',setsar=1")
    run([FF, '-y', '-i', a.inp, '-vf', vf, *ENC, a.out])
    print('✔', a.out)


def c_compor(a):
    dec = ['-c:v', 'libvpx-vp9'] if a.overlay.lower().endswith('.webm') else []
    sfx = a.sfx or (os.path.splitext(a.overlay)[0] + '.sfx.wav')
    has_sfx = os.path.exists(sfx) and not a.sem_sfx
    if has_sfx and probe(a.base)['audio']:
        amap = ['-filter_complex', '[1:v]format=rgba[o];[0:v][o]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[v];[0:a][2:a]amix=inputs=2:duration=first:normalize=0[a]', '-map', '[v]', '-map', '[a]']
    elif has_sfx:
        amap = ['-filter_complex', '[1:v]format=rgba[o];[0:v][o]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[v]', '-map', '[v]', '-map', '2:a']
    else:
        amap = ['-filter_complex', '[1:v]format=rgba[o];[0:v][o]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[v]', '-map', '[v]', '-map', '0:a?']
    run([FF, '-y', '-i', a.base, *dec, '-i', a.overlay, *(['-i', sfx] if has_sfx else []), *amap, *ENC, a.out])
    if has_sfx:
        print('  + efeitos sonoros do overlay mixados (', os.path.basename(sfx), ')')
    print('✔', a.out)


def c_split(a):
    fc = ("[0:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[t];"
          "[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[b];"
          "[t][b]vstack=2[v]")
    run([FF, '-y', '-i', a.cima, '-i', a.baixo, '-filter_complex', fc, '-map', '[v]', '-map', f'{1 if a.audio == "baixo" else 0}:a?', '-shortest', *ENC, a.out])
    print('✔', a.out)


def c_comparar(a):
    fc = (f"color=c={a.fundo}:s=1080x1920:d=3600[bg];"
          "[0:v]scale=1000:-2[a0];[1:v]scale=1000:-2[b0];"
          "[bg][a0]overlay=40:330:shortest=1[x];[x][b0]overlay=40:1000[v]")
    run([FF, '-y', '-i', a.a, '-i', a.b, '-filter_complex', fc, '-map', '[v]', '-map', '0:a?', '-shortest', *ENC, a.out])
    print('✔', a.out, '— dica: renderize títulos/rótulos com um template MotionVelix --alpha e use "compor"')


def c_antesdepois(a):
    fc = ("[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:4,eq=brightness=-0.05:saturation=1.2[bg];"
          "[0:v]scale=320:-2,setsar=1[an];[1:v]scale=600:-2,setsar=1[dp];"
          "[bg][an]overlay=60:(H-h)/2+60[x];[x][dp]overlay=W-w-80:(H-h)/2-40[v]")
    run([FF, '-y', '-i', a.antes, '-i', a.depois, '-filter_complex', fc, '-map', '[v]', '-map', '1:a?', '-shortest', *ENC, a.out])
    print('✔', a.out)


def c_musica(a):
    vol = a.vol
    if a.duck:
        fc = (f"[1:a]volume={vol},aloop=loop=-1:size=2e9[m];[0:a]asplit=2[voz][sc];"
              "[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350[md];"
              "[voz][md]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]")
    else:
        fc = f"[1:a]volume={vol},aloop=loop=-1:size=2e9[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]"
    if not probe(a.video)['audio']:
        fc = f"[1:a]volume={vol}[a]"
    run([FF, '-y', '-i', a.video, '-i', a.trilha, '-filter_complex', fc, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', a.out])
    print('✔', a.out)


def c_exportar(a):
    i = probe(a.inp)
    vf = 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30'
    cmd = [FF, '-y', '-i', a.inp, '-vf', vf]
    if i['audio']:
        cmd += ['-af', 'loudnorm=I=-13.3:TP=-2:LRA=11,alimiter=limit=0.8:level=disabled,volume=-1.2dB']
    cmd += ['-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '18', '-maxrate', '12M', '-bufsize', '24M', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', a.out]
    run(cmd)
    print('✔ pronto para postar:', a.out)


def c_batidas(a):
    try:
        import librosa, numpy as np
    except ImportError:
        sys.exit('instale: pip install librosa')
    y, sr = librosa.load(a.audio, sr=22050)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units='time')
    on = librosa.onset.onset_detect(y=y, sr=sr, units='time')
    out = dict(bpm=round(float(np.atleast_1d(tempo)[0]), 1), batidas=[round(float(b), 3) for b in beats], impactos=[round(float(o), 3) for o in on])
    print(json.dumps(out)[:2000])
    if a.salvar:
        json.dump(out, open(a.salvar, 'w'))


def c_analisar(a):
    os.makedirs(a.pasta, exist_ok=True)
    i = probe(a.video)
    base = os.path.join(a.pasta, os.path.splitext(os.path.basename(a.video))[0])
    rate = 24 / max(i['dur'], 1)
    run([FF, '-y', '-v', 'error', '-i', a.video, '-vf', f"fps={rate},scale=270:-2,tile=8x3:padding=4", '-frames:v', '1', '-q:v', '4', base + '_folha.jpg'], quiet=True)
    r = subprocess.run([FF, '-i', a.video, '-vf', "fps=15,scale=180:-2,select='gt(scene,0.25)',showinfo", '-an', '-f', 'null', '-'], capture_output=True, text=True)
    cuts = [round(float(x), 2) for x in re.findall(r'pts_time:([\d.]+)', r.stderr)]
    res = dict(arquivo=a.video, **i, cortes=cuts, cortes_por_seg=round(len(cuts) / max(i['dur'], 1), 2))
    try:
        import librosa, numpy as np
        y, sr = librosa.load(a.video, sr=16000)
        res['bpm'] = round(float(np.atleast_1d(librosa.beat.beat_track(y=y, sr=sr)[0])[0]))
    except Exception:
        pass
    json.dump(res, open(base + '_analise.json', 'w'), indent=1)
    print(json.dumps(res, indent=1))
    print('folha de contato:', base + '_folha.jpg  → abra a imagem e descreva estilo, tipografia, gancho, transições')


LOOKS = {
    'quente':      'eq=contrast=1.06:saturation=1.12:gamma=0.98,colorbalance=rs=.05:gs=.01:bs=-.05:rm=.03:bm=-.03',
    'frio':        'eq=contrast=1.08:saturation=1.05,colorbalance=rs=-.04:bs=.06:rm=-.02:bm=.04',
    'cinema':      "eq=contrast=1.1:saturation=0.92,curves=all='0/0.04 0.25/0.22 0.5/0.5 0.75/0.79 1/0.96'",
    'teal-orange': "colorbalance=rs=-.08:gs=-.02:bs=.1:rh=.08:gh=.02:bh=-.08,eq=contrast=1.08:saturation=1.15",
    'vibrante':    'eq=contrast=1.08:saturation=1.35,unsharp=5:5:0.6',
    'matte':       "curves=all='0/0.08 0.5/0.5 1/0.92',eq=saturation=0.88",
    'pb':          'hue=s=0,eq=contrast=1.25:gamma=0.95',
    'neon':        'eq=contrast=1.12:saturation=1.4,colorbalance=bs=.08:rs=.04:gm=-.06',
}


def c_grade(a):
    vf = [LOOKS[a.look]] if a.look != 'nenhum' else []
    if a.vinheta:
        vf.append('vignette=PI/4.5')
    if a.grao:
        vf.append(f'noise=alls={a.grao}:allf=t')
    if a.nitidez:
        vf.append('unsharp=5:5:0.5')
    run([FF, '-y', '-i', a.inp, '-vf', ','.join(vf) or 'null', '-c:a', 'copy', *[x for x in ENC if x not in ('-c:a', 'aac', '-b:a', '192k')], a.out])
    print('✔', a.out, f'(look {a.look})')


def c_qc(a):
    """Controle de qualidade automático antes de postar."""
    i = probe(a.inp); rep = []
    ok = lambda c, m: rep.append(('✔' if c else '⚠', m))
    ok(i['w'] == 1080 and i['h'] == 1920, f"resolução {i['w']}x{i['h']} (ideal 1080x1920)")
    ok(abs(i['fps'] - 30) < .5 or abs(i['fps'] - 60) < .5, f"fps {i['fps']}")
    ok(5 <= i['dur'] <= 90, f"duração {i['dur']:.1f}s")
    # frame 0: tem conteúdo? (desvio padrão de luminância)
    r = subprocess.run([FF, '-v', 'error', '-i', a.inp, '-vf', 'scale=108:192,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-frames:v', '1', '-f', 'null', '-'], capture_output=True, text=True)
    tmp = tempfile.mktemp(suffix='.png')
    subprocess.run([FF, '-v', 'error', '-y', '-i', a.inp, '-vf', 'scale=108:192,format=gray', '-frames:v', '1', tmp])
    try:
        import numpy as np
        from PIL import Image
        g = np.asarray(Image.open(tmp), float); ok(g.std() > 8, f'frame 0 tem conteúdo (contraste {g.std():.0f}) — gancho visível no 1º frame')
    except Exception:
        pass
    # telas paradas > 2.5s (perda de retenção)
    r = subprocess.run([FF, '-i', a.inp, '-vf', 'freezedetect=n=0.003:d=2.5', '-map', '0:v', '-f', 'null', '-'], capture_output=True, text=True)
    fz = re.findall(r'freeze_start: ([\d.]+)', r.stderr)
    ok(not fz, 'nenhuma tela parada > 2,5s' if not fz else f'tela parada começando em {", ".join(fz[:5])}s — adicione movimento/zoom')
    r = subprocess.run([FF, '-i', a.inp, '-vf', 'blackdetect=d=0.3:pix_th=0.06', '-an', '-f', 'null', '-'], capture_output=True, text=True)
    bl = re.findall(r'black_start:([\d.]+)', r.stderr)
    ok(not bl, 'sem tela preta' if not bl else f'tela preta em {", ".join(bl[:5])}s')
    if i['audio']:
        r = subprocess.run([FF, '-i', a.inp, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True)
        I = re.findall(r'I:\s+(-?[\d.]+) LUFS', r.stderr); TP = re.findall(r'Peak:\s+(-?[\d.]+) dBFS', r.stderr)
        if I:
            L = float(I[-1]); ok(-16.5 <= L <= -12, f'loudness {L} LUFS (alvo -14)')
        if TP:
            P = float(TP[-1]); ok(P <= -0.5, f'true peak {P} dBFS (máx -1)')
        r = subprocess.run([FF, '-i', a.inp, '-af', 'silencedetect=noise=-40dB:d=0.1', '-f', 'null', '-'], capture_output=True, text=True)
        st = re.findall(r'silence_start: ([\d.]+)', r.stderr); en = re.findall(r'silence_end: ([\d.]+)', r.stderr)
        first = float(en[0]) if st and float(st[0]) < .05 and en else 0.0
        ok(first <= .8, f'som começa em {first:.2f}s (ideal ≤ 0,7s)')
    else:
        ok(False, 'vídeo sem áudio — Reels sem som perde alcance')
    print('\nQC MotionVelix —', a.inp)
    for s_, m in rep:
        print(f'  {s_} {m}')
    n = sum(1 for s_, _ in rep if s_ == '⚠')
    print('\n  ' + ('APROVADO ✔' if not n else f'{n} ponto(s) de atenção'))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    s = p.add_subparsers(dest='cmd', required=True)
    x = s.add_parser('info'); x.add_argument('inp'); x.set_defaults(f=c_info)
    x = s.add_parser('silencio'); x.add_argument('inp'); x.add_argument('out'); x.add_argument('--db', type=float, default=-34); x.add_argument('--min', type=float, default=0.32); x.add_argument('--pad', type=float, default=0.07); x.set_defaults(f=c_silencio)
    x = s.add_parser('vertical'); x.add_argument('inp'); x.add_argument('out'); x.add_argument('--modo', choices=['crop', 'blur'], default='crop'); x.add_argument('--foco', type=float, default=0.5, help='0=esquerda 0.5=centro 1=direita'); x.set_defaults(f=c_vertical)
    x = s.add_parser('zoom'); x.add_argument('inp'); x.add_argument('out'); x.add_argument('--em', required=True); x.add_argument('--fator', type=float, default=1.18); x.add_argument('--dur', type=float, default=1.2); x.add_argument('--foco-y', type=float, default=0.35, help='0=topo 0.5=centro (rosto costuma ficar em 0.3-0.4)'); x.add_argument('--corte', action='store_true', help='zoom entra/sai seco (jump zoom) em vez de rampa'); x.set_defaults(f=c_zoom)
    x = s.add_parser('compor'); x.add_argument('base'); x.add_argument('overlay'); x.add_argument('out'); x.add_argument('--sfx', help='wav de efeitos (padrão: OVERLAY.sfx.wav)'); x.add_argument('--sem-sfx', action='store_true'); x.set_defaults(f=c_compor)
    x = s.add_parser('split'); x.add_argument('cima'); x.add_argument('baixo'); x.add_argument('out'); x.add_argument('--audio', choices=['cima', 'baixo'], default='baixo'); x.set_defaults(f=c_split)
    x = s.add_parser('comparar'); x.add_argument('a'); x.add_argument('b'); x.add_argument('out'); x.add_argument('--fundo', default='white'); x.set_defaults(f=c_comparar)
    x = s.add_parser('antesdepois'); x.add_argument('antes'); x.add_argument('depois'); x.add_argument('out'); x.set_defaults(f=c_antesdepois)
    x = s.add_parser('musica'); x.add_argument('video'); x.add_argument('trilha'); x.add_argument('out'); x.add_argument('--vol', type=float, default=0.22); x.add_argument('--sem-duck', dest='duck', action='store_false'); x.set_defaults(f=c_musica)
    x = s.add_parser('exportar'); x.add_argument('inp'); x.add_argument('out'); x.set_defaults(f=c_exportar)
    x = s.add_parser('batidas'); x.add_argument('audio'); x.add_argument('--salvar'); x.set_defaults(f=c_batidas)
    x = s.add_parser('grade'); x.add_argument('inp'); x.add_argument('out'); x.add_argument('--look', choices=list(LOOKS) + ['nenhum'], default='cinema'); x.add_argument('--vinheta', action='store_true'); x.add_argument('--grao', type=int, default=0); x.add_argument('--nitidez', action='store_true'); x.set_defaults(f=c_grade)
    x = s.add_parser('qc'); x.add_argument('inp'); x.set_defaults(f=c_qc)
    x = s.add_parser('analisar'); x.add_argument('video'); x.add_argument('pasta'); x.set_defaults(f=c_analisar)
    a = p.parse_args()
    a.f(a)


if __name__ == '__main__':
    main()
