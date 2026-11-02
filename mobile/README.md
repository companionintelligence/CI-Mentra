# Companion for Mentra Live (mobile app)

A phone companion app for **Mentra Live** smart glasses, for iOS and Android. It talks to
the glasses directly over Bluetooth Low Energy through the **Mentra Bluetooth SDK 3.3.0**
(`@mentra/bluetooth-sdk`), the supported path for phone apps since MentraOS 3.0.

It does not use the old cloud SDK `@mentra/sdk` that the server in `../src` is built on.
That SDK has produced no sessions since MentraOS 3.0 (2026-08-03).

> **Status: v1, not verified on hardware.** The iOS Debug build compiles with Xcode 27 and
> launches in the iOS 27 Simulator. The Android debug and release APKs build with JDK 17, and the
> arm64 release APK installs and launches on an Android 16 (API 36) emulator, where the Glasses
> screen renders. Nothing here has been run against real glasses:
> scanning, pairing, reconnecting and every glasses event are implemented against the SDK's
> documented API, not tested on a device.

## What v1 does

| Area | What the app does |
| --- | --- |
| **Glasses** | Pick a model (Mentra Live by default, or Even Realities G2), scan, and see results as they arrive. You choose the glasses from the list; the app never connects to the first result on its own. Connect, cancel a connection attempt, disconnect, and forget. The last connected glasses are saved, and the app reconnects to them at launch when Bluetooth permission is already granted, or when you tap **Reconnect**. |
| **Lifecycle** | Shows the SDK's typed connection state: *Not connected*, *Searching*, *Connecting*, *Pairing*, *Starting up* (connected, not yet booted) and *Ready* (`fullyBooted`), plus scan progress and result count. Pair failures, "glasses not ready", empty-scan hints from the SDK, permission refusals and unexpected disconnects are shown as notices. |
| **Status** | Battery and charging, firmware (app versions labelled as such), Bluetooth signal, whether a display is available, and, on models documented to report it, Wi-Fi and hotspot state. Read-only. The hotspot password is never shown. |
| **Display** | Send a line of text to the glasses and clear it. Offered only when the glasses are connected, fully booted, and the connected model is documented to have a display. Mentra Live has none, so Mentra Live users never see it. Updates are debounced (400 ms, latest value wins, never two sends in flight). |
| **Events** | Live feed of button presses, touchpad taps, swipes and head-position changes, newest first. |
| **Console** | The SDK's diagnostic `log` stream next to the app's own actions and errors, filterable. Kept in memory only (last 300 lines). |

Every feature is gated by the connected model and its status. `src/lib/models.ts` holds the
capability table; only hardware that the SDK docs describe is marked capable, and any other
model gets no capabilities until it has been verified.

### Not in v1 (follow-ups)

These are left out on purpose. The app has no placeholder UI for them.

- Camera capture, photo upload and video upload
- Streaming (RTMP, SRT, WebRTC) and the GStreamer receiver
- Glasses software updates (OTA)
- Barcode scanning
- Voice: microphone audio, transcription, ElevenLabs, a voice agent
- Wi-Fi setup and hotspot control (status is shown read-only)
- Hand-off to Companion Memory / Companion Hub
- Brand typeface (Manrope) and a branded splash screen; `expo-system-ui` so Android's window
  background follows dark mode
- Android 13+ notification permission, so the foreground-service notification is visible
- An Expo SDK upgrade: this app pins Expo SDK 55, the version Mentra's starter kit uses with
  Bluetooth SDK 3.3.0. Expo SDK 58 is current.

## Requirements

- **Hardware for real testing:** a physical iPhone or Android phone, and Mentra Live glasses
  on firmware from the same release as the SDK (3.3.0). Simulators and emulators cannot scan
  for Bluetooth devices; use them for build and UI checks only.
- **Node** 20.19.4 or newer (tested with 22.15.1) and **npm**. Use npm only: the lockfile is
  `package-lock.json`.
- **iOS:** Xcode 26.2 or newer for Expo SDK 55 (built with Xcode 27.0), CocoaPods (tested
  with 1.17.0). Deployment target iOS 15.1. Building with Xcode 27 needs the two iOS plugins
  described under [Config plugins](#config-plugins); both are already wired in.
- **Android:** JDK 17 and these Android SDK packages, which React Native 0.83 and the SDK
  request by exact version:

  ```bash
  sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
  ```

  CMake 3.22.1 is pinned by the SDK's `lc3Lib` native module and is also React Native's
  default. Minimum Android version on the phone: 9 (API 28).
- **Expo Go cannot run this app.** The SDK ships native code, so you need a development build
  (`npx expo run:ios` / `npx expo run:android`) or a native build.

Downloads to expect on a first build: CocoaPods fetches the SDK's iOS dependencies
(ONNX Runtime, SwiftProtobuf, SWCompression, Vuzix UltraliteSDK); the Gradle wrapper fetches
Gradle 9.0.0; and the SDK's own Gradle script downloads the Sherpa-ONNX 1.13.2 AAR from
GitHub at configure time and checks it against a pinned SHA-256.

## Install

```bash
cd mobile
npm ci
```

## Run on iOS

```bash
cd mobile
npx expo prebuild --platform ios --no-install   # generates ios/ from app.config.ts
(cd ios && pod install)
npx expo run:ios                                # builds Debug, starts Metro, opens the Simulator
```

To build from the command line instead, for example in CI:

```bash
cd mobile/ios
xcodebuild -workspace Companion.xcworkspace -scheme Companion -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO build
```

A Debug build loads its JavaScript from Metro (`npx expo start`); Expo's build phase skips
bundling in Debug, and `FORCE_BUNDLING` does not change that. To launch a Debug build without
Metro, for a quick look in the Simulator, embed a bundle into the built app first:

```bash
cd mobile
APP=ios/build/DerivedData/Build/Products/Debug-iphonesimulator/Companion.app
npx expo export:embed --platform ios --dev false --entry-file index.ts \
  --bundle-output "$APP/main.jsbundle" --assets-dest "$APP"
xcrun simctl install <simulator-udid> "$APP"
xcrun simctl launch <simulator-udid> com.companionintelligence.mentra
```

On a physical iPhone, use `npx expo run:ios --device` after setting up signing (see
[Signing and store builds](#signing-and-store-builds)).

## Run on Android

Gradle must run on JDK 17. With JDK 21, configuration fails with `Class
org.gradle.jvm.toolchain.JvmVendorSpec does not have member field ... IBM_SEMERU`, because React
Native and Expo ask for Java 17 toolchains. Point `JAVA_HOME` at JDK 17 in your shell; do not
commit a `gradle.properties` with a machine path in it.

```bash
cd mobile
export JAVA_HOME=/path/to/jdk-17          # macOS: $(/usr/libexec/java_home -v 17) if registered
npx expo prebuild --platform android --no-install   # generates android/ from app.config.ts
npx expo run:android                                # builds, installs on a phone or emulator, starts Metro
```

Or build the debug APK only:

```bash
cd mobile/android
./gradlew assembleDebug    # app/build/outputs/apk/debug/app-debug.apk
```

A debug APK loads its JavaScript from Metro (`npx expo start`), as any React Native debug
build does.

If the build reports a missing SDK package, install the one it names with `sdkmanager`, using
the versions listed under [Requirements](#requirements).

The release APK carries both 64-bit ABIs (about 168 MB), which the Android emulator's storage
could not install (`INSTALL_FAILED_INSUFFICIENT_STORAGE`). For a phone or an arm64 emulator, build
the smaller arm64-only APK (about 94 MB) with `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`.

## Native folders are generated

`ios/` and `android/` are produced by `npx expo prebuild` from `app.config.ts` and the config
plugins (continuous native generation) and are git-ignored. Never edit them by hand: change
`app.config.ts` or a plugin, then run `npx expo prebuild --clean`. The SDK's config plugin
also writes machine-specific paths into them (the Node binary for Xcode and Gradle, the SDK
package path in `settings.gradle`), which is another reason they are not committed.

## Tests and type checks

```bash
npm run typecheck   # tsc --noEmit, including the SDK's own TypeScript sources
npm test            # Jest, Node only
```

The tests cover the pure helpers in `src/lib`, the brand palette against
`../public/brand/tokens/tokens.json`, both config plugins, and the app config itself
(identifiers, permissions, SDK requirements, analytics off). Test files are named `*.spec.ts`
so the repository-root Jest config does not pick them up. Nothing in the tests loads React
Native or the SDK runtime.

## Project layout

```text
mobile/
  app.config.ts        Expo config: name, ids, permissions, SDK + build-properties plugins
  index.ts             entry point (registerRootComponent)
  src/
    App.tsx            safe-area shell, tab bar, owns the one Bluetooth session
    session/           useCompanionSession (SDK hook wrapper, events, actions),
                       Android permission requests, saved-glasses storage
    lib/               pure, unit-tested helpers: models and capabilities, status labels,
                       saved-device record, event and log feed, debounced sender, permissions
    screens/           Glasses, Events, Console
    components/        small UI kit and tab bar
    theme/             brand palette (light and dark) from the canonical tokens
  plugins/             Expo config plugins (see below)
  assets/              placeholder app icons
```

### Config plugins

| Plugin | Why it is kept |
| --- | --- |
| `@mentra/bluetooth-sdk` (`node: true`, `analytics: false`) | Registers the SDK's native modules, adds `:lc3Lib` and `:silero` to Gradle, adds `bluetooth-central` to iOS background modes, and turns the SDK's analytics off. |
| `expo-build-properties` | iOS deployment target 15.1, Android `minSdkVersion` 28, and the SDK's ONNX Runtime `pickFirst` packaging rule. |
| `plugins/withConnectedDeviceForegroundService.js` | The SDK keeps the glasses link alive in the background with a foreground service. Its manifest declares five service types; this app only holds a Bluetooth link, so the merged manifest keeps `connectedDevice` alone and the other four `FOREGROUND_SERVICE_*` permissions are blocked. Android 14+ and Google Play require each declared type to be justified. |
| `plugins/withAndroid16KbPageSize.js` | Builds the SDK's `lc3Lib` with 16 KB page alignment, which Google Play requires for apps targeting Android 15+, and limits native builds to 64-bit ABIs (`arm64-v8a`, `x86_64`). |
| `plugins/withPodsDeploymentTarget.js` (new) | Xcode 27 refuses iOS targets below 15.0. SwiftProtobuf, SWCompression and BitByteData, which the SDK pulls in, still declare iOS 11, and React Native's post-install raises their library targets but not their resource bundles. This raises every Pods target to the app's deployment target. |
| `plugins/withSceneLifecycle.js` (new) | Apps built with the iOS 27 SDK must use the UIScene life cycle; without it the app stops at launch on iOS 27 (`EXC_BREAKPOINT` in `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`). Expo SDK 55's template predates this, so the plugin adds a scene manifest and a `SceneDelegate` that creates the window, starts React Native and forwards scene events. Remove it when moving to Expo SDK 56 or later, which ship their own scene delegate. |

The starter kit's barcode scanner and video-stream receiver modules, its GStreamer setup, and
its `@mentra/engine` OTA flow are not used.

## Identity

| | Value |
| --- | --- |
| Display name | Companion |
| iOS bundle identifier | `com.companionintelligence.mentra` |
| Android applicationId | `com.companionintelligence.mentra` |

This follows the `com.companionintelligence.<product>` scheme the Spellbook, Atlas and
Planning apps use on both platforms. Companion Memory is the exception (`com.companionintelligence.app`
on iOS, `com.ci.memory` on Android). To sign a device build under a different Apple team, set
`COMPANION_IOS_BUNDLE_ID` before running prebuild.

## Privacy

**The app makes no network requests of its own in v1.** There is no backend, no telemetry and
no `fetch` anywhere in `src/`. In debug builds the app loads its JavaScript from the Metro
server on your computer; that is development only.

The SDK makes these requests on its own:

- **Usage analytics: off.** By default SDK 3.3.0 sends usage events to Mentra's PostHog
  project, tagged with an anonymous install ID and the glasses model, manufacturing serial and
  build number. `analytics: false` in `app.config.ts` disables them. In the generated projects
  that is `MentraBluetoothSdkAnalyticsDisabled = true` in the iOS `Info.plist` and
  `<meta-data android:name="com.mentra.bluetoothsdk.analytics.disabled" android:value="true"/>`
  in the Android manifest; `app.config.spec.ts` fails if the option is removed.
- **SDK update check: still on.** Every time the SDK starts it sends one HTTPS request
  (4-second timeout, no retry) to
  `https://core.mentraglass.com/api/client/bluetooth-sdk/update-check` carrying the same
  anonymous `install_id` that analytics would use, the app identifier, version, build, build
  type, install source and environment, the SDK version, platform and surface, and the OS
  platform and version. Mentra records each check. It runs whether or not analytics are
  disabled, and the SDK 3.3.0 README documents no switch to turn it off. If a network blocks
  `core.mentraglass.com`, only a developer-console banner about new SDK versions is lost.
- **Not used in v1:** the SDK's OTA downloads, photo and video uploads, streaming, and its
  local photo-upload and OTA servers only run when an app starts those features. This app
  never does.

Permissions:

- **iOS:** Bluetooth (`NSBluetoothAlwaysUsageDescription`); iOS asks the first time the SDK
  uses Bluetooth. `NSMicrophoneUsageDescription` is declared because the SDK compiled into
  the app contains a phone-microphone path, but the app never asks for the microphone. The
  app connects with `requiresAncs: false`, so iOS does not ask to share notifications with
  the glasses. The `bluetooth-central` background mode keeps the link alive while the phone is
  locked.
- **Android:** Nearby devices (`BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`) and Location, requested
  only when you scan or connect, never at launch. Location is used only because some phones
  return no Bluetooth scan results without it. No camera, microphone, notification or
  background-location prompt. The storage and overlay permissions from the Expo template, and
  the unused foreground-service types, are removed from the manifest.

On-device data: one file, `companion-saved-glasses.json` in the app's documents directory,
holding the ID, model, name and Bluetooth address of the last connected glasses (no pairing
code). **Forget** deletes it. The event feed and console live in memory and are never
uploaded; the console records how many characters were sent to the display, not the text.

## Signing and store builds

Not done. No accounts, certificates, keys or store records exist for this app yet.

**iOS (App Store or TestFlight):**

1. An Apple Developer Program team, and an explicit App ID for
   `com.companionintelligence.mentra` registered under it (or another identifier through
   `COMPANION_IOS_BUNDLE_ID`).
2. A distribution certificate and an App Store provisioning profile, or automatic signing in
   Xcode, for that App ID.
3. The App ID's capabilities matching the build: the *Uses Bluetooth LE accessories*
   background mode. App Review expects a reason for it.
4. A Release archive (Xcode *Product > Archive* on `ios/Companion.xcworkspace`, or an EAS
   build), a version and build number bump, then an App Store Connect record with the privacy
   details (see [Privacy](#privacy), including the SDK update check), export-compliance
   answers, and a privacy policy URL.

**Android (Google Play):**

1. An upload key in a keystore kept outside the repository, and a release `signingConfig`
   that reads it from the environment. The generated project signs release builds with the
   debug key, which Play rejects.
2. `versionCode` and `version` bumps in `app.config.ts` for each upload.
3. A Play Console app with Play App Signing, the Data safety form, the foreground-service
   declaration for `connectedDevice` (Play asks for a short demonstration video), and the
   location-permission explanation.

## Release checklist

Mapped to the Mentra Bluetooth SDK production checklist.

### App setup

| Item | Status |
| --- | --- |
| Native builds configured for the shipped stack | Done: Expo prebuild for iOS and Android |
| iOS deployment target 15.1 or newer | Done: 15.1 |
| Android min SDK 28 or newer | Done: 28 |
| Android builds use Java 17 | Done for local builds (`JAVA_HOME`); no CI build yet |
| ONNX Runtime `pickFirst` packaging rule | Done |
| Bluetooth permission copy is specific and user-friendly | Done |
| Microphone, camera, local network, notification and location requested only when needed | Done: only Bluetooth, and location on Android at scan/connect time |
| Integrates through documented SDK APIs only | Done: `@mentra/bluetooth-sdk` and `@mentra/bluetooth-sdk/react` |

### SDK integration

| Item | Status |
| --- | --- |
| Subscribes to typed status callbacks or hook state | Done: `useMentraBluetooth` |
| Handles disconnect, reconnect, scan stopped and pair failure | Implemented; not verified on hardware |
| Does not assume every model supports every feature | Done: capability table, unknown models get nothing |
| Cleans up listeners; `close()` / `invalidate()` | Done for React Native: the SDK has no `close()` in JS, and every listener is removed on unmount |
| Removes every SDK event subscription on unmount | Done: all via `useBluetoothEvent` in the session owner |
| Debounces display updates | Done: 400 ms, latest value wins |
| Typed settings APIs for brightness, camera, LED, Wi-Fi and so on | Not applicable in v1 |
| Advanced controls gated by capability and status | Done (display) |

### Privacy and compliance

| Item | Status |
| --- | --- |
| Audio capture disclosed | Not applicable in v1 (no audio) |
| Camera capture disclosed | Not applicable in v1 |
| Bluetooth and location copy explains device discovery | Done |
| Cloud upload behaviour in the privacy policy | **Not done:** no privacy policy yet; it must cover the SDK update check |
| Logs avoid sensitive user data | Done for app logs; SDK log lines stay on the device |

### Release validation

| Item | Status |
| --- | --- |
| Fresh React Native build from the published package, at least one native platform | Done for iOS (Simulator Debug build, launches on iOS 27). Android: debug and release APKs build; the arm64 release APK launches on an Android 16 emulator |
| Fresh install test on iOS and on Android devices | Not done |
| Pairing test with each supported model | Not done (no hardware) |
| Mentra Live reaches `glasses_ready` / fully booted on current firmware | Not done |
| Reconnect after app restart | Implemented; not done |
| Reconnect after a Bluetooth toggle | Not done |
| Display command test on a display model (G2) | Not done |
| Button and touch event test | Implemented; not done |
| Camera, gallery, streaming, speaker, microphone, hardware settings | Not applicable in v1 |
| Version and status handling | Status shown; `requestVersionInfo()` not used yet |

## Attribution

Parts of this app are adapted from the
[Mentra Bluetooth SDK Starter Kit](https://github.com/Mentra-Community/Mentra-Bluetooth-SDK-Starter-Kit)
React Native example, Copyright 2026 Mentra Labs, Inc., licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). Each adapted file starts
with a comment naming its source; all of them were modified. The license text is in
[`LICENSE-Apache-2.0`](LICENSE-Apache-2.0). Those files stay under Apache-2.0; the rest of
this folder is under the repository license, [`LICENSE.md`](../LICENSE.md).

| File in `mobile/` | Adapted from `examples/react-native/` |
| --- | --- |
| `app.config.ts` | `app.json`, `app.config.js` |
| `plugins/withConnectedDeviceForegroundService.js` | `plugins/withConnectedDeviceForegroundService.js` |
| `plugins/withAndroid16KbPageSize.js` | `plugins/withAndroid16KbPageSize.js` |
| `plugins/plugins.spec.ts` | `plugins/withConnectedDeviceForegroundService.test.ts` |
| `src/session/useCompanionSession.ts` | `src/useBluetoothSdkExample.ts` |
| `src/session/savedDeviceStorage.ts` | `src/useBluetoothSdkExample.ts` |
| `src/session/permissions.ts` | `src/useBluetoothSdkExample.ts` |
| `src/lib/androidPermissions.ts` | `src/useBluetoothSdkExample.ts` |
| `src/lib/savedDevice.ts` | `src/useBluetoothSdkExample.ts` |
| `src/lib/feed.ts` | `src/useBluetoothSdkExample.ts` |
| `src/lib/models.ts` | `src/useBluetoothSdkExample.ts`, `src/sdkFormat.ts` |
| `src/lib/glassesStatus.ts` | `src/sdkFormat.ts` |
| `src/screens/GlassesScreen.tsx` | `src/screens/DeviceScreen.tsx` |
| `src/screens/ConsoleScreen.tsx` | `src/screens/ConsoleScreen.tsx` |
| `src/components/TabBar.tsx` | `src/components/TabBar.tsx` |

The app icons are placeholders made from this repository's own ring mark
(`../site/public/icon.svg`), not from the starter kit.
