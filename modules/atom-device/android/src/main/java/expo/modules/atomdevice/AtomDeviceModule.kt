package expo.modules.atomdevice

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.roundToInt

/**
 * ADR-015 ระดับ A: สิ่งที่ expo ไม่มีแพ็กเกจให้ — ปรับเสียงสื่อ + ไฟฉาย
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
  }
}
