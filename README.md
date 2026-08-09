# CI-Mentra
Mentra Glass Live App

## Runtime

The service runs on either [Deno](https://deno.com) (2.9+, preferred; used by
the Dockerfile) or Node.js 20+. Source is real ESM (`"type": "module"` +
`module: NodeNext` in `tsconfig.json`); Deno resolves npm dependencies
directly via `deno.json`'s `nodeModulesDir: "auto"`.

```bash
# Deno
deno task dev     # deno run -A --watch src/index.ts
deno task test    # deno test -A src/__tests__/  (see "Testing" note below)
deno task build   # deno check src/index.ts (type-check)
deno task lint

# Node (unchanged)
npm install
npm run dev       # ts-node src/index.ts
npm test          # jest
npm run build     # tsc -> dist/
```

**Testing note:** the existing test suite uses `jest.mock()` for module
mocking, which Deno's test runner has no equivalent for (Deno's ES module
records are immutable, so modules can't be monkey-patched the way Jest does).
`deno task test` / `deno test` will fail against these Jest-style specs as a
result — `npm test` (Jest) remains the supported way to run this suite today.

## Companion Intelligence integration

CI-Mentra is a Device-layer bridge: it turns Mentra glasses voice input into an
LLM response and speaks it back, and exposes an OpenAI-compatible façade
(`/v1/*`). It integrates with the CI platform in three ways.

### 1. Login via CI-Portal OIDC (SSO)

CI-Portal is the platform IdP (better-auth, EdDSA). CI-Mentra supports **both**
OIDC patterns; they can be enabled independently.

**A. Resource server — validate a presented token.** Set `PORTAL_OIDC_ENABLED=true`
to accept a **CI-Portal JWT** in `Authorization: Bearer …`, validated via Portal's
JWKS with `iss`/`aud`/`exp` checks (mirrors CI-Server's `PortalTokenService`).

| Var | Meaning | Default |
|-----|---------|---------|
| `PORTAL_OIDC_ENABLED` | Accept Portal OIDC bearer tokens | `false` |
| `PORTAL_OIDC_ISSUER` | Expected `iss` — the **bare origin**, no `/api/auth` | `https://hub.companionintelligence.com` |
| `PORTAL_OIDC_JWKS_URI` | Portal JWKS endpoint | `<origin>/api/auth/jwks` |
| `PORTAL_OIDC_AUDIENCE` | Comma-separated allowlist of accepted `aud` (client ids) | `ci-mentra,ci-import-tools,ci-server,ci-hub` |

**B. Interactive login — Authorization Code + PKCE (like CI-Import-Tools).** Set
`MENTRA_OIDC_ENABLED=true` to expose a browser sign-in flow under `/api/auth`:

| Route | Purpose |
|-------|---------|
| `GET /api/auth/config` | Whether login is enabled + where to start it |
| `GET /api/auth/login` | Begins PKCE; 302 → CI-Portal authorize |
| `GET /api/auth/callback` | Exchanges the code, verifies the id_token, sets a session |
| `GET /api/auth/me` | The signed-in user (or 401) |
| `ALL /api/auth/logout` | Ends the session; RP-initiated logout if supported |

The flow is discovery-driven (no hardcoded endpoints), verifies the `id_token`
signature + `nonce`, and keeps all tokens **server-side** — the browser only holds
the signed `mentra_session` cookie, which the façade also accepts as a credential.

| Var | Meaning | Default |
|-----|---------|---------|
| `MENTRA_OIDC_ENABLED` | Enable the interactive login flow | `false` |
| `MENTRA_OIDC_ISSUER` | Discovery base URL (**includes** `/api/auth`) | `https://hub.companionintelligence.com/api/auth` |
| `MENTRA_OIDC_CLIENT_ID` | Registered public PKCE client | `ci-mentra` |
| `MENTRA_OIDC_SCOPES` | Requested scopes | `openid profile email offline_access` |
| `MENTRA_OIDC_REDIRECT_URI` | Override; else `${proto}://${host}/api/auth/callback` | _(derived)_ |
| `MENTRA_SESSION_SECRET` | Signs session/tx cookies (set in prod) | _(random per boot)_ |

> A dedicated `ci-mentra` client should be registered in CI-Portal (its
> `/api/auth/oauth2/register` endpoint exists). Until then, set
> `MENTRA_OIDC_CLIENT_ID=ci-import-tools` — a registered public client that
> allows localhost redirects — to run the flow. `GET /health` reports the active
> auth mode and whether interactive login is enabled.

The static `FACADE_API_KEY` remains a service-client fallback in all cases.

### 2. Standardized Ollama connection (CI-Hub instance)

The Ollama base URL resolves in this order: `OLLAMA_BASE_URL` → `OLLAMA_HOST` →
`LLM_API_BASE` (any trailing `/v1` is stripped) → `http://localhost:11434`. This
accepts both this repo's original var and the CI-Hub / CI-Server conventions, so
the same env works locally and inside a Hub-managed container (where the Hub
injects `http://host.docker.internal:11434`). A non-empty bearer (`OLLAMA_API_KEY`,
default `ollama`) is always sent, matching the appliance convention. The default
chat model comes from `LLM_DEFAULT_CHAT_MODEL`.

### 3. Backend hermes / openclaw server on CI-Hub

The CI-Hub does not proxy inference; it hands each marketplace app (slug
`hermes-agent` / `openclaw`) an OpenAI-compatible endpoint. CI-Mentra exposes a
**`hermes` provider** for that backend. Configure it directly with
`HERMES_OPENAI_BASE_URL` / `HERMES_OPENAI_API_KEY` / `HERMES_DEFAULT_MODEL`, or
set `HUB_INFERENCE_BOOTSTRAP=true` to auto-discover credentials at startup from
`GET ${CI_HUB_URL}/api/inference/apps/${HUB_APP_SLUG}/bootstrap.env` (fail-open).
Route a request to it by setting `DEFAULT_PROVIDER=hermes`, or per-request with a
`hermes:` / `openclaw:` model prefix (e.g. `hermes:gemma4:latest`).

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
This setup is local-first: Ollama for LLMs, and a local OpenAI-compatible speech endpoint for STT/TTS.
No external LLM/speech API keys are required.

### 1) Prerequisites

- Tailscale installed and authenticated on all AI hosts:
  - machine running CI-Mentra
  - machine hosting Ollama
  - machine hosting local OpenAI-compatible STT/TTS endpoint
- Ollama running on your tailnet host (`ollama serve`)
- Local speech/STT/TTS endpoint running on your tailnet (OpenAI-compatible `/v1/audio/transcriptions` + `/v1/audio/speech`)
- Required local services for CI-Mentra (`postgres`, `redis`)

### 2) Generate a ready-to-use environment file

```bash
scripts/setup-tailscale-ollama-stt-tts.sh \
  --mentra-api-key <MENTRA_API_KEY> \
  --facade-api-key <FACADE_API_KEY> \
  --tailscale-cloud-api-url https://<ci-server>.<tailnet>.ts.net \
  --ollama-base-url http://<ollama-host>.<tailnet>.ts.net:11434 \
  --local-speech-base-url http://<speech-host>.<tailnet>.ts.net:8000
```

This writes `.env.tailscale` and pins:

- `DEFAULT_PROVIDER=ollama`
- `TTS_PROVIDER=mentra`
- `OPENAI_BASE_URL` / `VLLM_BASE_URL` to your local speech endpoint
- `OPENAI_API_KEY=local-only` (placeholder for local endpoint auth compatibility)

Then apply it:

```bash
cp .env.tailscale .env
```

### 3) Start dependencies and run CI-Mentra

```bash
docker compose up -d postgres redis
npm ci
npm run dev
```

### 4) Smoke-test local Ollama, STT, and TTS

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
