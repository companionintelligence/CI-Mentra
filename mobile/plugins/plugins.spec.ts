// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/plugins/withConnectedDeviceForegroundService.test.ts. Modified for Companion; see mobile/README.md#attribution.
import { appendPageSizeBlock, setArchitectures } from './withAndroid16KbPageSize';
import { applyConnectedDeviceForegroundService, SDK_SERVICE } from './withConnectedDeviceForegroundService';
import { addPodsDeploymentTargetFloor, MARKER } from './withPodsDeploymentTarget';
import {
  MARKER as SCENE_MARKER,
  removeTemplateWindowSetup,
  SCENE_DELEGATE_SOURCE,
  SCENE_MANIFEST,
} from './withSceneLifecycle';

type Service = { $: Record<string, string> };
type Manifest = { manifest: { $: Record<string, string>; application: Array<{ $: Record<string, string>; service?: Service[] }> } };

function manifestWith(services?: Service[]): Manifest {
  return { manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' }, ...(services ? { service: services } : {}) }] } };
}

describe('withConnectedDeviceForegroundService', () => {
  test('narrows the SDK service to connectedDevice and keeps other services', () => {
    const result = applyConnectedDeviceForegroundService(
      manifestWith([
        {
          $: {
            'android:name': SDK_SERVICE,
            'android:foregroundServiceType': 'dataSync|connectedDevice|location|mediaPlayback|microphone',
            'tools:replace': 'android:exported',
          },
        },
        { $: { 'android:name': 'another.Service' } },
      ]),
    ) as Manifest;
    const services = result.manifest.application[0]?.service ?? [];
    expect(services.find((service) => service.$['android:name'] === SDK_SERVICE)?.$).toEqual({
      'android:name': SDK_SERVICE,
      'android:exported': 'false',
      'android:foregroundServiceType': 'connectedDevice',
      'tools:replace': 'android:exported,android:foregroundServiceType',
    });
    expect(services.some((service) => service.$['android:name'] === 'another.Service')).toBe(true);
    expect(result.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
  });

  test('adds the override when the app manifest has no services yet, and is idempotent', () => {
    const once = applyConnectedDeviceForegroundService(manifestWith()) as Manifest;
    expect(once.manifest.application[0]?.service).toHaveLength(1);
    const twice = applyConnectedDeviceForegroundService(structuredClone(once)) as Manifest;
    expect(twice).toEqual(once);
  });
});

describe('withAndroid16KbPageSize', () => {
  test('limits native builds to 64-bit ABIs', () => {
    expect(setArchitectures([{ type: 'property', key: 'reactNativeArchitectures', value: 'armeabi-v7a,arm64-v8a,x86,x86_64' }])).toEqual([
      { type: 'property', key: 'reactNativeArchitectures', value: 'arm64-v8a,x86_64' },
    ]);
    expect(setArchitectures([])).toEqual([{ type: 'property', key: 'reactNativeArchitectures', value: 'arm64-v8a,x86_64' }]);
  });

  test('appends the lc3Lib 16 KB page flag once', () => {
    const once = appendPageSizeBlock('// root build.gradle\n');
    expect(once).toContain('-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON');
    expect(once).toContain('subproject.name == "lc3Lib"');
    expect(appendPageSizeBlock(once)).toBe(once);
  });
});

describe('withPodsDeploymentTarget', () => {
  const podfile = [
    "target 'Companion' do",
    '  post_install do |installer|',
    '    react_native_post_install(installer, config[:reactNativePath])',
    '  end',
    'end',
    '',
  ].join('\n');

  test('raises every Pods target before React Native post-install runs, once', () => {
    const patched = addPodsDeploymentTargetFloor(podfile);
    expect(patched).toContain(MARKER);
    expect(patched).toContain('installer.pods_project.targets.each');
    expect(patched.indexOf(MARKER)).toBeLessThan(patched.indexOf('react_native_post_install'));
    expect(addPodsDeploymentTargetFloor(patched)).toBe(patched);
  });

  test('fails loudly when the Podfile has no post_install hook', () => {
    expect(() => addPodsDeploymentTargetFloor("target 'Companion' do\nend\n")).toThrow(/post_install/);
  });
});

describe('withSceneLifecycle', () => {
  // Excerpt of the Expo SDK 55 template's AppDelegate.swift.
  const appDelegate = [
    '    reactNativeFactory = factory',
    '',
    '#if os(iOS) || os(tvOS)',
    '    window = UIWindow(frame: UIScreen.main.bounds)',
    '    factory.startReactNative(',
    '      withModuleName: "main",',
    '      in: window,',
    '      launchOptions: launchOptions)',
    '#endif',
    '',
    '    return super.application(application, didFinishLaunchingWithOptions: launchOptions)',
    '',
  ].join('\n');

  test('moves window creation out of the app delegate, once', () => {
    const patched = removeTemplateWindowSetup(appDelegate);
    expect(patched).not.toContain('UIWindow(frame:');
    expect(patched).not.toContain('startReactNative');
    expect(patched).toContain(SCENE_MARKER);
    expect(patched).toContain('return super.application(application, didFinishLaunchingWithOptions: launchOptions)');
    expect(removeTemplateWindowSetup(patched)).toBe(patched);
  });

  test('refuses an app delegate it does not recognise', () => {
    expect(() => removeTemplateWindowSetup('class AppDelegate {}\n')).toThrow(/Expo SDK 55 template/);
  });

  test('declares one window scene served by SceneDelegate', () => {
    expect(SCENE_MANIFEST.UIApplicationSupportsMultipleScenes).toBe(false);
    expect(SCENE_MANIFEST.UISceneConfigurations.UIWindowSceneSessionRoleApplication).toEqual([
      { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate' },
    ]);
    expect(SCENE_DELEGATE_SOURCE).toContain('class SceneDelegate: UIResponder, UIWindowSceneDelegate');
    expect(SCENE_DELEGATE_SOURCE).toContain('factory.startReactNative(withModuleName: "main", in: window');
  });
});
