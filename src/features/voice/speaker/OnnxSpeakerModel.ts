/**
 * @file โหลดโมเดล WeSpeaker ResNet34 (ONNX) ด้วย onnxruntime-react-native — lazy ทั้ง native module และไฟล์โมเดล
 *
 * โมเดล: `assets/models/voxceleb_resnet34_LM.onnx` (26.5 MB) · WeSpeaker, CC-BY-4.0
 *   https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM — ต้องให้เครดิตในหน้า About/ไลเซนส์ของแอป
 * input `feats` [B, T, 80] · output `embs` [B, 256]
 */

import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { NativeModules } from 'react-native';

import { ProviderError } from '../../../core/http/errors';
import { withOnnxGuard } from '../onnxGuard';
import { EMBEDDING_DIM, type SpeakerModel } from './embedding';
import { FBANK_MEL_BINS } from './fbank';

interface OrtTensor {
  data: unknown;
}
interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
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
      'speaker',
      'unsupported',
      'ระบบจำเสียงต้องใช้ development build (ไม่มี onnxruntime-react-native ในแอปนี้) — build ใหม่ด้วย expo run:android',
    );
  }
}

/**
 * มี native module ONNX ใน build นี้ไหม — ดูแค่ว่ามี module ลงทะเบียนไว้ **ไม่ require**
 * เพราะ require = `Module.install()` (ติดตั้ง JSI) ทันที · หน้าตั้งค่าเรียกตัวนี้ตอน render
 * ถ้า install มีปัญหาบนเครื่อง (สงสัยว่าทำแอปเด้งตอนเปิดหน้าเสียง 2026-10-21) จะไม่ลากหน้าตั้งค่าพังไปด้วย
 */
export function isOnnxAvailable(): boolean {
  return NativeModules.Onnxruntime != null;
}

export class OnnxSpeakerModel implements SpeakerModel {
  private session: Promise<OrtSession> | null = null;

  /** โหลดโมเดลล่วงหน้า (เรียกก่อนเริ่มสาย เพื่อไม่ให้คำแรกช้า) */
  warmUp(): Promise<void> {
    return this.getSession().then(() => undefined);
  }

  async embed(feats: Float32Array, frames: number): Promise<Float32Array> {
    const session = await this.getSession(); // ก่อน loadOrt: require/install อยู่ใต้ onnxGuard
    const ort = loadOrt();
    const input = new ort.Tensor('float32', feats, [1, frames, FBANK_MEL_BINS]);
    const result = await session.run({ feats: input });
    const data = result.embs?.data;
    if (!(data instanceof Float32Array) || data.length !== EMBEDDING_DIM) {
      throw new ProviderError('speaker', 'server', 'โมเดลจำเสียงคืนค่าผิดรูปแบบ');
    }
    return data;
  }

  private getSession(): Promise<OrtSession> {
    if (!this.session) {
      const pending = withOnnxGuard('speaker', () => this.load());
      // โหลดไม่สำเร็จ → รอบหน้าลองใหม่ได้ (ไม่แคช error)
      pending.catch(() => {
        if (this.session === pending) this.session = null;
      });
      this.session = pending;
    }
    return this.session;
  }

  private async load(): Promise<OrtSession> {
    const ort = loadOrt();
    const asset = Asset.fromModule(
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- asset ของ Metro ต้อง require แบบ static
      require('../../../../assets/models/voxceleb_resnet34_LM.onnx') as number,
    );
    await asset.downloadAsync();
    if (!asset.localUri) throw new ProviderError('speaker', 'server', 'ไม่พบไฟล์โมเดลจำเสียงในแอป');
    const bytes = new Uint8Array(await new File(asset.localUri).arrayBuffer());
    return ort.InferenceSession.create(bytes);
  }
}

/** ใช้ร่วมกันทั้งแอป (โมเดลโหลดครั้งเดียว) */
export const speakerModel = new OnnxSpeakerModel();
