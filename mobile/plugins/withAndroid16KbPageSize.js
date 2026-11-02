// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/plugins/withAndroid16KbPageSize.js. Modified for Companion; see mobile/README.md#attribution.
const { withGradleProperties, withProjectBuildGradle } = require('expo/config-plugins');

const ARCHITECTURES = 'arm64-v8a,x86_64';

// The SDK's lc3Lib native module is compiled from source during the app build. Google Play
// requires native libraries in apps targeting Android 15+ to support 16 KB memory pages, so
// pass the NDK flag that aligns them.
const CONFIG_BLOCK = `
// Keep release APK native libraries compatible with Android's 16 KB page-size devices.
subprojects { subproject ->
  subproject.plugins.withId("com.android.library") {
    if (subproject.name == "lc3Lib") {
      subproject.android.defaultConfig.externalNativeBuild.cmake.arguments(
        "-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON"
      )
    }
  }
}
`;

/** 64-bit ABIs only: arm64-v8a for phones, x86_64 for emulators. */
function setArchitectures(properties) {
  const property = properties.find((item) => item.type === 'property' && item.key === 'reactNativeArchitectures');
  if (property) {
    property.value = ARCHITECTURES;
  } else {
    properties.push({ type: 'property', key: 'reactNativeArchitectures', value: ARCHITECTURES });
  }
  return properties;
}

function appendPageSizeBlock(contents) {
  return contents.includes(CONFIG_BLOCK.trim()) ? contents : contents + CONFIG_BLOCK;
}

module.exports = function withAndroid16KbPageSize(config) {
  config = withGradleProperties(config, (gradleConfig) => {
    gradleConfig.modResults = setArchitectures(gradleConfig.modResults);
    return gradleConfig;
  });

  return withProjectBuildGradle(config, (gradleConfig) => {
    gradleConfig.modResults.contents = appendPageSizeBlock(gradleConfig.modResults.contents);
    return gradleConfig;
  });
};

module.exports.setArchitectures = setArchitectures;
module.exports.appendPageSizeBlock = appendPageSizeBlock;
