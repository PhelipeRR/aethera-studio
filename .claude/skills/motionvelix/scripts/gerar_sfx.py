#!/usr/bin/env python3
"""Gera a biblioteca de efeitos sonoros MotionVelix por síntese (100% original, sem direitos autorais).
   python3 gerar_sfx.py [pasta_saida]   → assets/sfx/*.wav (48 kHz, estéreo)
"""
import os, sys, wave, numpy as np

SR = 48000
rng = np.random.default_rng(7)


def env(n, a=.005, d=.2, curve=4.0):
    t = np.arange(n) / SR
    at = np.clip(t / max(a, 1e-4), 0, 1)
    dc = np.exp(-curve * np.clip(t - a, 0, None) / max(d, 1e-4))
    return at * dc


def lp(x, fc):
    """filtro passa-baixa de 1 polo com corte variável (fc pode ser array)"""
    fc = np.broadcast_to(np.asarray(fc, float), x.shape)
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.zeros_like(x); s = 0.0
    for i in range(len(x)):
        s = (1 - a[i]) * x[i] + a[i] * s
        y[i] = s
    return y


def hp(x, fc):
    return x - lp(x, fc)


def bp(x, fc, q=1.0):
    return hp(lp(x, fc * (1 + .5 / q)), fc / (1 + .5 / q))


def sine_sweep(f0, f1, dur, shape='exp'):
    n = int(dur * SR); t = np.arange(n) / SR
    f = f0 * (f1 / f0) ** (t / dur) if shape == 'exp' else f0 + (f1 - f0) * t / dur
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def norm(x, peak=.89):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


def stereo(x, width=.0):
    if width <= 0:
        return np.stack([x, x], 1)
    d = int(.012 * SR * width)
    r = np.concatenate([np.zeros(d), x])[:len(x)]
    return np.stack([x, r * .9 + x * .1], 1)


def save(name, x, out):
    if x.ndim == 1:
        x = stereo(x)
    x = np.clip(x, -1, 1)
    with wave.open(os.path.join(out, name + '.wav'), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())


def make(out):
    os.makedirs(out, exist_ok=True)
    # WHOOSH (v2, mais leve e "satisfatório"): ar fino e curto, sem grave pesado + micro "tick" no ápice
    for nm, dur, f0, f1, wdt, lvl in [('whoosh', .38, 1800, 7000, .5, .55), ('whoosh_rapido', .22, 2500, 9000, .35, .5), ('whoosh_grave', .5, 700, 3500, .6, .5)]:
        n = int(dur * SR); t = np.linspace(0, 1, n)
        bell = np.sin(np.pi * t) ** 3
        fc = f0 * (f1 / f0) ** np.sin(np.pi * t * .5)
        x = hp(lp(noise(dur), fc), f0 * .6) * bell
        tk = np.zeros(n); k0 = int(n * .55); m = int(.012 * SR)
        tk[k0:k0 + m] = bp(noise(.012), 4500, 2)[:len(tk[k0:k0 + m])] * env(m, .0005, .004, 5)[:len(tk[k0:k0 + m])] * .25
        save(nm, stereo(norm(x + tk, lvl), wdt), out)
    # SWISH suave (troca de cena delicada) e BLIP (UI satisfatório)
    n = int(.3 * SR); t = np.linspace(0, 1, n)
    save('swish_suave', stereo(norm(hp(lp(noise(.3), 6000), 1500) * np.sin(np.pi * t) ** 4, .4), .5), out)
    x = sine_sweep(600, 1400, .09) * env(int(.09 * SR), .002, .05, 4)
    save('blip', norm(x, .5), out)
    # SWISH reverso (suga para dentro)
    n = int(.5 * SR); t = np.linspace(0, 1, n)
    x = lp(noise(.5), 200 + 5000 * t ** 2) * (t ** 2.5) * np.exp(-((t - 1) ** 2) / .002 * 0 + 0)
    save('swish_reverso', stereo(norm(x, .8), .5), out)
    # POP: senoide caindo de tom + clique
    x = sine_sweep(900, 260, .12) * env(int(.12 * SR), .001, .05, 3)
    x[:60] += noise(60 / SR) * .4
    save('pop', norm(x, .8), out)
    x = sine_sweep(1400, 500, .09) * env(int(.09 * SR), .001, .035, 3)
    save('pop_agudo', norm(x, .7), out)
    # CLICK / TAP (UI)
    x = bp(noise(.04), 3500, 2) * env(int(.04 * SR), .0005, .008, 5)
    x += sine_sweep(2200, 1800, .04) * env(int(.04 * SR), .0005, .006, 5) * .5
    save('click', norm(x, .7), out)
    x = lp(noise(.06), 1800) * env(int(.06 * SR), .001, .015, 5) + sine_sweep(320, 180, .06) * env(int(.06 * SR), .001, .02, 4) * .7
    save('tap', norm(x, .75), out)
    # TYPING: sequência de teclas (1,2 s)
    dur = 1.2; x = np.zeros(int(dur * SR)); t0 = 0.0
    while t0 < dur - .05:
        k = bp(noise(.03), 2500 + rng.random() * 2500, 1.5) * env(int(.03 * SR), .0005, .006, 5) * (.5 + .5 * rng.random())
        i = int(t0 * SR); x[i:i + len(k)] += k[:len(x) - i]
        t0 += .055 + rng.random() * .07
    save('digitando', norm(x, .55), out)
    # IMPACTO: sub + ruído + cauda
    dur = 1.4; n = int(dur * SR)
    sub = sine_sweep(110, 38, dur) * env(n, .002, .45, 3)
    crack = lp(noise(dur), 2500) * env(n, .001, .08, 4)
    tail = lp(noise(dur), 600) * env(n, .01, .6, 3) * .3
    save('impacto', stereo(norm(sub * 1.0 + crack * .6 + tail, .92), .3), out)
    # BOOM cinematográfico (mais grave e longo)
    dur = 2.2; n = int(dur * SR)
    x = sine_sweep(70, 28, dur) * env(n, .003, .9, 2.5) + lp(noise(dur), 300) * env(n, .005, .9, 3) * .5
    save('boom', stereo(norm(x, .92), .4), out)
    # RISER: ruído + tom subindo (tensão antes do impacto)
    dur = 1.6; n = int(dur * SR); t = np.linspace(0, 1, n)
    x = lp(noise(dur), 300 + 9000 * t ** 2) * t ** 2 * .7 + sine_sweep(180, 1400, dur) * t ** 3 * .35
    save('riser', stereo(norm(x, .8), .6), out)
    # DING / notificação
    dur = .9; n = int(dur * SR); t = np.arange(n) / SR
    a = np.sin(2 * np.pi * 1318.5 * t) * env(n, .002, .35, 3)
    b = np.zeros(n); off = int(.09 * SR); b[off:] = (np.sin(2 * np.pi * 1760 * t) * env(n, .002, .45, 3))[:n - off]
    save('ding', norm(a + b, .6), out)
    # SUCESSO (três notas)
    dur = 1.0; n = int(dur * SR); t = np.arange(n) / SR; x = np.zeros(n)
    for k, f in enumerate([1046.5, 1318.5, 1568]):
        o = int(k * .08 * SR); x[o:] += (np.sin(2 * np.pi * f * t) * env(n, .002, .3, 3))[:n - o] * .6
    save('sucesso', norm(x, .6), out)
    # DINHEIRO / caixa (metálico)
    dur = .8; n = int(dur * SR); t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * t) * env(n, .001, d, 4) for f, d in [(2637, .25), (3520, .2), (4186, .15), (5274, .1)])
    x[:int(.02 * SR)] += bp(noise(.02), 5000, 2) * .8
    save('dinheiro', norm(x, .6), out)
    # GLITCH digital
    dur = .35; x = np.zeros(int(dur * SR)); t0 = 0
    while t0 < dur - .03:
        L = .01 + rng.random() * .03; seg = np.sign(np.sin(2 * np.pi * (200 + rng.random() * 2000) * np.arange(int(L * SR)) / SR)) * .5 + noise(L) * .3
        i = int(t0 * SR); x[i:i + len(seg)] = seg[:len(x) - i]; t0 += L + rng.random() * .02
    save('glitch', norm(np.round(x * 6) / 6, .6), out)
    # SHIMMER (brilho de logo)
    dur = 1.6; n = int(dur * SR); t = np.arange(n) / SR; x = np.zeros(n)
    for k in range(14):
        f = 2000 + rng.random() * 5000; o = int(rng.random() * .9 * SR)
        x[o:] += (np.sin(2 * np.pi * f * t) * env(n, .003, .25, 4))[:n - o] * (.3 + .3 * rng.random())
    save('brilho', stereo(norm(x, .5), .7), out)
    # OBTURADOR (câmera / screenshot)
    x = np.zeros(int(.25 * SR))
    for o in [0, .07]:
        k = bp(noise(.05), 3000, 1) * env(int(.05 * SR), .0005, .01, 5); i = int(o * SR); x[i:i + len(k)] += k
    save('obturador', norm(x, .7), out)
    # BASS DROP (para lyric/showreel)
    dur = 1.2; n = int(dur * SR)
    x = sine_sweep(160, 40, dur) * env(n, .002, .6, 2.5)
    save('drop', stereo(norm(np.tanh(x * 2.5), .9), .2), out)
    # ---- pacote "vintage / papel / relógio" ----
    # TIC e TAC de relógio (madeira + metal, tons diferentes)
    for nm, f0 in [('tic', 2600), ('tac', 1900)]:
        n = int(.12 * SR); t = np.arange(n) / SR
        x = bp(noise(.12), f0, 3) * env(n, .0003, .012, 5) + np.sin(2 * np.pi * f0 * 1.5 * t) * env(n, .0003, .02, 5) * .4
        x += lp(noise(.12), 600) * env(n, .0005, .01, 5) * .5
        save(nm, norm(x, .75), out)
    # CATRACA (dar corda / girar chave)
    dur = .9; x = np.zeros(int(dur * SR)); t0 = 0.0
    while t0 < dur - .05:
        k = bp(noise(.025), 3200, 2) * env(int(.025 * SR), .0003, .005, 5)
        i = int(t0 * SR); x[i:i + len(k)] += k[:len(x) - i]; t0 += .07
    save('catraca', norm(x, .7), out)
    # PAPEL (deslizar / virar folha)
    dur = .45; n = int(dur * SR); t = np.linspace(0, 1, n)
    x = bp(noise(dur), 2500, .7) * np.sin(np.pi * t) ** 1.5 * (0.6 + 0.4 * np.abs(np.sin(t * 60)))
    save('papel', stereo(norm(x, .6), .4), out)
    # PAPEL POP (recorte encaixando)
    x = lp(noise(.08), 1500) * env(int(.08 * SR), .001, .02, 5) + bp(noise(.08), 4000, 1) * env(int(.08 * SR), .0005, .008, 5) * .6
    save('papel_pop', norm(x, .65), out)
    # BATIMENTO de coração (lub-dub)
    dur = .7; n = int(dur * SR); x = np.zeros(n)
    for o, a in [(0, 1), (.18, .7)]:
        k = sine_sweep(70, 40, .16) * env(int(.16 * SR), .004, .06, 4) * a; i = int(o * SR); x[i:i + len(k)] += k
    save('batimento', norm(np.tanh(x * 2), .85), out)
    # CHUVA (ambiente 6s, em loop)
    dur = 6.0; x = lp(noise(dur), 3500) * .25
    for _ in range(900):
        o = int(rng.random() * (dur - .02) * SR); k = bp(noise(.01), 3000 + rng.random() * 4000, 2) * env(int(.01 * SR), .0002, .003, 5)
        x[o:o + len(k)] += k * rng.random() * .6
    save('chuva', stereo(norm(x, .5), .8), out)
    # SINO / caixinha de música (acorde mágico)
    dur = 2.2; n = int(dur * SR); t = np.arange(n) / SR; x = np.zeros(n)
    for k, f in enumerate([1046.5, 1318.5, 1568, 2093]):
        o = int(k * .07 * SR); x[o:] += (np.sin(2 * np.pi * f * t) * env(n, .002, .9, 3) + np.sin(2 * np.pi * f * 2.76 * t) * env(n, .001, .2, 4) * .3)[:n - o]
    save('sino', stereo(norm(x, .55), .6), out)
    # TEMPO PARANDO (fita desacelerando)
    dur = 1.2; n = int(dur * SR); t = np.linspace(0, 1, n)
    x = sine_sweep(440, 40, dur) * (1 - t) ** .5 * .6 + lp(noise(dur), 900 * (1 - t) + 50) * (1 - t) * .6
    save('tempo_parando', stereo(norm(x, .8), .4), out)
    # PÁSSAROS batendo asas
    dur = .8; x = np.zeros(int(dur * SR)); t0 = 0
    while t0 < dur - .05:
        k = lp(noise(.05), 1800) * env(int(.05 * SR), .003, .02, 4); i = int(t0 * SR); x[i:i + len(k)] += k; t0 += .085
    save('asas', stereo(norm(x, .6), .6), out)
    print('✔ SFX gerados em', out, '→', sorted(f[:-4] for f in os.listdir(out) if f.endswith('.wav')))


if __name__ == '__main__':
    make(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'sfx'))
