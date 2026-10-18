/**
 * @file ทางเข้า A.T.O.M. จากนอกแอป (Android) — ไม่เพิ่ม dependency, ใช้ config-plugins ที่มากับ expo
 *
 * 1. **ผู้ช่วยดิจิทัล**: MainActivity รับ ACTION_ASSIST (กดค้างปุ่มโฮม / ปัดมุมจอ เมื่อเลือก A.T.O.M. ใน
 *    ตั้งค่าเครื่อง › แอปเริ่มต้น › แอปผู้ช่วยดิจิทัล) และ VOICE_COMMAND (ปุ่มหูฟัง) → แปลงเป็น `atom://live`
 *    ใน onCreate/onNewIntent เพื่อให้ JS อ่านได้ผ่าน Linking (ไม่ต้องเขียน native module)
 * 2. **ทางลัด** (กดค้างไอคอนแอป): คุยด้วยเสียง · แชทใหม่ · วันนี้
 * 3. **Widget หน้าจอหลัก**: ปุ่ม คุยด้วยเสียง / แชท / วันนี้ — RemoteViews ล้วน (ไม่ต้องรัน JS)
 *
 * ไม่มี "Hey Atom" (ปลุกด้วยเสียงตอนจอดับ) — Android ให้เฉพาะแอปผู้ช่วยของระบบ (VoiceInteractionService +
 * สิทธิ์ hotword ที่ Google ไม่ให้แอปทั่วไป) ฟังไมค์ตลอดเวลาจะโดนระบบปิดและเปลืองแบต
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, withMainActivity } = require('expo/config-plugins');

const SCHEME = 'atom';

function mainActivityOf(manifest) {
  const app = manifest.manifest.application?.[0];
  return app?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
}

function withAssistManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = manifest.manifest.application?.[0];
    const activity = mainActivityOf(manifest);
    if (!app || !activity) throw new Error('[withAssistantEntry] ไม่พบ MainActivity ใน AndroidManifest');

    activity['intent-filter'] = activity['intent-filter'] ?? [];
    const hasAssist = activity['intent-filter'].some((f) =>
      (f.action ?? []).some((a) => a.$['android:name'] === 'android.intent.action.ASSIST')
    );
    if (!hasAssist) {
      activity['intent-filter'].push({
        action: [
          { $: { 'android:name': 'android.intent.action.ASSIST' } },
          { $: { 'android:name': 'android.intent.action.VOICE_COMMAND' } },
        ],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      });
    }

    activity['meta-data'] = (activity['meta-data'] ?? []).filter((m) => m.$['android:name'] !== 'android.app.shortcuts');
    activity['meta-data'].push({ $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/atom_shortcuts' } });

    app.receiver = (app.receiver ?? []).filter((r) => r.$['android:name'] !== '.AtomWidgetProvider');
    app.receiver.push({
      $: { 'android:name': '.AtomWidgetProvider', 'android:exported': 'false', 'android:label': '@string/atom_widget_label' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
      'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': '@xml/atom_widget_info' } }],
    });
    return cfg;
  });
}

const ASSIST_IMPORTS = ['import android.content.Intent', 'import android.net.Uri'];

const ASSIST_METHODS = `
  override fun onNewIntent(intent: Intent) {
    normalizeAssistIntent(intent)
    super.onNewIntent(intent)
  }

  /** กดค้างปุ่มโฮม (ASSIST) / ปุ่มหูฟัง (VOICE_COMMAND) → atom://live ให้ฝั่ง JS เปิดโหมดคุยด้วยเสียง */
  private fun normalizeAssistIntent(intent: Intent?) {
    val action = intent?.action ?: return
    if (action == Intent.ACTION_ASSIST || action == Intent.ACTION_VOICE_COMMAND) {
      intent.action = Intent.ACTION_VIEW
      intent.data = Uri.parse("${SCHEME}://live")
    }
  }
`;

function withAssistMainActivity(config) {
  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (cfg.modResults.language !== 'kt') throw new Error('[withAssistantEntry] รองรับเฉพาะ MainActivity.kt');
    if (src.includes('normalizeAssistIntent')) return cfg;
    for (const line of ASSIST_IMPORTS) {
      if (!src.includes(line)) src = src.replace(/^(package [^\n]+\n)/, `$1\n${line}`);
    }
    // ก่อน super.onCreate — React อ่าน intent ตอนสร้าง ReactRootView
    src = src.replace(/(override fun onCreate\(savedInstanceState: Bundle\?\) \{\n)/, '$1    normalizeAssistIntent(intent)\n');
    src = src.replace(/\n}\s*$/, `\n${ASSIST_METHODS}}\n`);
    cfg.modResults.contents = src;
    return cfg;
  });
}

const xmlFiles = (pkg) => ({
  'values/atom_entry_strings.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="atom_widget_label">A.T.O.M.</string>
  <string name="atom_shortcut_live">คุยด้วยเสียง</string>
  <string name="atom_shortcut_new">แชทใหม่</string>
  <string name="atom_shortcut_today">วันนี้</string>
</resources>
`,
  'xml/atom_shortcuts.xml': `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${[
  ['live', 'atom_shortcut_live'],
  ['new', 'atom_shortcut_new'],
  ['today', 'atom_shortcut_today'],
]
  .map(
    ([route, label]) => `  <shortcut android:shortcutId="${route}" android:enabled="true" android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/${label}">
    <intent android:action="android.intent.action.VIEW" android:data="${SCHEME}://${route}" android:targetPackage="${pkg}" android:targetClass="${pkg}.MainActivity" />
  </shortcut>`
  )
  .join('\n')}
</shortcuts>
`,
  'xml/atom_widget_info.xml': `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
  android:minWidth="250dp"
  android:minHeight="40dp"
  android:targetCellWidth="4"
  android:targetCellHeight="1"
  android:resizeMode="horizontal"
  android:widgetCategory="home_screen"
  android:updatePeriodMillis="0"
  android:initialLayout="@layout/atom_widget"
  android:previewLayout="@layout/atom_widget" />
`,
  'drawable/atom_widget_bg.xml': `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="#E605060A" />
  <corners android:radius="24dp" />
  <stroke android:width="1dp" android:color="#33FFFFFF" />
</shape>
`,
  'drawable/atom_widget_button.xml': `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="#1FFFFFFF" />
  <corners android:radius="18dp" />
</shape>
`,
  'layout/atom_widget.xml': `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent"
  android:layout_height="match_parent"
  android:background="@drawable/atom_widget_bg"
  android:gravity="center_vertical"
  android:orientation="horizontal"
  android:padding="6dp">
${[
  ['atom_widget_talk', '🎙  คุยด้วยเสียง', '2'],
  ['atom_widget_chat', '💬  แชท', '1'],
  ['atom_widget_today', '📅  วันนี้', '1'],
]
  .map(
    ([id, text, weight]) => `  <TextView
    android:id="@+id/${id}"
    android:layout_width="0dp"
    android:layout_height="match_parent"
    android:layout_margin="3dp"
    android:layout_weight="${weight}"
    android:background="@drawable/atom_widget_button"
    android:gravity="center"
    android:maxLines="1"
    android:text="${text}"
    android:textColor="#FFFFFFFF"
    android:textSize="14sp" />`
  )
  .join('\n')}
</LinearLayout>
`,
});

const widgetProvider = (pkg) => `package ${pkg}

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/** Widget หน้าจอหลักของ A.T.O.M. — ปุ่มเปิดลิงก์ ${SCHEME}://… (สร้างโดย plugins/withAssistantEntry.js) */
class AtomWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, widgetIds: IntArray) {
    for (widgetId in widgetIds) {
      val views = RemoteViews(context.packageName, R.layout.atom_widget)
      views.setOnClickPendingIntent(R.id.atom_widget_talk, open(context, "live", 1))
      views.setOnClickPendingIntent(R.id.atom_widget_chat, open(context, "chat", 2))
      views.setOnClickPendingIntent(R.id.atom_widget_today, open(context, "today", 3))
      manager.updateAppWidget(widgetId, views)
    }
  }

  private fun open(context: Context, route: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("${SCHEME}://" + route), context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }
}
`;

function withAssistFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const pkg = cfg.android?.package;
      if (!pkg) throw new Error('[withAssistantEntry] ต้องตั้ง android.package ใน app.json');
      const root = cfg.modRequest.platformProjectRoot;
      const res = path.join(root, 'app/src/main/res');
      for (const [rel, content] of Object.entries(xmlFiles(pkg))) {
        const file = path.join(res, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
      }
      const javaDir = path.join(root, 'app/src/main/java', ...pkg.split('.'));
      fs.mkdirSync(javaDir, { recursive: true });
      fs.writeFileSync(path.join(javaDir, 'AtomWidgetProvider.kt'), widgetProvider(pkg));
      return cfg;
    },
  ]);
}

module.exports = function withAssistantEntry(config) {
  return withAssistFiles(withAssistMainActivity(withAssistManifest(config)));
};
