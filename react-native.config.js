/**
 * ลิงก์ native module ที่ autolinking ของ Expo หาไม่เจอเอง
 *
 * onnxruntime-react-native (จำเสียง / คำปลุก): android/ ของไลบรารีไม่มี namespace/package ให้ autolinking อ่าน
 * → ไม่ถูกใส่ใน PackageList → `NativeModules.Onnxruntime` = null → "Cannot read property 'install' of null"
 * และแอปเด้ง (Boss เจอ 2026-10-21) · บอกชื่อ package เองที่นี่ (ไม่ต้องแก้ไฟล์ใน node_modules)
 */
module.exports = {
  dependencies: {
    'onnxruntime-react-native': {
      platforms: {
        android: {
          packageName: 'ai.onnxruntime.reactnative',
          packageImportPath: 'import ai.onnxruntime.reactnative.OnnxruntimePackage;',
          packageInstance: 'new OnnxruntimePackage()',
        },
      },
    },
  },
};
