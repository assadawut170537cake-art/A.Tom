# ส่งมอบ: บิ้ว APK ของ A.T.O.M. (2026-10-21)

งานโค้ดฝั่งฟีเจอร์เสร็จแล้ว ผ่าน `tsc` / `eslint` / `jest` (46 ชุด 1,060 เทสต์) **แต่ยังไม่เคย build หรือรันบนเครื่องจริง**
ขอให้ทีมบิ้ว: build APK → ติดตั้ง → รันรายการตรวจด้านล่าง → รายงานผล (ข้อความ error จริงถ้ามี)

## สิ่งที่เปลี่ยนที่กระทบการ build
**Native dependencies ใหม่ (ต้อง prebuild ใหม่ — `android/` เดิมไม่มีโมดูลเหล่านี้):**
`react-native-webrtc` + `@config-plugins/react-native-webrtc` · `react-native-audio-api` · `expo-speech-recognition` ·
`onnxruntime-react-native` · `expo-calendar` · `expo-contacts` · `expo-location` · `expo-notifications` ·
`expo-image-picker` · `expo-intent-launcher`
- config plugin ทั้งหมดอยู่ใน `app.json` แล้ว (+ permission `SET_ALARM`) — **ไม่ต้องแก้ `android/` ด้วยมือ**
- `metro.config.js` เพิ่ม `onnx` เป็น assetExts · โมเดล ONNX อยู่ใน `assets/models/` (~31 MB รวม: จำเสียง 26.5 MB + คำปลุก 3.7 MB) → APK ใหญ่ขึ้นตามนั้น
- `android/build.log` ล่าสุดของเครื่องนี้ (19 ต.ค.) จบด้วย `BUILD FAILED` — **สาเหตุยังไม่ได้ตรวจ** (ก่อนเพิ่ม native ชุดนี้)
- `modules/atom-device` (Kotlin) ยังไม่เคย build จริงตาม CHANGELOG → ถ้า build ล้ม ให้ดูตรงนี้ด้วย

## คำสั่ง
```bash
npm install
npx expo prebuild -p android --clean
npx expo run:android --variant release      # หรือ eas build -p android --profile preview (APK)
```
- ใช้ `--clean` เพราะ `android/` เดิมถูก prebuild ก่อนเพิ่ม native ใหม่ · ถ้ามี custom plugin (`plugins/withCleartextTraffic`, `withAndroidProjectName`) ล้ม ให้รายงาน
- เพิ่มเลข commit ในหน้าตั้งค่า (ข้อเสนอข้อ ค. ของทีมก่อนหน้า) ถ้าทำได้ — จะได้รู้ว่า APK มาจาก commit ไหน

## รายการตรวจหลังติดตั้ง (บนเครื่องจริง เรียงตามความเสี่ยง)
1. เปิดแอปได้ไหม (native module ใหม่ 10 ตัว: ถ้า crash ตอนเปิด ส่ง logcat)
2. **เสียงสด Gemini:** ตั้งค่า › AI ใส่ Gemini key → กดค้าง Orb → คุยได้ไหม · ใช้หูฟังรอบแรก (Android ไม่มี echo cancellation ออกลำโพง = ปิดไมค์ตอนผู้ช่วยพูด) · ถ้าต่อไม่ได้ ส่งข้อความ error ในแชท (wire format ของ Gemini เขียนจากเอกสารที่ไม่ครบ)
3. **ตัวรู้จำเสียงระบบ** (fallback เมื่อไม่มี key): ตั้ง option `live.engine=system` แล้วลองคุย
4. **ตั้งค่า › ผู้ช่วยส่วนตัว › คำปลุก:** ลงทะเบียน "เฮ่ อะตอม" 6 ครั้ง → ปรับเทียบ → ทดสอบสด 15 วินาที ดูคะแนน · ถ้าตื่นมั่ว/ไม่ตื่น ปรับความไว ± · หรือเลือก "Hey Jarvis" (สำเร็จรูป ตรวจแล้วกับ TTS)
5. **ตั้งค่า › เสียง › เสียงของฉัน:** ลงทะเบียน 20 วินาที (ใช้ได้เฉพาะ Gemini path) · ถ้าตัดเสียงเจ้าของเองบ่อย ลดความเข้มงวด
6. คำสั่งเดี่ยวๆ (ขอสิทธิ์ครั้งแรก): "ตั้งปลุก 6 โมงครึ่ง" · "ตั้งเวลา 10 นาที" · "วันนี้มีนัดอะไรบ้าง" · "โทรหา <ชื่อในรายชื่อ>" · "วันนี้อากาศเป็นไง" · "หาร้านกาแฟใกล้ฉัน" · "วาดรูปแมวใส่หมวก" · "ดูป้ายนี้ให้หน่อย" · "เตือนอีก 2 นาทีให้ปิดเตา" · "ค้นเว็บ ราคาทองวันนี้"
7. Home Assistant (ถ้ามี): ตั้งค่า › ผู้ช่วยส่วนตัว ใส่ URL + token → "เปิดไฟ…"

## สิ่งที่ "ไม่ควรถือว่าผ่าน" จนกว่าจะลองจริง
ความแม่นยำคำปลุก "เฮ่ อะตอม" · ตัวกรองเสียงเจ้าของ (ทดสอบกับ TTS เท่านั้น) · เสียงสดทั้งสองเจ้า · ไฟฉาย/เสียงระบบ (`atom-device`) · ภาพที่สร้างและโมเดลรูปที่ key ใช้ได้

## ไลเซนส์ที่ต้องรู้ก่อนเผยแพร่
โมเดลคำปลุกสำเร็จรูป (openWakeWord) = CC BY-NC-SA 4.0 (ไม่เชิงพาณิชย์) · โมเดลจำเสียง WeSpeaker = CC-BY-4.0 (ต้องให้เครดิต — มีบรรทัดเครดิตในหน้าตั้งค่าแล้ว)

## เอกสารอ้างอิง
`CHANGELOG.md` (Unreleased) · `CLAUDE.md` · `docs/JARVIS_GAP_AUDIT.md` · ความจำส่วนกลาง: Supermemory space `atom_core`
