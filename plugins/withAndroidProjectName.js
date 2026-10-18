/**
 * @file ตั้งชื่อโปรเจกต์ Gradle เป็น slug
 *
 * prebuild เอา expo.name ("A.T.O.M.") ไปใส่ rootProject.name แต่ Gradle 9 ห้ามชื่อขึ้นต้น/ลงท้ายด้วย "."
 * → build Android ล้ม · ชื่อแอปที่ผู้ใช้เห็นยังมาจาก expo.name (strings.xml) เหมือนเดิม
 */
const { withSettingsGradle } = require('expo/config-plugins');

module.exports = function withAndroidProjectName(config) {
  return withSettingsGradle(config, (cfg) => {
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /rootProject\.name\s*=\s*['"][^'"]*['"]/,
      `rootProject.name = '${config.slug}'`,
    );
    return cfg;
  });
};
