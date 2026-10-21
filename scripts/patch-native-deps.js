/**
 * แก้ไลบรารี native ที่ build กับ Gradle 9 ไม่ผ่าน — รันอัตโนมัติหลัง `npm install` (postinstall)
 * ไม่ใช้ patch-package (ไม่เพิ่ม dependency) · แก้แบบ idempotent (รันซ้ำได้)
 *
 * - onnxruntime-react-native 1.24.x: `VersionNumber` ถูกถอดออกจาก Gradle 9
 *   → "Could not get unknown property 'VersionNumber'" · โปรเจกต์นี้ RN ≥ 0.71 เสมอ เงื่อนไขนี้จึงเป็นเท็จ
 */
const fs = require('fs');
const path = require('path');

const PATCHES = [
  {
    file: 'node_modules/onnxruntime-react-native/android/build.gradle',
    find: 'VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71")',
    replace: 'false /* atom: Gradle 9 ไม่มี VersionNumber · RN ≥ 0.71 */',
  },
];

for (const { file, find, replace } of PATCHES) {
  const target = path.join(__dirname, '..', file);
  if (!fs.existsSync(target)) continue; // ยังไม่ติดตั้ง / เวอร์ชันใหม่ย้ายไฟล์
  const src = fs.readFileSync(target, 'utf8');
  if (!src.includes(find)) continue; // แก้แล้ว หรือเวอร์ชันใหม่แก้เองแล้ว
  fs.writeFileSync(target, src.split(find).join(replace));
  console.log(`[patch-native-deps] แก้แล้ว: ${file}`);
}
