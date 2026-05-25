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

## Tailscale + Ollama + STT + TTS quick setup

Use this flow when Mentra bridge is running in one environment and your model/audio stack is exposed over your tailnet.

### 1) Prerequisites

- Tailscale installed and authenticated on both machines:
  - machine running CI-Mentra
  - machine hosting Ollama (and optionally your OpenAI-compatible STT/TTS endpoint)
- Ollama running on your tailnet host (`ollama serve`)
- Required local services for CI-Mentra (`postgres`, `redis`)

### 2) Generate a ready-to-use environment file

```bash
scripts/setup-tailscale-ollama-stt-tts.sh \
  --mentra-api-key <MENTRA_API_KEY> \
  --facade-api-key <FACADE_API_KEY> \
  --tailscale-cloud-api-url https://<ci-server>.<tailnet>.ts.net \
  --ollama-base-url http://<ollama-host>.<tailnet>.ts.net:11434 \
  --tts-provider mentra
```

This writes `.env.tailscale`. Then apply it:

```bash
cp .env.tailscale .env
```

If you use ElevenLabs for TTS, pass:

```bash
--tts-provider elevenlabs --elevenlabs-api-key <ELEVENLABS_API_KEY>
```

### 3) Start dependencies and run CI-Mentra

```bash
docker compose up -d postgres redis
npm ci
npm run dev
```

### 4) Smoke-test Ollama, STT, and TTS

Check Ollama model availability from the CI-Mentra host:

```bash
curl -s http://<ollama-host>.<tailnet>.ts.net:11434/api/tags
```

Check STT endpoint:

```bash
curl -X POST http://localhost:8080/v1/audio/transcriptions \
  -H "Authorization: Bearer <FACADE_API_KEY>" \
  -F file=@/path/to/audio.wav \
  -F model=whisper-1
```

Check TTS endpoint:

```bash
curl -X POST http://localhost:8080/v1/audio/speech \
  -H "Authorization: Bearer <FACADE_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"tts-1","input":"Mentra setup complete","voice":"alloy"}' \
  --output /tmp/mentra-tts.mp3
```
