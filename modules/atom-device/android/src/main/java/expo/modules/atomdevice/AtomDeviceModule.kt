package expo.modules.atomdevice

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.roundToInt

/**
 * ADR-015 ระดับ A: สิ่งที่ expo ไม่มีแพ็กเกจให้ — ปรับเสียงสื่อ + ไฟฉาย + เปิดแอปตามชื่อ
 * ระดับ B: ผ่าน [AtomAccessibilityService] — ปุ่มระบบ (ย้อนกลับ/โฮม/…) · กดตามข้อความ · พิมพ์ · อ่านจอ
 * ทั้งสองอย่างไม่ต้องขอ permission (setTorchMode ไม่ต้องใช้ CAMERA ตั้งแต่ API 23)
 * กรณีที่รู้ล่วงหน้า (ไม่มีแฟลช) คืน false แทน throw — exception จาก Function ถูก expo ห่อเป็นข้อความอังกฤษยาว ๆ
 * ฝั่ง JS (DeviceControlBridge) จึงเป็นคนแปลงเป็นข้อความไทย
 */
class AtomDeviceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AtomDevice")

    // STREAM_MUSIC = เสียงเพลง/วิดีโอ/TTS ของผู้ช่วย · FLAG_SHOW_UI ให้บอสเห็นแถบเสียงขึ้นมาว่าเปลี่ยนแล้ว
    Function("setVolume") { level: Double ->
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      val index = (level.coerceIn(0.0, 1.0) * max).roundToInt()
      audio.setStreamVolume(AudioManager.STREAM_MUSIC, index, AudioManager.FLAG_SHOW_UI)
    }

    Function("setTorch") { on: Boolean ->
      val camera = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val id = camera.cameraIdList.firstOrNull {
        camera.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
      } ?: return@Function false
      camera.setTorchMode(id, on)
      true
    }

    // ---- เปิดแอปตามชื่อ (ไม่ต้องใช้ accessibility) — คืนชื่อแอปที่เปิด, "" = ไม่พบ ----
    Function("launchApp") { query: String -> launchApp(query) }

    // ---- ระดับ B ----
    Function("isAccessibilityEnabled") { AtomAccessibilityService.instance != null }

    Function("openAccessibilitySettings") {
      context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    Function("globalAction") { name: String -> AtomAccessibilityService.instance?.global(name) ?: false }

    // รอได้ถึง timeoutMs เพราะใช้คู่กับ "เปิดแอป X แล้วกด Y" — แอปที่เพิ่งเปิดต้องใช้เวลาวาดจอ
    // AsyncFunction รันบน thread ของ module ไม่ใช่ JS thread → sleep ได้โดยไม่ทำให้แอปค้าง
    AsyncFunction("tapText") { text: String, timeoutMs: Int ->
      val deadline = System.currentTimeMillis() + timeoutMs.coerceIn(0, 10_000)
      var result: String
      do {
        result = AtomAccessibilityService.instance?.tapText(text) ?: "no_service"
        if (result == "ok" || result == "no_service") break
        Thread.sleep(250)
      } while (System.currentTimeMillis() < deadline)
      result
    }

    Function("typeText") { text: String -> AtomAccessibilityService.instance?.typeText(text) ?: "no_service" }

    Function("readScreen") { AtomAccessibilityService.instance?.readScreen() }
  }

  private fun launchApp(query: String): String {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return ""
    val pm = context.packageManager
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    @Suppress("DEPRECATION") // ตัวใหม่ (ResolveInfoFlags) มีแค่ API 33+ · ตัวเดิมยังทำงานทุกเวอร์ชัน
    val apps = pm.queryIntentActivities(launcher, 0)
    val label = { info: android.content.pm.ResolveInfo -> info.loadLabel(pm).toString() }
    // ชื่อตรงทั้งคำก่อน แล้วค่อยมีคำนั้นอยู่ในชื่อ ("line" ไม่ควรเปิด "Line Rider" ถ้ามี "LINE")
    val hit = apps.firstOrNull { label(it).lowercase() == q }
      ?: apps.firstOrNull { label(it).lowercase().contains(q) }
      ?: return ""
    val intent = pm.getLaunchIntentForPackage(hit.activityInfo.packageName) ?: return ""
    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    return label(hit)
  }
}
