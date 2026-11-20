#!/usr/bin/env python3
"""MotionVelix SETUP — instala e testa tudo que a skill usa. Rode uma vez:  python3 scripts/setup.py
Funciona em Linux, macOS e Windows. Não precisa de admin (instala no usuário)."""
import os, sys, shutil, subprocess, platform, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME_MV = os.path.join(os.path.expanduser('~'), '.motionvelix')
os.makedirs(HOME_MV, exist_ok=True)
OK, WARN, BAD = '✔', '⚠', '✘'
status = []


def sh(cmd, **k):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=k.pop('timeout', 900), shell=isinstance(cmd, str), **k)
    except Exception as e:
        class R: returncode = 1; stdout = ''; stderr = str(e)
        return R()


def pip(*pkgs):
    base = [sys.executable, '-m', 'pip', 'install', '-q', '--user', *pkgs]
    r = sh(base)
    if r.returncode and 'externally-managed' in (r.stderr or ''):
        r = sh(base + ['--break-system-packages'])
    if r.returncode:
        r = sh([sys.executable, '-m', 'pip', 'install', '-q', *pkgs, '--break-system-packages'])
    return r.returncode == 0


def has_mod(m):
    return sh([sys.executable, '-c', f'import {m}']).returncode == 0


# 1) Node
node = shutil.which('node')
v = sh(['node', '-v']).stdout.strip() if node else ''
status.append((OK if node and int(v.lstrip('v').split('.')[0]) >= 18 else BAD, 'Node.js 18+', v or 'instale em https://nodejs.org'))

# 2) FFmpeg (fallback: imageio-ffmpeg traz um binário pronto)
ff = shutil.which('ffmpeg')
if not ff:
    if pip('imageio-ffmpeg'):
        r = sh([sys.executable, '-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'])
        ff = r.stdout.strip() or None
        if ff:
            bindir = os.path.join(HOME_MV, 'bin'); os.makedirs(bindir, exist_ok=True)
            dst = os.path.join(bindir, 'ffmpeg' + ('.exe' if os.name == 'nt' else ''))
            shutil.copy(ff, dst); os.chmod(dst, 0o755); ff = dst
status.append((OK if ff else BAD, 'FFmpeg', ff or 'instale: https://ffmpeg.org/download.html'))
json.dump({'ffmpeg': ff}, open(os.path.join(HOME_MV, 'config.json'), 'w'))

# 3) Playwright + Chromium
pw_ok = sh(['node', '-e', "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(1))"]).returncode == 0
if not pw_ok:
    r = sh(['npm', 'i', '--prefix', HOME_MV, 'playwright@1.49.1'], timeout=900)
    pw_ok = r.returncode == 0
if pw_ok:
    cli = os.path.join(HOME_MV, 'node_modules', '.bin', 'playwright' + ('.cmd' if os.name == 'nt' else ''))
    if os.path.exists(cli) and not os.environ.get('PLAYWRIGHT_BROWSERS_PATH'):
        sh([cli, 'install', 'chromium'], timeout=1200)
status.append((OK if pw_ok else BAD, 'Playwright (navegador do render)', 'ok' if pw_ok else 'npm i -g playwright && npx playwright install chromium'))

# 4) Python: análise de áudio, transcrição, visão
for mod, pkg, desc in [('numpy', 'numpy', 'NumPy'), ('librosa', 'librosa', 'librosa (batidas/BPM)'),
                       ('cv2', 'opencv-python-headless', 'OpenCV (rosto/reframe)')]:
    ok = has_mod(mod) or pip(pkg)
    status.append((OK if ok else WARN, desc, 'ok' if ok else f'pip install {pkg}'))
# 4b) Legendas automáticas: sherpa-onnx (modelos do GitHub, funciona no Cowork) + faster-whisper (opcional)
sh_ok = has_mod('sherpa_onnx') or pip('sherpa-onnx')
gh_ok = False
try:
    import urllib.request
    rq = urllib.request.Request('https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx', method='HEAD')
    gh_ok = urllib.request.urlopen(rq, timeout=15).status == 200
except Exception:
    pass
status.append((OK if sh_ok and gh_ok else WARN, 'Legendas automáticas (sherpa-onnx)',
               'ok · modelo baixa na 1ª legenda (~640 MB, fica em cache)' if sh_ok and gh_ok else
               ('pip install sherpa-onnx' if not sh_ok else 'GitHub inacessível → use --srt ou narração do Magnific')))
fw = has_mod('faster_whisper')
status.append((OK if fw else WARN, 'faster-whisper (opcional)', 'ok' if fw else 'opcional; o sherpa-onnx já cobre'))
py = sys.version_info
if py < (3, 13):
    ok = (has_mod('mediapipe') and sh([sys.executable, '-c', 'import mediapipe as m;assert hasattr(m,"solutions")']).returncode == 0) or pip('mediapipe==0.10.14')
    status.append((OK if ok else WARN, 'MediaPipe (recorte de pessoa offline)', 'ok' if ok else 'pip install mediapipe==0.10.14'))
else:
    # cria um Python 3.12 só para a visão (uv baixa o Python do GitHub, sem admin)
    venv = os.path.join(HOME_MV, 'py312')
    vpy = os.path.join(venv, 'Scripts' if os.name == 'nt' else 'bin', 'python.exe' if os.name == 'nt' else 'python')
    teste = [vpy, '-c', 'import mediapipe as m, cv2;assert hasattr(m,"solutions")']
    ok = os.path.exists(vpy) and sh(teste).returncode == 0
    if not ok:
        uv = shutil.which('uv') or (pip('uv') and (shutil.which('uv') or os.path.join(os.path.dirname(sys.executable), 'uv')))
        if uv:
            sh([uv, 'venv', '--python', '3.12', venv], timeout=600)
            sh([uv, 'pip', 'install', '--python', vpy, 'mediapipe==0.10.14', 'opencv-python-headless', 'numpy<2'], timeout=900)
            ok = os.path.exists(vpy) and sh(teste).returncode == 0
    status.append((OK if ok else WARN, 'MediaPipe (recorte de pessoa offline)',
                   'ok (Python 3.12 dedicado em ~/.motionvelix/py312)' if ok else 'falhou → use Magnific video_remove_background'))

# 5) Efeitos sonoros
sfx = os.path.join(ROOT, 'assets', 'sfx')
if not os.path.isdir(sfx) or len(os.listdir(sfx)) < 10:
    sh([sys.executable, os.path.join(ROOT, 'scripts', 'gerar_sfx.py'), sfx])
status.append((OK if os.path.isdir(sfx) else WARN, 'Biblioteca de SFX', f'{len(os.listdir(sfx)) if os.path.isdir(sfx) else 0} sons'))

# 6) Teste real de render
if pw_ok and ff:
    out = os.path.join(HOME_MV, 'teste_render.png')
    r = sh(['node', os.path.join(ROOT, 'engine', 'render.mjs'), os.path.join(ROOT, 'templates', 'logo-reveal.html'), out, '--preview', '2.5'], timeout=180)
    okr = r.returncode == 0
    status.append((OK if okr else BAD, 'Teste de render', 'renderizou um frame' if okr else (r.stderr or r.stdout)[-300:]))

print('\nMotionVelix — diagnóstico (' + platform.system() + ', Python ' + platform.python_version() + ')\n')
for s, n, d in status:
    print(f' {s} {n:<42} {d}')
bad = [n for s, n, _ in status if s == BAD]
print('\n' + ('PRONTO PARA USAR.' if not bad else 'Faltando (obrigatório): ' + ', '.join(bad)))
