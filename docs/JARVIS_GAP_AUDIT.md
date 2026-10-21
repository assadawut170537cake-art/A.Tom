# ตรวจช่องว่าง: Jarvis (ceo.jarvis.voice v0.4.2) เทียบกับ A.T.O.M.

ตรวจเมื่อ 2026-10-21 จากการถอดสตริงของ Hermes bundle (`index.android.bundle`) และ `app.config` ในไฟล์ `.apks`
ยัง **ไม่ได้ถอดโค้ด JS** (rn-reverse อ่านไฟล์นอกโฟลเดอร์ที่อนุญาตไม่ได้) จึงยืนยันได้แค่ "มีฟีเจอร์นี้" จากชื่อ tool / ข้อความ /
สิทธิ์ ไม่ใช่รายละเอียดการทำงาน · ชื่อ tool ที่เจอ: `set_timer set_alarm get_agenda create_event get_location
list_entities call_service list_lights turn_on turn_off generate_image create_agent update_persona remember_this
forget_that read_clipboard open_app open_url open_settings read_file create_file update_file list_files search_tool list_connectors`

> **อัปเดต 2026-10-21:** ข้อ 1–7, 9, 11 และ "ผู้ช่วยที่สร้างเอง" (ข้อ 8 แบบเรียกทีละคำสั่ง ไม่ใช่ persona ตัวที่ 5) + คำปลุก "เฮ่ อะตอม"/"Hey Jarvis"
> **ทำแล้วในโค้ด** (`src/features/assistant`, `src/features/voice/wakeword`) — ยังไม่ได้ build/ทดสอบบนเครื่องจริง · ที่ยังไม่ทำ: ไฟล์เป็น tool (10), Connectors OAuth (13), สตรีมวิดีโอเข้า Gemini Live (11 แบบสตรีม; ตอนนี้ถ่ายครั้งละภาพ)

## ที่เขามี แต่ของเรายังไม่มี (เรียงตามคุ้มค่า) — สถานะเดิมก่อนอัปเดต

| # | ฟีเจอร์ | หลักฐานในต้นฉบับ | ใช้ของสำเร็จรูป | งาน |
|---|---|---|---|---|
| 1 | **ค้นเว็บ** | ข้อความ "web search needs billing enabled on Gemini key" | Google Search grounding ของ Gemini (Live: `googleSearch` tool — **เพิ่มแล้วใน setup**; REST `GeminiAdapter`: ยังไม่ได้เพิ่ม) | เล็ก |
| 2 | **Home Assistant** (ไฟ/สวิตช์/ฉาก) | `list_entities call_service list_lights turn_on turn_off` + สตริง Home Assistant 70+ แห่ง | REST API ของ Home Assistant + long-lived token (ไม่ต้องเขียนโปรโตคอลอุปกรณ์เอง) | กลาง |
| 3 | **ปฏิทิน** | `get_agenda create_event` + สิทธิ์ READ/WRITE_CALENDAR | `expo-calendar` | กลาง |
| 4 | **ปลุก/ตั้งเวลา** | `set_alarm set_timer` + สิทธิ์ SET_ALARM | Android Intent (`expo-intent-launcher`: ACTION_SET_ALARM / SET_TIMER) | เล็ก |
| 5 | **รายชื่อ/โทรออก** | สิทธิ์ READ/WRITE_CONTACTS, CALL_PHONE | `expo-contacts` + `Linking` (`tel:`) | เล็ก–กลาง |
| 6 | **ตำแหน่ง/อากาศ/ใกล้ฉัน** | `get_location`, "weather/nearby searches without asking" | `expo-location` + Open-Meteo (ฟรี ไม่ต้อง key) | กลาง |
| 7 | **สร้าง/แก้รูป** | `generate_image`, `/v1/images/generations`, `/images/edit` | Gemini image / OpenAI images API | กลาง |
| 8 | **ผู้ช่วยที่ผู้ใช้สร้างเอง/แชร์** | `create_agent update_persona` + หน้า gallery/share | — (เรามี persona ตายตัว 4 ตัว) | ใหญ่ |
| 9 | **แจ้งเตือนเชิงรุก (nudge)** | ข้อความ push "Still thinking…" | `expo-notifications` | กลาง |
| 10 | **ไฟล์เป็น tool** | `read_file create_file update_file list_files` | `expo-file-system` (ต้องจำกัดโฟลเดอร์) | เล็ก |
| 11 | **กล้อง/วิสัยทัศน์** | สิทธิ์ CAMERA | ส่งเฟรมภาพเข้า Gemini Live (`realtimeInput.video`) | กลาง |
| 12 | **อ่านคลิปบอร์ด** | `read_clipboard` | `expo-clipboard` (มีฝั่งเขียนอยู่แล้ว) | เล็ก |
| 13 | **Connectors (OAuth)** | `list_connectors` | เรามี MCP bridge ครอบบางส่วน | กลาง |

## ที่ไม่ต้องทำ (เป็นเรื่องของแอปเชิงพาณิชย์)
Paywall / นาทีเสียงรายเดือน (RevenueCat) · UI หลายภาษา 15+ ภาษา · analytics/Sentry · Sign in with Apple · onboarding
ทั้งหมดเป็นของแอปที่ขายให้คนทั่วไป ไม่ใช่ปัญหาของแอปส่วนตัว

## ที่เราทำได้ดีกว่าหรือมีแต่เรา
- สั่งงาน/ซิงก์กับ PC (Mark 55 bus, `pc-bridge`) · Memory sync (Supermemory, Mark 55) · MCP + Skills + Marketplace
- 4 persona เสียง/บุคลิกแยกกัน · Module Manager · fallback chain หลายผู้ให้บริการ (AI/TTS/STT)
- **ตอบเฉพาะเสียงเจ้าของ** (speaker verification บนเครื่อง) — ต้นฉบับไม่มี
- โหมดเสียงสด 2 เจ้า (Gemini Live / OpenAI Realtime) + ตัวรู้จำเสียงของระบบ + เส้นทางสำรอง

## สิ่งที่ทั้งสองแอปไม่มี
Wake word ("เฮ้ จาร์วิส") — ไม่พบสตริงที่เกี่ยวข้องในต้นฉบับเลย ถ้าต้องการ ใช้ Porcupine / openWakeWord

## ข้อเสนอ
เก็บ 1, 4, 12 ก่อน (เล็ก ได้ผลทันที) แล้ว 2 + 3 + 6 (ชุด "ผู้ช่วยส่วนตัวของจริง") — ทั้งหมดเสียบเป็น tool ให้สมอง `ask_atom`
เรียก ไม่ต้องแตะส่วนเสียง
