/**
 * @file โหลดโมเดล openWakeWord 3 ตัว (ONNX) ด้วย onnxruntime-react-native — lazy ทั้งไลบรารีและไฟล์
 * ไฟล์: assets/models/{melspectrogram,embedding_model,hey_jarvis_v0.1}.onnx (รวม ~3.7 MB)
 * ที่มา github.com/dscripka/openWakeWord v0.5.1 · โค้ด Apache-2.0 · **โมเดลที่เทรนไว้ CC BY-NC-SA 4.0 (ไม่เชิงพาณิชย์)**
 */

import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { ProviderError } from '../../../core/http/errors';
import type { WakeModels } from './WakeWordDetector';

interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>>;
}
interface OrtModule {
  InferenceSession: { create(model: Uint8Array): Promise<OrtSession> };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
}

function loadOrt(): OrtModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: native module ไม่มีใน Expo Go / jest
    return require('onnxruntime-react-native') as OrtModule;
  } catch {
    throw new ProviderError(
      'wakeword',
      'unsupported',
      'คำปลุกต้องใช้ development build (ไม่มี onnxruntime-react-native ในแอปนี้) — build ใหม่ด้วย expo run:android',
    );
  }
}

async function loadSession(ort: OrtModule, module: number): Promise<OrtSession> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  if (!asset.localUri) throw new ProviderError('wakeword', 'server', 'ไม่พบไฟล์โมเดลคำปลุกในแอป');
  return ort.InferenceSession.create(new Uint8Array(await new File(asset.localUri).arrayBuffer()));
}

function firstOutput(result: Record<string, { data: unknown }>): Float32Array {
  const first = Object.values(result)[0]?.data;
  if (!(first instanceof Float32Array))
    throw new ProviderError('wakeword', 'server', 'โมเดลคำปลุกคืนค่าผิดรูปแบบ');
  return first;
}

export class OnnxWakeModels implements WakeModels {
  private sessions: Promise<[OrtSession, OrtSession, OrtSession]> | null = null;

  warmUp(): Promise<void> {
    return this.load().then(() => undefined);
  }

  async mel(samples: Float32Array): Promise<Float32Array> {
    const ort = loadOrt();
    const [mel] = await this.load();
    return firstOutput(
      await mel.run({ input: new ort.Tensor('float32', samples, [1, samples.length]) }),
    );
  }

  async embed(mel: Float32Array): Promise<Float32Array> {
    const ort = loadOrt();
    const [, embed] = await this.load();
    return firstOutput(
      await embed.run({ input_1: new ort.Tensor('float32', mel, [1, 76, 32, 1]) }),
    );
  }

  async score(features: Float32Array): Promise<number> {
    const ort = loadOrt();
    const [, , ww] = await this.load();
    return (
      firstOutput(await ww.run({ 'x.1': new ort.Tensor('float32', features, [1, 16, 96]) }))[0] ?? 0
    );
  }

  private load(): Promise<[OrtSession, OrtSession, OrtSession]> {
    if (!this.sessions) {
      const ort = loadOrt();
      const pending = Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- asset ของ Metro ต้อง require แบบ static
        loadSession(ort, require('../../../../assets/models/melspectrogram.onnx') as number),
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- asset ของ Metro ต้อง require แบบ static
        loadSession(ort, require('../../../../assets/models/embedding_model.onnx') as number),
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- asset ของ Metro ต้อง require แบบ static
        loadSession(ort, require('../../../../assets/models/hey_jarvis_v0.1.onnx') as number),
      ]);
      pending.catch(() => {
        if (this.sessions === pending) this.sessions = null; // โหลดไม่สำเร็จ → รอบหน้าลองใหม่
      });
      this.sessions = pending;
    }
    return this.sessions;
  }
}
