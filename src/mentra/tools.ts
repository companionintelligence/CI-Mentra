import * as companionMemory from '../memory/companion-memory';
import pino from 'pino';

const logger = pino({ name: 'mentra-tools' });

/**
 * Handlers for the voice tools declared in `app_config.json`.
 *
 * These are deliberately decoupled from the MentraOS SDK: MentraOS Cloud posts
 * tool calls to the AppServer's `/tool` endpoint, which is awkward to exercise
 * in a unit test. The bridge's `onToolCall` adapts the SDK's `ToolCall` to the
 * structural `ToolCallLike` below, so every branch here stays trivially
 * testable and the SDK never leaks into the tool logic.
 *
 * The one exception is `take_photo`: capturing a photo needs a live
 * `AppSession`, which only the bridge holds. This module therefore returns a
 * sentinel string that the bridge recognizes and acts on — keeping the SDK
 * dependency in exactly one place.
 */

/**
 * The subset of the SDK's `ToolCall` these handlers need. The real
 * `ToolCall` (toolId/toolParameters/userId/timestamp/activeSession) is
 * structurally assignable to this, so no cast is required at the call site.
 */
export interface ToolCallLike {
  toolId: string;
  toolParameters?: Record<string, unknown>;
  userId?: string;
}

/** Tool ids, kept in one place so `app_config.json` and this module cannot drift. */
export const ToolId = {
  RememberThis: 'remember_this',
  SearchMemory: 'search_memory',
  WhatsOnMyCalendar: 'whats_on_my_calendar',
  TakePhoto: 'take_photo',
} as const;

/**
 * Returned by the `take_photo` handler instead of a spoken reply: the bridge
 * owns the `AppSession` and therefore the camera, so it interprets this and
 * performs the actual capture. Optionally suffixed with `:<note>`.
 */
export const TAKE_PHOTO_SENTINEL = '__ci_mentra_take_photo__';

/** Whether a handler result is the bridge's cue to capture a photo. */
export function isTakePhotoSentinel(result: string): boolean {
  return result === TAKE_PHOTO_SENTINEL || result.startsWith(`${TAKE_PHOTO_SENTINEL}:`);
}

/** The wearer's note from a take-photo sentinel, or '' when they gave none. */
export function takePhotoNote(result: string): string {
  return result.startsWith(`${TAKE_PHOTO_SENTINEL}:`) ? result.slice(TAKE_PHOTO_SENTINEL.length + 1).trim() : '';
}

/** A calendar entry as pushed by the MentraOS `CALENDAR_EVENT` stream. */
export interface CalendarEntry {
  eventId: string;
  title: string;
  dtStart: string;
  dtEnd?: string;
  timezone?: string;
}

const CALENDAR_CACHE_MAX = 50;
const UPCOMING_EVENTS_SPOKEN = 3;
const calendarCache = new Map<string, CalendarEntry[]>();

/**
 * MentraOS exposes the calendar as a *push* stream (`session.events.onCalendarEvent`)
 * — there is no request/response calendar API in the SDK — so answering
 * "what's on my calendar" requires caching what the stream has already sent.
 * The bridge feeds this from its session subscription.
 */
export function recordCalendarEvent(sessionId: string, entry: CalendarEntry): void {
  if (!entry.eventId || !entry.title) return;
  const entries = calendarCache.get(sessionId) ?? [];
  const existing = entries.findIndex((candidate) => candidate.eventId === entry.eventId);
  if (existing >= 0) {
    entries[existing] = entry;
  } else {
    entries.push(entry);
  }
  // Bound the cache so a long-lived session cannot grow without limit.
  calendarCache.set(sessionId, entries.slice(-CALENDAR_CACHE_MAX));
}

/** Drop a session's cached calendar events (called on disconnect). */
export function clearCalendarEvents(sessionId: string): void {
  calendarCache.delete(sessionId);
}

/** Test helper. */
export function resetToolState(): void {
  calendarCache.clear();
}

/** Roughly two or three spoken sentences — past this the wearer has stopped listening. */
const SPOKEN_RECALL_MAX_CHARS = 400;

/** Strip inline markdown, keeping the words a person would actually say. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // image -> alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // link -> label, never the URL
    .replace(/`+([^`]*)`+/g, '$1') // inline code
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(?=\S)(.*?\S)\1/g, '$2') // italics
    .replace(/~~(.*?)~~/g, '$1') // strikethrough
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Render a recall block as something a person can listen to.
 *
 * `recall()` returns a *system-prompt* block ("## Relevant context\n- ..."):
 * scaffolding aimed at a language model, not at a human ear. Read aloud
 * verbatim it becomes "hash hash relevant context, dash...". So drop the
 * structural markup entirely (headers are labels for the model, not content
 * for the wearer), turn each surviving line into a sentence, and cap the
 * result — TTS has no scroll bar.
 */
export function toSpeakable(block: string, maxChars = SPOKEN_RECALL_MAX_CHARS): string {
  const sentences: string[] = [];

  for (const rawLine of block.replace(/```[\s\S]*?```/g, ' ').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed)) continue; // header: a label for the model
    if (/^([-*_])\s*(\1\s*){2,}$/.test(trimmed)) continue; // horizontal rule

    const line = stripInlineMarkdown(
      trimmed
        .replace(/^[-*+]\s+/, '') // bullet
        .replace(/^\d+[.)]\s+/, '') // ordered list marker
        .replace(/^>\s?/, '') // blockquote
    );
    if (!line) continue;

    sentences.push(/[.!?]$/.test(line) ? line : `${line}.`);
  }

  const spoken = sentences.join(' ');
  if (spoken.length <= maxChars) return spoken;

  // Prefer to stop on a sentence the wearer heard end; otherwise cut cleanly on
  // a word rather than mid-syllable.
  const clipped = spoken.slice(0, maxChars);
  const lastStop = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '));
  if (lastStop > maxChars / 2) return clipped.slice(0, lastStop + 1);

  const lastSpace = clipped.lastIndexOf(' ');
  const cut = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
  return `${cut.trimEnd().replace(/[,;:]$/, '')}.`;
}

function readString(params: Record<string, unknown> | undefined, key: string): string {
  const value = params?.[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * Format a start time in the event's own timezone — a meeting at 9am reads as
 * 9am to the wearer regardless of where the server happens to run.
 */
function formatStart(entry: CalendarEntry): string {
  const start = new Date(entry.dtStart);
  if (Number.isNaN(start.getTime())) return entry.title;
  try {
    const when = start.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: entry.timezone || undefined,
    });
    return `${entry.title} at ${when}`;
  } catch (err) {
    // An unknown IANA zone makes toLocaleTimeString throw a RangeError.
    logger.debug({ err: (err as Error).message, timezone: entry.timezone }, 'calendar timezone unusable');
    return entry.title;
  }
}

function upcomingEvents(sessionId: string, now: number): CalendarEntry[] {
  return (calendarCache.get(sessionId) ?? [])
    .filter((entry) => {
      const end = new Date(entry.dtEnd || entry.dtStart).getTime();
      return !Number.isNaN(end) && end >= now;
    })
    .sort((a, b) => new Date(a.dtStart).getTime() - new Date(b.dtStart).getTime())
    .slice(0, UPCOMING_EVENTS_SPOKEN);
}

async function rememberThis(call: ToolCallLike, sessionId: string): Promise<string> {
  const content = readString(call.toolParameters, 'content');
  if (!content) return "I didn't catch what you wanted me to remember.";

  const saved = await companionMemory.writeMemory(content, { title: 'Voice note', sessionId });
  return saved ? "Got it — I'll remember that." : "I couldn't save that to memory right now.";
}

async function searchMemory(call: ToolCallLike): Promise<string> {
  const query = readString(call.toolParameters, 'query');
  if (!query) return 'What would you like me to search your memory for?';

  const { block, resultCount } = await companionMemory.recall(query);
  // The block is prompt scaffolding; MentraOS reads this return value straight
  // to the wearer, so it has to be spoken language before it leaves here.
  const spoken = toSpeakable(block);
  if (resultCount === 0 || !spoken) {
    return `I couldn't find anything in your memory about ${query}.`;
  }
  return spoken;
}

function whatsOnMyCalendar(sessionId: string): string {
  const events = upcomingEvents(sessionId, Date.now());
  if (events.length === 0) {
    return "I don't have any upcoming calendar events for you right now.";
  }
  if (events.length === 1) {
    return `Next up: ${formatStart(events[0])}.`;
  }
  return `Coming up: ${events.map(formatStart).join(', then ')}.`;
}

/**
 * Dispatch a MentraOS voice tool call. Always resolves to something speakable —
 * an unknown tool or a memory outage yields a friendly sentence rather than a
 * throw, because MentraOS reads the returned string straight to the wearer.
 */
export async function handleToolCall(call: ToolCallLike, sessionId: string): Promise<string> {
  logger.info({ toolId: call.toolId, sessionId, userId: call.userId }, 'Handling tool call');

  switch (call.toolId) {
    case ToolId.RememberThis:
      return rememberThis(call, sessionId);
    case ToolId.SearchMemory:
      return searchMemory(call);
    case ToolId.WhatsOnMyCalendar:
      return whatsOnMyCalendar(sessionId);
    case ToolId.TakePhoto: {
      const note = readString(call.toolParameters, 'note');
      return note ? `${TAKE_PHOTO_SENTINEL}:${note}` : TAKE_PHOTO_SENTINEL;
    }
    default:
      logger.warn({ toolId: call.toolId }, 'Unknown tool call');
      return "Sorry, I don't know how to do that yet.";
  }
}
