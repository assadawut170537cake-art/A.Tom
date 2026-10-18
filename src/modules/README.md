# Modules — วิธีสร้าง module ใหม่ของ A.T.O.M.

module = ความสามารถที่แยกเป็นก้อน เสียบเพิ่ม/ถอด/เปิด/ปิดได้ โดยไม่แตะ core
(ตัวอย่างจริง: `pc-bridge` ที่ `src/features/pc-bridge/`)

> เอกสารนี้เป็นคู่มือ + ตัวอย่างเท่านั้น — `demo-module` ด้านล่าง**ไม่ได้อยู่ในโค้ดแอป**
> และไม่ถูกลงทะเบียนตอน boot

## ภาพรวม

| ชิ้น | อยู่ที่ | หน้าที่ |
|---|---|---|
| `AtomModule` (สัญญา) | `src/core/modules/types.ts` | interface ที่ module ต้อง implement |
| `ModuleRegistry` | `src/core/modules/ModuleRegistry.ts` | ถือ module ที่ลงทะเบียน · init ตามลำดับ dependency · enable/disable (runtime) |
| `ModuleManager` | `src/core/modules/ModuleManager.ts` | ครอบ registry · **จำค่าเปิด/ปิด**ของบอส (AsyncStorage `atom.modules.v1.enabled`) · กฎ dependency |
| `loader.ts` | `src/modules/loader.ts` | ตาราง `id → lazy factory` + `BOOT_MODULES` (อยู่ระดับแอปเพราะต้อง import จาก `features/`) |
| `boot.ts` | `src/boot.ts` | `loadBootModules()` → `moduleManager.start()` |

ทิศทาง dependency: `features/` → `core/` เท่านั้น (`core/` import `features/` ไม่ได้ — `architecture.test.ts` ตรวจให้)

## Interface `AtomModule`

```ts
interface AtomModule {
  readonly id: string;                        // unique + คงที่ เช่น 'pc-bridge'
  readonly name: string;                      // ชื่อที่แสดง
  readonly description?: string | undefined;  // แสดงใน ตั้งค่า › Modules
  readonly enabled: boolean;                  // สถานะเริ่มต้นตอน register (ค่าที่บอสบันทึกไว้ชนะ)
  readonly dependencies?: readonly string[] | undefined; // id ของ module ที่ต้อง init ก่อน
  init(context: ModuleContext): Promise<void> | void;    // context = { memory, logger }
  dispose(): Promise<void> | void;
}
```

- `init()` ล้ม → state เป็น `failed` (แอปไม่ล้ม) · "เริ่มใหม่" ใน ตั้งค่า › Modules ลองใหม่ได้
- module ที่รับคำสั่งจากแชทได้ → implement `CommandModule` (เพิ่ม `execute(command)`) แล้วตอบเป็นข้อความไทยเอง
  (อย่า throw `ProviderError` เพราะแชทจะแนะนำ "ตั้งค่า › AI" ซึ่งผิดที่)

## ขั้นตอนสร้าง module

1. สร้างโฟลเดอร์ `src/features/<id>/` พร้อม `<Name>Module.ts` (class ที่ implement `AtomModule`)
   และ `index.ts` ที่ `export { default } from './<Name>Module'`
2. เพิ่มบรรทัดใน `MODULE_LOADERS` ของ `src/modules/loader.ts`
   — ต้องเป็น `import('...')` ที่ **path เป็น string คงที่** (Metro ไม่รองรับ path ที่ต่อเอง)
3. ถ้าต้องการให้โหลดตอนเปิดแอป → เพิ่ม id ใน `BOOT_MODULES`
4. อย่าเรียก `moduleRegistry.enable/disable()` ตรง ๆ ในโค้ดแอป — ใช้ `moduleManager.enable/disable()` (จำค่า)
5. เขียน test (module ไม่โหลดด้วย `import()` ใน Jest — ส่ง factory ของตัวเองเข้า `loadModule`)

## ตัวอย่าง: `demo-module`

`src/features/demo-module/DemoModule.ts`

```ts
import type { AtomModule, ModuleContext } from '../../core/modules/types';

export const DEMO_MODULE_ID = 'demo-module';

/** module ตัวอย่างขั้นต่ำสุด: จด log ตอน init / dispose (ไม่ทำอะไรกับ memory) */
export class DemoModule implements AtomModule {
  readonly id = DEMO_MODULE_ID;
  readonly name = 'Demo';
  readonly description = 'module ตัวอย่างสำหรับเรียนรู้ระบบ module';
  readonly enabled = false; // ปิดไว้ก่อนเสมอ ให้บอสเปิดเองที่ ตั้งค่า › Modules
  // readonly dependencies = ['pc-bridge']; // ถ้าต้องพึ่ง module อื่น (เปิดตัวนี้ → เปิด dependency ให้อัตโนมัติ)

  private logger: ModuleContext['logger'] | undefined;

  init(context: ModuleContext): void {
    this.logger = context.logger;
    this.logger.info('demo-module พร้อมใช้งาน');
  }

  dispose(): void {
    this.logger?.info('demo-module ปิดแล้ว');
    this.logger = undefined;
  }
}

export default new DemoModule();
```

`src/features/demo-module/index.ts`

```ts
export { default } from './DemoModule';
export { DEMO_MODULE_ID, DemoModule } from './DemoModule';
```

ลงทะเบียนใน `src/modules/loader.ts`

```ts
export const MODULE_LOADERS: Readonly<Record<string, ModuleFactory>> = {
  'pc-bridge': () => import('../features/pc-bridge').then((m) => m.default),
  'demo-module': () => import('../features/demo-module').then((m) => m.default),
};

// ให้โหลดตอน boot (src/boot.ts เรียก loadBootModules() ให้เอง ไม่ต้องแก้ boot.ts)
export const BOOT_MODULES: readonly string[] = ['pc-bridge', 'demo-module'];
```

> `boot.ts` ไม่ต้องแก้: มันเรียก `loadBootModules()` ซึ่งอ่านจาก `BOOT_MODULES` อยู่แล้ว แล้วตามด้วย
> `moduleManager.start()` ที่ใช้ค่าเปิด/ปิดที่บอสบันทึกไว้

## Checklist ก่อนเปิด PR

- [ ] module ตอบ/แสดงข้อความภาษาไทย (comment + error message)
- [ ] `init()` ไม่ throw ออกนอก module โดยไม่จำเป็น และ `dispose()` คืนทรัพยากรครบ (timer / subscription)
- [ ] ค่าลับอยู่ใน SecureStore เท่านั้น · ผ่าน `redactSecrets()` ก่อน log/บันทึก error
- [ ] ข้อความที่จะเข้า prompt ผ่าน `toPromptLine()` (กัน prompt injection — [ADR-014](../../docs/DECISIONS.md))
- [ ] test + `npx tsc --noEmit` + `npx expo lint` ผ่าน
- [ ] อัปเดต CLAUDE.md / CHANGELOG.md
