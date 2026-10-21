const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
// โมเดลจำเสียง ONNX ฝังไปกับแอปเป็น asset
config.resolver.assetExts.push('onnx');

module.exports = withNativeWind(config, { input: './global.css' });
