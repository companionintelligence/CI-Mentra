// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/plugins/withConnectedDeviceForegroundService.js. Modified for Companion; see mobile/README.md#attribution.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const SDK_SERVICE = 'com.mentra.bluetoothsdk.services.ForegroundService';

/**
 * The SDK keeps the glasses link alive in the background with a foreground service. Its library
 * manifest declares the service with five types (dataSync, connectedDevice, location,
 * mediaPlayback, microphone); Android 14+ and Google Play require every declared type to be
 * justified. This app only holds a Bluetooth link to the glasses, so the merged manifest keeps
 * `connectedDevice` alone. The matching FOREGROUND_SERVICE_* permissions for the other four types
 * are listed in `android.blockedPermissions` in app.config.ts.
 */
function applyConnectedDeviceForegroundService(manifest) {
  manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  application.service ??= [];

  let service = application.service.find((item) => item.$['android:name'] === SDK_SERVICE);
  if (!service) {
    service = { $: { 'android:name': SDK_SERVICE } };
    application.service.push(service);
  }
  service.$['android:exported'] = 'false';
  service.$['android:foregroundServiceType'] = 'connectedDevice';
  const replace = new Set((service.$['tools:replace'] || '').split(',').filter(Boolean));
  replace.add('android:foregroundServiceType');
  service.$['tools:replace'] = [...replace].join(',');
  return manifest;
}

module.exports = function withConnectedDeviceForegroundService(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = applyConnectedDeviceForegroundService(mod.modResults);
    return mod;
  });
};

module.exports.applyConnectedDeviceForegroundService = applyConnectedDeviceForegroundService;
module.exports.SDK_SERVICE = SDK_SERVICE;
