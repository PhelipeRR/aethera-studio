#!/usr/bin/env python3
"""MotionVelix VISÃO — IA de visão local (offline) para edição profissional.

  reframe  IN OUT              16:9 → 9:16 seguindo o ROSTO automaticamente (câmera virtual suave)
  recorte  IN OUT.mov          recorta a PESSOA (fundo transparente, ProRes 4444) — para texto atrás da pessoa
  atras    BASE TEXTO.mov OUT  monta "texto atrás da pessoa": vídeo → texto MotionVelix → pessoa recortada por cima
  rosto    IN [--json f]       rastreia o rosto e diz a altura média (use em mv_edit.py zoom --foco-y)

Motores (escolhidos automaticamente):
  • mediapipe 0.10.14 (Python ≤ 3.12): rosto + segmentação de pessoa, modelos embutidos, sem internet.
      pip install "mediapipe==0.10.14" opencv-python-headless
  • fallback: OpenCV (rosto por Haar cascade, embutido). Segmentação sem mediapipe → use o conector
    Magnific `video_remove_background` e passe o .mov/.webm resultante para `atras --pessoa arquivo`.
"""
import argparse, json, os, subprocess, sys, shutil, warnings
os.environ.setdefault('GLOG_minloglevel', '3'); os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3'); warnings.filterwarnings('ignore')

try:
    import cv2, numpy as np
except ImportError:
    sys.exit('instale: pip install opencv-python-headless numpy')


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
try:
    import mediapipe as mp
    MP = hasattr(mp, 'solutions')
except Exception:
    MP = False

# Python ≥ 3.13 não tem mediapipe: se o setup criou o ambiente 3.12, reabre este script nele.
_PY312 = os.path.join(os.path.expanduser('~'), '.motionvelix', 'py312', 'Scripts' if os.name == 'nt' else 'bin',
                      'python.exe' if os.name == 'nt' else 'python')
if not MP and os.path.exists(_PY312) and os.path.realpath(sys.executable) != os.path.realpath(_PY312) \
        and not os.environ.get('MV_SEM_PY312'):
    os.environ['MV_SEM_PY312'] = '1'
    os.execv(_PY312, [_PY312] + sys.argv)


class Faces:
    def __init__(self):
        if MP:
            self.d = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=.5)
        else:
            self.c = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

    def find(self, bgr):
        """retorna (cx, cy, w) normalizados do maior rosto, ou None"""
        h, w = bgr.shape[:2]
        if MP:
            r = self.d.process(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            if not r.detections:
                return None
            if getattr(self, 'all', False):
                return [(d.location_data.relative_bounding_box.xmin + d.location_data.relative_bounding_box.width / 2, d.location_data.relative_bounding_box.ymin + d.location_data.relative_bounding_box.height / 2, d.location_data.relative_bounding_box.width) for d in r.detections]
            b = max(r.detections, key=lambda d: d.location_data.relative_bounding_box.width).location_data.relative_bounding_box
            return (b.xmin + b.width / 2, b.ymin + b.height / 2, b.width)
        sm = cv2.resize(bgr, (w * 480 // h, 480))
        f = self.c.detectMultiScale(cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY), 1.15, 5, minSize=(40, 40))
        if len(f) == 0:
            return None
        x, y, fw, fh = max(f, key=lambda r: r[2])
        return ((x + fw / 2) / sm.shape[1], (y + fh / 2) / sm.shape[0], fw / sm.shape[1])


def track(path, step=.2):
    cap = cv2.VideoCapture(path); fps = cap.get(cv2.CAP_PROP_FPS) or 30; n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    F = Faces(); F.all = MP; every = max(1, int(fps * step)); pts = []
    for i in range(0, n, every):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i); ok, fr = cap.read()
        if not ok:
            break
        r = F.find(fr)
        if r:
            for f in (r if isinstance(r, list) else [r]):
                pts.append((i / fps, *f))
    cap.release()
    return pts, fps, n


def scene_cuts(path):
    """tempos de corte de câmera (multicam de podcast, troca de plano)"""
    r = subprocess.run([FF, '-i', path, '-vf', "fps=10,scale=160:-2,select='gt(scene,0.32)',showinfo", '-an', '-f', 'null', '-'], capture_output=True, text=True)
    import re
    return [float(x) for x in re.findall(r'pts_time:([\d.]+)', r.stderr)]


def smooth_path(pts, fps, n, key=1, dead=.04, alpha=.12, default=.5, cuts=()):
    """câmera virtual: interpola, zona morta e suavização — e RECOMEÇA em cada corte de câmera (pula direto, sem panorâmica falsa)"""
    if not pts:
        return np.full(n, default)
    bounds = [0] + sorted(int(c * fps) for c in cuts if 0 < c * fps < n) + [n]
    out = np.empty(n)
    for a, b in zip(bounds[:-1], bounds[1:]):
        seg = [p for p in pts if a / fps <= p[0] < b / fps]
        if not seg:
            out[a:b] = out[a - 1] if a else default; continue
        # vários rostos no plano (ex.: plano aberto de podcast): segue o rosto que aparece com mais constância
        bins = {}
        for p in seg:
            bins.setdefault(round(p[key] * 6), []).append(p)
        best = max(bins.values(), key=lambda v: (len(v), np.mean([q[3] for q in v])))
        cx0 = np.median([q[key] for q in best])
        seg = [p for p in seg if abs(p[key] - cx0) < .12]
        ts = np.array([p[0] for p in seg]); vs = np.array([p[key] for p in seg])
        raw = np.interp(np.arange(a, b) / fps, ts, vs)
        cur = float(np.median(vs[:3]))
        for i, v in enumerate(raw):
            if abs(v - cur) > dead:
                cur += (v - cur) * alpha
            out[a + i] = cur
        k = min(int(fps * .5) | 1, max(1, (b - a)) | 1)
        if b - a > k:
            out[a:b] = np.convolve(np.pad(out[a:b], k // 2, mode='edge'), np.ones(k) / k, mode='valid')
    return out


def c_rosto(a):
    pts, fps, n = track(a.inp)
    if not pts:
        print('nenhum rosto encontrado'); return
    ys = [p[2] for p in pts]; xs = [p[1] for p in pts]
    res = dict(motor='mediapipe' if MP else 'opencv', deteccoes=len(pts), x_medio=round(float(np.median(xs)), 3), y_medio=round(float(np.median(ys)), 3),
               dica=f"mv_edit.py zoom ... --foco-y {max(0, min(1, float(np.median(ys)) - .12)):.2f}")
    print(json.dumps(res, indent=1))
    if a.json:
        json.dump(dict(**res, pontos=pts), open(a.json, 'w'))


def c_reframe(a):
    pts, fps, n = track(a.inp)
    cap = cv2.VideoCapture(a.inp); W = int(cap.get(3)); H = int(cap.get(4))
    cw = int(H * 9 / 16) // 2 * 2
    if cw >= W:
        sys.exit('o vídeo já é vertical — use mv_edit.py vertical')
    cuts = scene_cuts(a.inp)
    xs = smooth_path(pts, fps, n, key=1, cuts=cuts)
    print(f'  motor={"mediapipe" if MP else "opencv"} · {len(cuts)} cortes de câmera · rostos em {len(pts)} amostras · recorte {cw}x{H} → 1080x1920')
    p = subprocess.Popen([FF, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{cw}x{H}', '-r', str(fps), '-i', '-',
                          '-i', a.inp, '-map', '0:v', '-map', '1:a?', '-vf', 'scale=1080:1920:flags=lanczos,setsar=1', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium',
                          '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', a.out], stdin=subprocess.PIPE)
    i = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        cx = xs[min(i, len(xs) - 1)] * W
        x0 = int(np.clip(cx - cw / 2, 0, W - cw))
        p.stdin.write(np.ascontiguousarray(fr[:, x0:x0 + cw]).tobytes()); i += 1
    p.stdin.close(); p.wait(); cap.release()
    print('✔', a.out)


def c_recorte(a):
    if not MP:
        sys.exit('segmentação local requer: pip install "mediapipe==0.10.14" (Python ≤3.12)\n'
                 'alternativa: conector Magnific → video_remove_background, depois use "atras --pessoa arquivo"')
    seg = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)
    cap = cv2.VideoCapture(a.inp); W = int(cap.get(3)); H = int(cap.get(4)); fps = cap.get(5) or 30
    p = subprocess.Popen([FF, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', f'{W}x{H}', '-r', str(fps), '-i', '-',
                          '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', a.out], stdin=subprocess.PIPE)
    prev = None; n = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        m = seg.process(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)).segmentation_mask
        m = cv2.GaussianBlur(m, (0, 0), a.suave)
        if prev is not None:
            m = m * .65 + prev * .35       # estabilidade temporal (menos "piscar" na borda)
        prev = m
        al = np.clip((m - a.limiar) / .2 + .5, 0, 1)
        if a.erode:
            al = cv2.erode(al, np.ones((3, 3), np.uint8), iterations=a.erode)
        out = np.dstack([fr, (al * 255).astype(np.uint8)])
        p.stdin.write(out.tobytes()); n += 1
        if n % 60 == 0:
            print(f'\r  {n} frames', end='', flush=True)
    p.stdin.close(); p.wait(); cap.release()
    print('\n✔ pessoa recortada →', a.out)


def c_atras(a):
    pessoa = a.pessoa
    if not pessoa:
        pessoa = os.path.splitext(a.out)[0] + '_pessoa.mov'
        c_recorte(argparse.Namespace(inp=a.base, out=pessoa, suave=a.suave, limiar=a.limiar, erode=a.erode))
    fc = ('[1:v]format=rgba[t];[2:v]format=rgba[p];[0:v][t]overlay=0:0:eof_action=pass[a];'
          '[a][p]overlay=0:0:eof_action=pass,format=yuv420p[v]')
    dec = lambda f: (['-c:v', 'libvpx-vp9'] if f.lower().endswith('.webm') else []) + ['-i', f]
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', a.base, *dec(a.texto), *dec(pessoa), '-filter_complex', fc, '-map', '[v]', '-map', '0:a?',
                    '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', a.out], check=True)
    print('✔ texto atrás da pessoa →', a.out)


def main():
    P = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    s = P.add_subparsers(dest='cmd', required=True)
    x = s.add_parser('rosto'); x.add_argument('inp'); x.add_argument('--json'); x.set_defaults(f=c_rosto)
    x = s.add_parser('reframe'); x.add_argument('inp'); x.add_argument('out'); x.set_defaults(f=c_reframe)
    for nm in ['recorte', 'atras']:
        x = s.add_parser(nm)
        if nm == 'recorte':
            x.add_argument('inp'); x.add_argument('out'); x.set_defaults(f=c_recorte)
        else:
            x.add_argument('base'); x.add_argument('texto'); x.add_argument('out'); x.add_argument('--pessoa', help='recorte pronto (ex.: do Magnific)'); x.set_defaults(f=c_atras)
        x.add_argument('--suave', type=float, default=2.0, help='suavização da borda (px)')
        x.add_argument('--limiar', type=float, default=.5)
        x.add_argument('--erode', type=int, default=0)
    a = P.parse_args(); a.f(a)


if __name__ == '__main__':
    main()
