/**
 * @file เปิด http (cleartext) ใน release build Android
 *
 * Sync server ของ Mark 55 อยู่ใน LAN/Tailscale เป็น http — release build บล็อก http เป็นค่าเริ่มต้น
 * ใช้ config-plugins ที่มากับ expo อยู่แล้ว (ไม่ต้องเพิ่ม expo-build-properties)
 * โค้ดแอปยังจำกัด http ไว้แค่ LAN/localhost/.local/Tailscale (normalizeServerUrl)
 */
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return cfg;
  });
};
