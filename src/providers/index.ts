import { CanonicalTurn, ProviderName } from '../canonical/types';
import { Provider } from './types';
import { OllamaProvider } from './ollama';
import { VllmProvider } from './vllm';
import { OpenAIProvider } from './openai';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'provider-router' });

const providers = new Map<ProviderName, Provider>([
  ['ollama', new OllamaProvider()],
  ['vllm', new VllmProvider()],
  ['openai', new OpenAIProvider()],
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
  return getProvider(config.providers.default as ProviderName);
}

export { Provider, providers };
