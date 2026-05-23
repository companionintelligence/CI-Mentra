import dotenv from 'dotenv';
dotenv.config();

const runtimeMode = process.env.MENTRA_RUNTIME_MODE === 'bluetooth-local' ? 'bluetooth-local' : 'cloud';
const bluetoothTarget = process.env.MENTRA_BLUETOOTH_TARGET === 'even-realities' ? 'even-realities' : 'mentra-live';

export const config = {
  mentra: {
    packageName: process.env.MENTRA_PACKAGE_NAME || 'com.companionintelligence.mentra-bridge',
    apiKey: process.env.MENTRA_API_KEY || '',
    port: parseInt(process.env.MENTRA_PORT || '7010'),
    cloudApiUrl: process.env.MENTRA_CLOUD_API_URL || 'api.mentra.glass',
  },
  facade: {
    port: parseInt(process.env.FACADE_PORT || '8080'),
    apiKey: process.env.FACADE_API_KEY || '',
  },
  providers: {
    default: process.env.DEFAULT_PROVIDER || 'ollama',
    ollama: { baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434' },
    vllm: { baseUrl: process.env.VLLM_BASE_URL || 'http://localhost:8000' },
    openai: { apiKey: process.env.OPENAI_API_KEY || '', baseUrl: 'https://api.openai.com' },
  },
  database: { url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mentra' },
  redis: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
  audio: {
    baseUrl: process.env.AUDIO_BASE_URL || 'http://localhost:8080',
    ttsProvider: process.env.TTS_PROVIDER || 'mentra',
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
    elevenlabsDefaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
  },
  rateLimit: {
    rpm: parseInt(process.env.RATE_LIMIT_RPM || '60'),
    tpm: parseInt(process.env.RATE_LIMIT_TPM || '100000'),
  },
  runtime: {
    mode: runtimeMode,
    bluetooth: {
      sdkPackage: '@mentra/bluetooth-sdk',
      sdkVersion: process.env.MENTRA_BLUETOOTH_SDK_VERSION || '0.1.6',
      packagePath: process.env.MENTRA_BLUETOOTH_SDK_PACKAGE_PATH || '',
      target: bluetoothTarget,
    },
  },
};
