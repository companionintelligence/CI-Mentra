// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/app.json and app.config.js. Modified for Companion; see mobile/README.md#attribution.
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Companion: phone app for Mentra Live smart glasses on the Mentra Bluetooth SDK 3.3.0.
 * The native ios/ and android/ projects are generated from this file by `npx expo prebuild`
 * and are not committed.
 */

/** Same `com.companionintelligence.<product>` scheme as the Spellbook, Atlas and Planning apps. */
export const APP_ID = 'com.companionintelligence.mentra';

/**
 * Apple App IDs are globally unique. To sign a device build under a different Apple team, set
 * COMPANION_IOS_BUNDLE_ID before prebuild. Simulator builds are unsigned and need nothing.
 */
function iosBundleIdentifier(): string {
  return process.env.COMPANION_IOS_BUNDLE_ID?.trim() || APP_ID;
}

export const BLUETOOTH_USAGE =
  'Companion uses Bluetooth to find your smart glasses, connect to them, and show their status.';

/**
 * Never prompted for in this version. The SDK compiled into the app contains a phone-microphone
 * path (ios/Source/services/PhoneMic.swift), so the purpose string is declared up front: iOS
 * terminates an app that opens the microphone without one, and App Store Connect can flag a
 * binary that references microphone APIs without it (ITMS-90683).
 */
export const MICROPHONE_USAGE =
  'Companion uses the microphone only when you turn on a voice feature for your glasses.';

/** Runtime permissions the app requests, and only when the user scans or connects. */
export const ANDROID_PERMISSIONS = [
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
];

/**
 * Permissions removed from the merged manifest: the foreground-service types the SDK manifest
 * declares but this Bluetooth-only app never starts (see plugins/withConnectedDeviceForegroundService),
 * and Expo template defaults the app has no use for (it stores its one file in app-private storage
 * and draws no overlays; debug builds keep SYSTEM_ALERT_WINDOW through the debug manifest).
 */
export const ANDROID_BLOCKED_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Companion',
  slug: 'companion-mentra',
  // Redirect scheme for the CI-Portal sign-in (companion://oidc/callback). Same scheme as Companion Memory.
  scheme: 'companion',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: iosBundleIdentifier(),
    buildNumber: '1',
    supportsTablet: false,
    infoPlist: {
      NSBluetoothAlwaysUsageDescription: BLUETOOTH_USAGE,
      NSMicrophoneUsageDescription: MICROPHONE_USAGE,
      // Keeps the glasses link and its events alive while the phone is locked.
      UIBackgroundModes: ['bluetooth-central'],
    },
  },
  android: {
    package: APP_ID,
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#041620',
    },
    permissions: ANDROID_PERMISSIONS,
    blockedPermissions: ANDROID_BLOCKED_PERMISSIONS,
  },
  plugins: [
    [
      '@mentra/bluetooth-sdk',
      {
        // Lets Gradle and Xcode find Node when launched outside a shell (Android Studio, Xcode).
        node: true,
        // Unless the host app opts out, the SDK sends usage events to Mentra's PostHog project,
        // tagged with an install ID and the glasses model, serial number and build number.
        // Companion is local-first, so this is off.
        analytics: false,
      },
    ],
    [
      'expo-build-properties',
      {
        ios: {
          deploymentTarget: '15.1',
        },
        android: {
          minSdkVersion: 28,
          packagingOptions: {
            // Required by the SDK: avoids duplicate native libraries from its audio and
            // transcription stack (ONNX Runtime).
            pickFirst: ['**/libc++_shared.so', '**/libonnxruntime.so', '**/libonnxruntime4j_jni.so'],
          },
        },
      },
    ],
    'expo-secure-store',
    'expo-web-browser',
    './plugins/withAndroid16KbPageSize',
    './plugins/withConnectedDeviceForegroundService',
    './plugins/withPodsDeploymentTarget',
    './plugins/withSceneLifecycle',
  ],
});
