"""ตัวอ้างอิง Kaldi fbank (numpy ล้วน เขียนแยกจาก TypeScript) — ใช้สร้างค่า golden ให้ speakerFbank.test.ts

รัน:  python -I scripts/speaker/ref_fbank.py > src/__tests__/fixtures/fbank_golden.json
ตาม torchaudio.compliance.kaldi.fbank(num_mel_bins=80, frame_length=25, frame_shift=10, dither=0, snip_edges=True,
window_type='povey', preemphasis_coefficient=0.97, low_freq=20, high_freq=0, use_energy=False) แล้วทำ CMN
"""
import json
import numpy as np

SR, N_MELS, FRAME, SHIFT, NFFT = 16000, 80, 400, 160, 512


def mel(f):
    return 1127.0 * np.log(1.0 + f / 700.0)


def fbank(x):
    x = np.asarray(x, dtype=np.float64) * 32768.0
    frames = 1 + (len(x) - FRAME) // SHIFT
    win = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(FRAME) / (FRAME - 1))) ** 0.85
    mel_low, mel_high = mel(20.0), mel(SR / 2.0)
    delta = (mel_high - mel_low) / (N_MELS + 1)
    fft_hz = SR / NFFT * np.arange(NFFT // 2)
    m = mel(fft_hz)
    bank = np.zeros((N_MELS, NFFT // 2))
    for b in range(N_MELS):
        l, c, r = mel_low + b * delta, mel_low + (b + 1) * delta, mel_low + (b + 2) * delta
        up = (m - l) / (c - l)
        down = (r - m) / (r - c)
        bank[b] = np.where((m > l) & (m < r), np.where(m <= c, up, down), 0.0)
    out = np.zeros((frames, N_MELS))
    for f in range(frames):
        seg = x[f * SHIFT : f * SHIFT + FRAME].copy()
        seg -= seg.mean()
        pre = seg.copy()
        pre[1:] = seg[1:] - 0.97 * seg[:-1]
        pre[0] = seg[0] - 0.97 * seg[0]
        pre *= win
        spec = np.fft.rfft(pre, NFFT)[: NFFT // 2]
        power = spec.real ** 2 + spec.imag ** 2
        out[f] = np.log(np.maximum(bank @ power, 1.1920929e-7))
    return out - out.mean(axis=0, keepdims=True)


def test_signal(n=8000):
    t = np.arange(n)
    x = 0.3 * np.sin(2 * np.pi * 440 * t / SR) + 0.2 * np.sin(2 * np.pi * 1234 * t / SR) + 0.05 * np.sin(t * t * 1e-5)
    return x.astype(np.float32)  # ฝั่งแอปรับ Float32 — ปัดให้เหมือนกัน


if __name__ == "__main__":
    f = fbank(test_signal())
    print(json.dumps({"frames": int(f.shape[0]), "first": f[0].round(5).tolist(), "last": f[-1].round(5).tolist(),
                      "mid": f[f.shape[0] // 2].round(5).tolist()}))
