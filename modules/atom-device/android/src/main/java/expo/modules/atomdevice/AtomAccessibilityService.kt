package expo.modules.atomdevice

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * ADR-015 ระดับ B: ให้ A.T.O.M. กด/พิมพ์/อ่านจอแทนบอสได้ทุกแอป
 *
 * บอสต้องเปิดเองที่ ตั้งค่าเครื่อง › การช่วยเหลือพิเศษ › A.T.O.M. (OS ไม่ให้แอปเปิดสิทธิ์นี้เอง)
 * ไม่ฟัง event ใด ๆ — ทำงานเมื่อ AtomDeviceModule เรียกเท่านั้น (ไม่เก็บ/ส่งเนื้อหาหน้าจอไปไหน)
 * ทุกฟังก์ชันคืนรหัสผลเป็น string แทน throw เพราะ exception ข้าม bridge ถูก expo ห่อเป็นข้อความอังกฤษ
 */
class AtomAccessibilityService : AccessibilityService() {
  companion object {
    /** service ที่บอสเปิดไว้ — null = ยังไม่ได้เปิดสิทธิ์ (หรือระบบปิดไป) */
    @Volatile
    var instance: AtomAccessibilityService? = null
      private set

    private const val MAX_SCREEN_CHARS = 4000
    private const val MAX_DEPTH = 40
  }

  override fun onServiceConnected() {
    instance = this
  }

  override fun onUnbind(intent: Intent?): Boolean {
    instance = null
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    instance = null
    super.onDestroy()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

  override fun onInterrupt() {}

  /** back / home / recents / notifications / quick_settings / lock / screenshot */
  fun global(name: String): Boolean {
    val action = when (name) {
      "back" -> GLOBAL_ACTION_BACK
      "home" -> GLOBAL_ACTION_HOME
      "recents" -> GLOBAL_ACTION_RECENTS
      "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
      "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
      // ล็อกจอ / แคปจอ มีตั้งแต่ Android 9
      "lock" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) GLOBAL_ACTION_LOCK_SCREEN else return false
      "screenshot" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) GLOBAL_ACTION_TAKE_SCREENSHOT else return false
      else -> return false
    }
    return performGlobalAction(action)
  }

  /**
   * กดสิ่งที่มีข้อความ (หรือ content description) ตรงกับ [text] บนจอที่อยู่หน้าสุด
   * @return "ok" | "no_window" | "not_found" | "not_clickable" | "failed"
   */
  fun tapText(text: String): String {
    val root = rootInActiveWindow ?: return "no_window"
    val target = root.findAccessibilityNodeInfosByText(text).firstOrNull { it.isVisibleToUser }
      ?: return "not_found"
    // ข้อความมักอยู่ใน TextView ที่กดไม่ได้ ตัวที่กดได้คือ parent (ปุ่ม/แถวในรายการ)
    var node: AccessibilityNodeInfo? = target
    while (node != null && !node.isClickable) node = node.parent
    val clickable = node ?: return "not_clickable"
    return if (clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) "ok" else "failed"
  }

  /**
   * ใส่ข้อความลงช่องที่โฟกัสอยู่ (แทนที่ข้อความเดิมในช่อง)
   * @return "ok" | "no_window" | "no_field" | "failed"
   */
  fun typeText(text: String): String {
    val root = rootInActiveWindow ?: return "no_window"
    val field = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return "no_field"
    val args = Bundle().apply {
      putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
    }
    return if (field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) "ok" else "failed"
  }

  /** ข้อความที่มองเห็นบนจอ บรรทัดละชิ้น (ตัดที่ [MAX_SCREEN_CHARS]) — "" = ไม่มีหน้าต่าง */
  fun readScreen(): String {
    val root = rootInActiveWindow ?: return ""
    val out = StringBuilder()
    fun walk(node: AccessibilityNodeInfo?, depth: Int) {
      if (node == null || depth > MAX_DEPTH || out.length > MAX_SCREEN_CHARS) return
      if (node.isVisibleToUser) {
        val label = node.text?.toString()?.trim().orEmpty()
          .ifEmpty { node.contentDescription?.toString()?.trim().orEmpty() }
        if (label.isNotEmpty()) out.append(label).append('\n')
      }
      for (i in 0 until node.childCount) walk(node.getChild(i), depth + 1)
    }
    walk(root, 0)
    return out.toString().take(MAX_SCREEN_CHARS)
  }
}
