# A.T.O.M. (A.Tom) — Phase 2: Main Screen (Atom tab)

Expo SDK 57 · React Native 0.86 · TypeScript · Zustand (persist) · NativeWind v4 · Reanimated 4 · react-native-webview · lucide-react-native · expo-linear-gradient

## เริ่มใช้งาน

```bash
npm install
npx expo run:android   # หรือ npx expo run:ios
```

แอปใช้ native modules (WebView, Reanimated 4) จึงควรรันเป็น development build (`npx expo run:*` หรือ `eas build --profile development`).

```bash
npm run typecheck      # tsc --noEmit
```

## ลองใช้ (Phase 2 ยังไม่มี STT/TTS/API)

- แตะ Orb กลางจอ (หรือปุ่ม Computer ตรงกลาง) → Orb เปลี่ยนเป็น listening → thinking → speaking แล้วผู้ช่วยทักทาย และสลับเป็นโหมด conversation
- ในโหมด conversation แตะ Orb เล็กด้านบน → กลับโหมด idle เพื่อเปลี่ยนผู้ช่วยจาก dropdown
- แต่ละผู้ช่วยมี chat history แยกกัน (เก็บในหน่วยความจำ ไม่ persist)
- persona, uiMode และแท็บที่เลือก ถูก persist ผ่าน AsyncStorage

## โครงสร้าง

ดู `src/` — ตรงตาม spec: `features/jarvis/{types,constants,stores,components}`, `screens/MainScreen.tsx`, `App.tsx`
Orb HTML (WebGL shader, ไม่พึ่ง CDN) อยู่ใน `src/features/jarvis/constants/orbHtml.ts`

![Orb states](docs/orb-preview.png)
