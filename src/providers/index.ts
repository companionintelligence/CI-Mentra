import { type CanonicalTurn, type ProviderName } from '../canonical/types.ts';
import type { Provider } from './types.ts';
import { OllamaProvider } from './ollama.ts';
import { VllmProvider } from './vllm.ts';
import { OpenAIProvider } from './openai.ts';
import { HermesProvider } from './hermes.ts';
import { config } from '../config.ts';
import pino from 'pino';

const logger = pino({ name: 'provider-router' });

const providers = new Map<ProviderName, Provider>([
  ['ollama', new OllamaProvider()],
  ['vllm', new VllmProvider()],
  ['openai', new OpenAIProvider()],
  ['hermes', new HermesProvider()],
]);

export function getProvider(name?: ProviderName): Provider {
  const providerName = name || (config.providers.default as ProviderName);
  const provider = providers.get(providerName);
  if (!provider) {
    logger.warn({ providerName }, 'Unknown provider, falling back to ollama');
    return providers.get('ollama') as Provider;
  }
  return provider;
}

export function resolveProvider(turn: CanonicalTurn): Provider {
  if (turn.provider) {
    return getProvider(turn.provider);
  }
  // Default routing based on model name prefix
  const model = turn.model.toLowerCase();
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) {
    return getProvider('openai');
  }
  if (model.startsWith('vllm:')) {
    return getProvider('vllm');
  }
  if (model.startsWith('hermes:') || model.startsWith('openclaw:')) {
    return getProvider('hermes');
  }
  return getProvider(config.providers.default as ProviderName);
}

export type { Provider };
export { providers };
