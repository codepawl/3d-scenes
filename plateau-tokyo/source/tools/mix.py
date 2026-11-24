"""Soundtrack for the Tokyo layer film: music section + a few soft real SFX cues, mastered.
usage: mix.py AUDIO_DIR OUT.wav"""
import sys, os, json
import numpy as np, soundfile as sf, pyloudnorm as pyln
from scipy.signal import butter, sosfilt, resample_poly

A, OUT = sys.argv[1], sys.argv[2]
SR, DUR = 48000, 48.0
def load(p):
    x, sr = sf.read(p, always_2d=True); x = x.astype(np.float64)
    if x.shape[1] == 1: x = np.repeat(x, 2, 1)
    if sr != SR: x = resample_poly(x, SR, sr, axis=0)
    return x[:, :2]
def lp(x, f): return sosfilt(butter(4, f, 'low', fs=SR, output='sos'), x, axis=0)
def hp(x, f): return sosfilt(butter(2, f, 'high', fs=SR, output='sos'), x, axis=0)
def fade(x, fi, fo):
    n = len(x); e = np.ones(n)
    a = int(fi * SR); b = int(fo * SR)
    if a: e[:a] = np.linspace(0, 1, a) ** 2
    if b: e[-b:] *= np.linspace(1, 0, b) ** 2
    return x * e[:, None]
def db(v): return 10 ** (v / 20)

mix = np.zeros((int(DUR * SR) + SR, 2))
music = load(f'{A}/music.wav')[int(131.5 * SR):int(180.4 * SR)]
music = fade(music, 0.25, 0.6)
mus = np.zeros_like(mix); mus[:len(music)] = music

B = f'{A}/bsb'
# (time s, file, gain dB, lowpass Hz or 0, highpass Hz or 0, max length s, fade out s)
CUES = [
  (2.85, '3114-thunder-3.wav', -5, 380, 30, 5.5, 2.5),          # terrain forms around the Palace: distant low rumble
  (8.85, '1796-whoosh-4.wav', -14, 5000, 120, 2.0, 0.6),        # roads spread
  (14.3, '3113-thunder-2.wav', -5, 300, 30, 5.0, 2.5),          # Marunouchi rises: ground rumble
  (20.3, '2436-wood-vibrations.wav', -6, 260, 30, 4.5, 2.5),    # West Shinjuku skyline rises: low swell
  (24.95, '1110-tibetan-bowl-struck-1.wav', -12, 0, 200, 5.5, 2.5),  # photo facades sweep in
  (27.60, '1735-raspberry-mouse-single-click.wav', -21, 6000, 400, 0.4, 0.1),  # selection: Tokyo Met. Gov.
  (34.00, '1735-raspberry-mouse-single-click.wav', -22, 5000, 400, 0.4, 0.1),  # selection: Scramble Square
  (40.00, '1735-raspberry-mouse-single-click.wav', -22, 4500, 400, 0.4, 0.1),  # selection: Tokyo Station
  (43.55, '1482-gong-sweet.wav', -16, 2500, 60, 5.0, 3.0),       # credit line over the complete city
]
sfx = np.zeros_like(mix); log = []
for t, f, g, l, h, mx, fo in CUES:
    x = load(f'{B}/{f}')
    env = np.abs(x).max(1); start = int(np.argmax(env > env.max() * 0.05))   # trim leading silence
    x = x[start:start + int(mx * SR)]
    if l: x = lp(x, l)
    if h: x = hp(x, h)
    x = x / (np.abs(x).max() + 1e-9) * db(g)
    x = fade(x, 0.01 if 'click' in f else 0.08, fo)
    i = int(t * SR); sfx[i:i + len(x)] += x[:len(sfx) - i]
    log.append({'t': t, 'file': f, 'gain_db': g})
# gentle duck of the music under each cue
duck = np.ones(len(mix))
for t, f, g, *_ in CUES:
    if 'click' in f: continue
    i = int(t * SR); n = int(1.8 * SR)
    duck[i:i + n] = np.minimum(duck[i:i + n], 1 - 0.25 * np.sin(np.linspace(0, np.pi, n)))
mix = mus * duck[:, None] + sfx
mix = mix[:int(DUR * SR)]
meter = pyln.Meter(SR); L = meter.integrated_loudness(mix)
mix *= db(-16 - L)
# true-peak-ish ceiling at -1 dBFS (4x oversampled check, simple gain)
tp = np.abs(resample_poly(mix, 4, 1, axis=0)).max()
if tp > db(-1.2): mix *= db(-1.2) / tp
sf.write(OUT, mix.astype(np.float32), SR, subtype='PCM_24')
print(json.dumps({'lufs_before': round(L, 1), 'lufs': round(meter.integrated_loudness(mix), 1),
                  'true_peak_dbfs': round(20 * np.log10(np.abs(resample_poly(mix, 4, 1, axis=0)).max()), 2), 'cues': len(CUES)}))
