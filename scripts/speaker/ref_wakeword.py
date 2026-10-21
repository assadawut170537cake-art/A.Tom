"""ตัวอ้างอิง openWakeWord แบบสตรีม (numpy + onnxruntime) — ใช้ยืนยัน pipeline ก่อนพอร์ตเป็น TypeScript

รัน:  python -I scripts/speaker/ref_wakeword.py <wav 16kHz mono> ...
ตาม openWakeWord AudioFeatures._streaming_features: ทุก 1280 ตัวอย่าง (80 ms)
  mel ของ 1280+480 ตัวอย่างล่าสุด → spec/10+2 → ต่อท้าย mel buffer → embedding ของ 76 เฟรมล่าสุด → ต่อ feature buffer →
  โมเดลคำปลุกอ่าน 16 embedding ล่าสุด
"""
import sys
import wave

import numpy as np
import onnxruntime as ort

MODELS = r"J:\Cloude\A.Tom\assets\models"
CHUNK = 1280


def load(path):
    w = wave.open(path)
    assert w.getframerate() == 16000 and w.getnchannels() == 1, "ต้องเป็น 16 kHz mono"
    return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)


class Pipeline:
    def __init__(self):
        opts = ["CPUExecutionProvider"]
        self.mel = ort.InferenceSession(rf"{MODELS}\melspectrogram.onnx", providers=opts)
        self.emb = ort.InferenceSession(rf"{MODELS}\embedding_model.onnx", providers=opts)
        self.ww = ort.InferenceSession(rf"{MODELS}\hey_jarvis_v0.1.onnx", providers=opts)
        self.raw = np.zeros(0, dtype=np.float32)
        self.mel_buf = np.ones((76, 32), dtype=np.float32)
        self.feat = np.zeros((16, 96), dtype=np.float32)
        self.n = 0

    def push(self, chunk):
        """chunk = 1280 ตัวอย่าง (ค่าระดับ int16 เป็น float32) → คะแนน"""
        self.raw = np.concatenate([self.raw, chunk])[-(CHUNK + 480) * 4:]
        window = self.raw[-(CHUNK + 480):]
        spec = self.mel.run(None, {"input": window[None, :]})[0]
        spec = np.squeeze(spec) / 10.0 + 2.0
        spec = spec.reshape(-1, 32)
        self.mel_buf = np.vstack([self.mel_buf, spec])[-97 * 10:]
        x = self.mel_buf[-76:].astype(np.float32)[None, :, :, None]
        e = self.emb.run(None, {"input_1": x})[0].reshape(-1, 96)
        self.feat = np.vstack([self.feat, e])[-120:]
        self.n += 1
        score = float(self.ww.run(None, {"x.1": self.feat[-16:][None, :, :].astype(np.float32)})[0].squeeze())
        return spec.shape[0], (0.0 if self.n < 5 else score)


def scores(path):
    audio = load(path)
    p = Pipeline()
    out = []
    frames = None
    for i in range(0, len(audio) - CHUNK + 1, CHUNK):
        frames, s = p.push(audio[i : i + CHUNK])
        out.append(s)
    return frames, out


if __name__ == "__main__":
    for path in sys.argv[1:]:
        frames, s = scores(path)
        print(f"{path}: mel frames/chunk={frames} max={max(s):.3f} chunks>=0.5: {sum(v >= 0.5 for v in s)}")
