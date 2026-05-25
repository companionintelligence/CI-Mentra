#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.tailscale"

MENTRA_API_KEY=""
FACADE_API_KEY=""
TAILSCALE_CLOUD_API_URL=""
OLLAMA_BASE_URL=""
OPENAI_API_KEY=""
TTS_PROVIDER="mentra"
ELEVENLABS_API_KEY=""
ELEVENLABS_DEFAULT_VOICE_ID=""

usage() {
  cat <<USAGE
Usage:
  scripts/setup-tailscale-ollama-stt-tts.sh \
    --mentra-api-key <key> \
    --facade-api-key <key> \
    --tailscale-cloud-api-url <url> \
    --ollama-base-url <url> \
    [--openai-api-key <key>] \
    [--tts-provider mentra|elevenlabs] \
    [--elevenlabs-api-key <key>] \
    [--elevenlabs-default-voice-id <id>]

Example:
  scripts/setup-tailscale-ollama-stt-tts.sh \
    --mentra-api-key mentra_xxx \
    --facade-api-key facade_xxx \
    --tailscale-cloud-api-url https://ci-server.your-tailnet.ts.net \
    --ollama-base-url http://ollama.your-tailnet.ts.net:11434
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mentra-api-key)
      MENTRA_API_KEY="${2:-}"
      shift 2
      ;;
    --facade-api-key)
      FACADE_API_KEY="${2:-}"
      shift 2
      ;;
    --tailscale-cloud-api-url)
      TAILSCALE_CLOUD_API_URL="${2:-}"
      shift 2
      ;;
    --ollama-base-url)
      OLLAMA_BASE_URL="${2:-}"
      shift 2
      ;;
    --openai-api-key)
      OPENAI_API_KEY="${2:-}"
      shift 2
      ;;
    --tts-provider)
      TTS_PROVIDER="${2:-}"
      shift 2
      ;;
    --elevenlabs-api-key)
      ELEVENLABS_API_KEY="${2:-}"
      shift 2
      ;;
    --elevenlabs-default-voice-id)
      ELEVENLABS_DEFAULT_VOICE_ID="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$MENTRA_API_KEY" || -z "$FACADE_API_KEY" || -z "$TAILSCALE_CLOUD_API_URL" || -z "$OLLAMA_BASE_URL" ]]; then
  echo "Error: required arguments are missing." >&2
  usage
  exit 1
fi

if [[ "$TTS_PROVIDER" != "mentra" && "$TTS_PROVIDER" != "elevenlabs" ]]; then
  echo "Error: --tts-provider must be either 'mentra' or 'elevenlabs'." >&2
  exit 1
fi

if [[ "$TTS_PROVIDER" == "elevenlabs" && -z "$ELEVENLABS_API_KEY" ]]; then
  echo "Error: --elevenlabs-api-key is required when --tts-provider elevenlabs." >&2
  exit 1
fi

cp "${ROOT_DIR}/.env.example" "$ENV_FILE"

set_env() {
  local key="$1"
  local value="$2"
  local escaped
  escaped=$(printf '%s' "$value" | sed -e 's/[\\&]/\\&/g')
  sed -i "s#^${key}=.*#${key}=${escaped}#" "$ENV_FILE"
}

set_env "MENTRA_API_KEY" "$MENTRA_API_KEY"
set_env "FACADE_API_KEY" "$FACADE_API_KEY"
set_env "MENTRA_CLOUD_API_URL" "$TAILSCALE_CLOUD_API_URL"
set_env "OLLAMA_BASE_URL" "$OLLAMA_BASE_URL"
set_env "OPENAI_API_KEY" "$OPENAI_API_KEY"
set_env "TTS_PROVIDER" "$TTS_PROVIDER"
set_env "ELEVENLABS_API_KEY" "$ELEVENLABS_API_KEY"
set_env "ELEVENLABS_DEFAULT_VOICE_ID" "$ELEVENLABS_DEFAULT_VOICE_ID"

echo "Wrote ${ENV_FILE}"
echo "Next steps:"
echo "  1) cp .env.tailscale .env"
echo "  2) npm run dev"
echo "  3) POST /v1/audio/transcriptions and /v1/audio/speech to verify STT/TTS"
