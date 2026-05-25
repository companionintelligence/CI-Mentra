# CI-Mentra
Mentra Glass Live App

## Runtime modes

- `MENTRA_RUNTIME_MODE=cloud` (default): starts the MentraOS cloud AppServer bridge using `MENTRA_API_KEY`.
- `MENTRA_RUNTIME_MODE=bluetooth-local`: keeps this service as the local facade API and logs the local Bluetooth SDK runtime profile for mobile builds using `@mentra/bluetooth-sdk` (default version `0.1.6`).

Local Bluetooth mode supports:

- `MENTRA_BLUETOOTH_TARGET=mentra-live`
- `MENTRA_BLUETOOTH_TARGET=even-realities`
- `MENTRA_BLUETOOTH_TARGET=g2`
- `MENTRA_BLUETOOTH_TARGET=vuzix-z100`
- `MENTRA_BLUETOOTH_TARGET=nimo`

Optionally set `MENTRA_BLUETOOTH_SDK_PACKAGE_PATH` to point at a local SDK checkout when developing against an unpublished local package.

## FTUE / user flow for bluetooth-local mode

When `MENTRA_RUNTIME_MODE=bluetooth-local`, the app now exposes runtime onboarding data in:

- startup logs (selected headset profile + FTUE steps)
- `/health` response (`bluetooth.ftue.firstTimeFlow`, `bluetooth.supportedTargets`)

Recommended flow:

1. Let the user select the headset model (or set `MENTRA_BLUETOOTH_TARGET` ahead of time).
2. Scan and show progressive device results.
3. Require explicit user selection before connect (avoid auto-connecting the first result).
4. Gate advanced controls by runtime capabilities and keep unsupported actions hidden/disabled.
