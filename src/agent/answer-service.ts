import { config } from '../config.ts';
import { resolveProvider } from '../providers/index.ts';
import { normalizeChatCompletionToCanonical } from '../canonical/normalizer.ts';
import * as memory from '../memory/companion-memory.ts';
import * as history from './session-history.ts';
import pino from 'pino';

const logger = pino({ name: 'answer-service' });

export interface AnswerInput {
  sessionId: string;
  userId?: string;
  text: string;
}

export interface AnswerResult {
  answer: string;
  remembered: boolean;
  usedRecallCount: number;
  usedContext: boolean;
}

/** The chat model for the active default provider. */
export function resolveDefaultModel(): string {
  return config.providers.default === 'hermes' && config.providers.hermes.defaultModel
    ? config.providers.hermes.defaultModel
    : config.providers.ollama.defaultModel;
}

/**
 * An explicit save-to-memory command.
 *
 * Deliberately strict. A loose "remember …" match silently writes junk into
 * durable memory instead of answering: "remember when we went to Rome?" is a
 * question *about* a memory, not an instruction to store one. So require an
 * explicit save form — `remember: X`, or `remember that/this/to/my/the X` — and
 * never treat a question as a command.
 */
const REMEMBER_RE =
  /^\s*(?:hey\s+)?(?:companion[,\s]+)?(?:please\s+)?remember\b\s*(?::\s*|(?:that|this|to|my|the)\s+)(.+)$/i;

export function parseRememberCommand(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.endsWith('?')) return null;
  const match = trimmed.match(REMEMBER_RE);
  const content = match?.[1]?.trim();
  return content && content.length > 0 ? content : null;
}

/** An empty profile may mean "none yet" or "CI-Server was down" — don't pin a blip for the full TTL. */
const EMPTY_CONTEXT_TTL_MS = 60 * 1000;

async function ensureContext(sessionId: string): Promise<string> {
  if (history.contextIsFresh(sessionId)) return history.getContextBlock(sessionId);
  const block = await memory.getContext();
  history.setContext(sessionId, block, block.trim() ? undefined : EMPTY_CONTEXT_TTL_MS);
  return block;
}

function buildSystemPrompt(persona: string, contextBlock: string, recallBlock: string): string {
  const parts = [persona];
  if (contextBlock.trim()) parts.push(contextBlock.trim());
  if (recallBlock.trim()) parts.push(recallBlock.trim());
  return parts.join('\n\n');
}

/**
 * The core loop: recall long-term memory + profile, compose a grounded prompt
 * with the rolling session history, generate an answer, then persist the turn.
 * Used by both the glasses voice bridge and the companion UI's BFF.
 */
export async function answer(input: AnswerInput): Promise<AnswerResult> {
  const sessionId = input.sessionId;
  const userId = input.userId || 'mentra-user';
  const text = input.text.trim();
  if (!text) {
    return { answer: '', remembered: false, usedRecallCount: 0, usedContext: false };
  }

  // Explicit "remember this…" → durable memory + short confirmation (no LLM call).
  const rememberContent = parseRememberCommand(text);
  if (rememberContent) {
    const ok = await memory.writeMemory(rememberContent, { source: config.memory.platform, sessionId });
    const answerText = ok ? "Got it — I'll remember that." : "I couldn't save that to memory right now.";
    history.appendExchange(sessionId, text, answerText);
    await memory.writeTurn(
      [{ role: 'user', content: text }, { role: 'assistant', content: answerText }],
      sessionId
    );
    return { answer: answerText, remembered: ok, usedRecallCount: 0, usedContext: false };
  }

  // Retrieve profile context (cached per session) + long-term recall for this query.
  const [contextBlock, recallResult] = await Promise.all([ensureContext(sessionId), memory.recall(text)]);
  const systemPrompt = buildSystemPrompt(config.agent.persona, contextBlock, recallResult.block);

  const priorHistory = history.getHistory(sessionId).map((m) => ({
    role: m.role as string,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));

  const turn = normalizeChatCompletionToCanonical(
    {
      model: resolveDefaultModel(),
      messages: [{ role: 'system', content: systemPrompt }, ...priorHistory, { role: 'user', content: text }],
      stream: false,
    },
    'mentra-companion',
    userId
  );
  turn.conversation_id = sessionId;

  let answerText = '';
  try {
    const provider = resolveProvider(turn);
    const result = await provider.chatCompletion(turn);
    answerText = result.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'answer generation failed');
  }

  // A failure is not a turn. Persisting the apology would teach the wearer's
  // permanent memory that their companion said it — and poison later recall.
  if (!answerText) {
    return {
      answer: "Sorry, I couldn't reach the assistant just now. Please try again.",
      remembered: false,
      usedRecallCount: recallResult.resultCount,
      usedContext: Boolean(contextBlock.trim()),
    };
  }

  history.appendExchange(sessionId, text, answerText);
  // Fire-and-forget: this is a voice loop. Awaiting the write would add the full
  // memory timeout to every spoken reply, and the server dedupes turns anyway.
  void memory
    .writeTurn([{ role: 'user', content: text }, { role: 'assistant', content: answerText }], sessionId)
    .catch(() => undefined);

  return {
    answer: answerText,
    remembered: false,
    usedRecallCount: recallResult.resultCount,
    usedContext: Boolean(contextBlock.trim()),
  };
}
