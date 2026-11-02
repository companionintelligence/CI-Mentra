import type { ConfigContext, ExpoConfig } from 'expo/config';

import appConfig, { ANDROID_BLOCKED_PERMISSIONS, ANDROID_PERMISSIONS, APP_ID } from './app.config';

function resolve(): ExpoConfig {
  return appConfig({ config: {} } as ConfigContext);
}

function pluginOptions(config: ExpoConfig, name: string): Record<string, unknown> | undefined {
  const entry = config.plugins?.find((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === name);
  return Array.isArray(entry) ? (entry[1] as Record<string, unknown>) : undefined;
}

describe('app config', () => {
  const originalBundleId = process.env.COMPANION_IOS_BUNDLE_ID;
  afterEach(() => {
    if (originalBundleId === undefined) {
      delete process.env.COMPANION_IOS_BUNDLE_ID;
    } else {
      process.env.COMPANION_IOS_BUNDLE_ID = originalBundleId;
    }
  });

  test('identity follows the com.companionintelligence.<product> convention', () => {
    delete process.env.COMPANION_IOS_BUNDLE_ID;
    const config = resolve();
    expect(config.name).toBe('Companion');
    expect(APP_ID).toBe('com.companionintelligence.mentra');
    expect(config.ios?.bundleIdentifier).toBe(APP_ID);
    expect(config.android?.package).toBe(APP_ID);
  });

  test('a different Apple team can override only the iOS bundle id', () => {
    process.env.COMPANION_IOS_BUNDLE_ID = ' com.example.companion ';
    const config = resolve();
    expect(config.ios?.bundleIdentifier).toBe('com.example.companion');
    expect(config.android?.package).toBe(APP_ID);
  });

  test('meets the SDK platform floors and the ONNX Runtime packaging rule', () => {
    const buildProperties = pluginOptions(resolve(), 'expo-build-properties') as {
      ios: { deploymentTarget: string };
      android: { minSdkVersion: number; packagingOptions: { pickFirst: string[] } };
    };
    expect(Number.parseFloat(buildProperties.ios.deploymentTarget)).toBeGreaterThanOrEqual(15.1);
    expect(buildProperties.android.minSdkVersion).toBeGreaterThanOrEqual(28);
    expect(buildProperties.android.packagingOptions.pickFirst).toEqual(
      expect.arrayContaining(['**/libc++_shared.so', '**/libonnxruntime.so', '**/libonnxruntime4j_jni.so']),
    );
  });

  test('SDK plugin is configured with analytics off', () => {
    expect(pluginOptions(resolve(), '@mentra/bluetooth-sdk')).toEqual({ node: true, analytics: false });
  });

  test('iOS declares only the purpose strings and background mode the app needs', () => {
    const infoPlist = resolve().ios?.infoPlist ?? {};
    expect(infoPlist.NSBluetoothAlwaysUsageDescription).toMatch(/Bluetooth.*glasses/);
    expect(infoPlist.UIBackgroundModes).toEqual(['bluetooth-central']);
    const purposeStrings = Object.keys(infoPlist).filter((key) => key.endsWith('UsageDescription')).sort();
    expect(purposeStrings).toEqual(['NSBluetoothAlwaysUsageDescription', 'NSMicrophoneUsageDescription']);
  });

  test('Android requests Bluetooth and location only, and blocks unused foreground-service types', () => {
    const android = resolve().android;
    expect(android?.permissions).toEqual(ANDROID_PERMISSIONS);
    expect(ANDROID_PERMISSIONS.join(' ')).not.toMatch(/CAMERA|RECORD_AUDIO|POST_NOTIFICATIONS|BACKGROUND_LOCATION/);
    expect(android?.blockedPermissions).toEqual(ANDROID_BLOCKED_PERMISSIONS);
    expect(ANDROID_BLOCKED_PERMISSIONS).not.toContain('android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE');
    expect(resolve().plugins).toContain('./plugins/withConnectedDeviceForegroundService');
  });

  test('keeps the Xcode 27 / iOS 27 fixes', () => {
    expect(resolve().plugins).toEqual(
      expect.arrayContaining(['./plugins/withPodsDeploymentTarget', './plugins/withSceneLifecycle']),
    );
  });

  test('icon, adaptive icon and splash point at the brand mark assets', () => {
    const config = resolve();
    expect(config.icon).toBe('./assets/icon.png');
    expect(config.android?.adaptiveIcon).toEqual({
      foregroundImage: './assets/adaptive-icon.png',
      monochromeImage: './assets/adaptive-icon-monochrome.png',
      backgroundColor: '#041620',
    });
    expect(config.splash).toEqual({
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#f3faf7',
      dark: { image: './assets/splash-icon-dark.png', backgroundColor: '#041620' },
    });
  });
});
