/**
 * @file บังคับ JVM ของ Gradle ใช้ locale อังกฤษ (ปฏิทินเกรกอเรียน)
 *
 * Windows ที่ตั้งภูมิภาคเป็นไทย → Java ได้ปฏิทินพุทธ (ปี 2569) → AGP เขียนวันที่ลง zip แบบ MS-DOS
 * ซึ่งรับได้แค่ปี 1980–2107 → `MsDosDateTimeUtils.packDate` โยน VerifyException (ไม่มีข้อความ)
 * ที่ `mergeReleaseJavaResource` ทุกครั้ง · ไม่กระทบภาษาในแอป (เปลี่ยนแค่ JVM ตอน build)
 * ต้องเป็น config plugin เพราะ android/ ถูกสร้างใหม่ทุกครั้งที่ `expo prebuild --clean`
 */
const { withGradleProperties } = require('expo/config-plugins');

const JVM_ARGS_KEY = 'org.gradle.jvmargs';
const LOCALE_FLAGS = '-Duser.language=en -Duser.country=US';

module.exports = function withGregorianBuildLocale(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const entry = props.find((p) => p.type === 'property' && p.key === JVM_ARGS_KEY);
    if (!entry) {
      props.push({ type: 'property', key: JVM_ARGS_KEY, value: LOCALE_FLAGS });
    } else if (!entry.value.includes('-Duser.language=')) {
      entry.value = `${entry.value} ${LOCALE_FLAGS}`;
    }
    return cfg;
  });
};
