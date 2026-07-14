#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.tailscale"

MENTRA_API_KEY=""
FACADE_API_KEY=""
TAILSCALE_CLOUD_API_URL=""
OLLAMA_BASE_URL=""
LOCAL_SPEECH_BASE_URL=""

usage() {
  cat <<USAGE
Usage:
  scripts/setup-tailscale-ollama-stt-tts.sh \
    --mentra-api-key <key> \
    --facade-api-key <key> \
    --tailscale-cloud-api-url <url> \
    --ollama-base-url <url> \
    --local-speech-base-url <url>

Example:
  scripts/setup-tailscale-ollama-stt-tts.sh \
    --mentra-api-key mentra_xxx \
    --facade-api-key facade_xxx \
    --tailscale-cloud-api-url https://ci-server.your-tailnet.ts.net \
    --ollama-base-url http://ollama.your-tailnet.ts.net:11434 \
    --local-speech-base-url http://speech.your-tailnet.ts.net:8000
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
    --local-speech-base-url)
      LOCAL_SPEECH_BASE_URL="${2:-}"
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

missing_args=()
[[ -z "$MENTRA_API_KEY" ]] && missing_args+=("--mentra-api-key")
[[ -z "$FACADE_API_KEY" ]] && missing_args+=("--facade-api-key")
[[ -z "$TAILSCALE_CLOUD_API_URL" ]] && missing_args+=("--tailscale-cloud-api-url")
[[ -z "$OLLAMA_BASE_URL" ]] && missing_args+=("--ollama-base-url")
[[ -z "$LOCAL_SPEECH_BASE_URL" ]] && missing_args+=("--local-speech-base-url")

if [[ ${#missing_args[@]} -gt 0 ]]; then
  echo "Error: missing required arguments: ${missing_args[*]}" >&2
  usage
  exit 1
fi

if [[ ! -f "${ROOT_DIR}/.env.example" ]]; then
  echo "Error: .env.example not found in repository root (${ROOT_DIR})" >&2
  exit 1
fi

cp "${ROOT_DIR}/.env.example" "$ENV_FILE"

set_env() {
  local key="$1"
  local value="$2"
  local escaped
  escaped=$(printf '%s' "$value" | sed -e 's/[\\&]/\\&/g')
  if grep -q "^${key}=" "$ENV_FILE"; then
    if sed --version >/dev/null 2>&1; then
      sed -i "s#^${key}=.*#${key}=${escaped}#" "$ENV_FILE"
    else
      sed -i '' "s#^${key}=.*#${key}=${escaped}#" "$ENV_FILE"
    fi
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

set_env "MENTRA_API_KEY" "$MENTRA_API_KEY"
set_env "FACADE_API_KEY" "$FACADE_API_KEY"
set_env "MENTRA_CLOUD_API_URL" "$TAILSCALE_CLOUD_API_URL"
set_env "DEFAULT_PROVIDER" "ollama"
set_env "OLLAMA_BASE_URL" "$OLLAMA_BASE_URL"
set_env "OPENAI_BASE_URL" "$LOCAL_SPEECH_BASE_URL"
set_env "OPENAI_API_KEY" "local-only"
set_env "VLLM_BASE_URL" "$LOCAL_SPEECH_BASE_URL"
set_env "TTS_PROVIDER" "mentra"
set_env "ELEVENLABS_API_KEY" ""
set_env "ELEVENLABS_DEFAULT_VOICE_ID" ""

echo "Wrote ${ENV_FILE}"
echo "Next steps:"
echo "  1) cp .env.tailscale .env"
echo "  2) npm run dev"
echo "  3) POST /v1/audio/transcriptions and /v1/audio/speech to verify STT/TTS"
