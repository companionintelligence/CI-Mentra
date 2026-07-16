jest.mock('../../memory/companion-memory', () => ({
  recall: jest.fn(),
  writeMemory: jest.fn(),
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  handleToolCall,
  recordCalendarEvent,
  clearCalendarEvents,
  resetToolState,
  isTakePhotoSentinel,
  takePhotoNote,
  toSpeakable,
  TAKE_PHOTO_SENTINEL,
  ToolId,
} from '../../mentra/tools';
import { parseRememberCommand } from '../../agent/answer-service';
import * as memory from '../../memory/companion-memory';

const mockedMemory = memory as jest.Mocked<typeof memory>;

interface ManifestTool {
  id: string;
  activationPhrases?: string[];
}

/** Read the shipped manifest, not a copy — these assertions are about what deploys. */
const manifest = JSON.parse(
  readFileSync(join(__dirname, '../../../app_config.json'), 'utf8')
) as { tools: ManifestTool[] };

beforeEach(() => {
  jest.clearAllMocks();
  resetToolState();
  mockedMemory.writeMemory.mockResolvedValue(true);
  mockedMemory.recall.mockResolvedValue({ block: '', resultCount: 0 });
});

describe('remember_this', () => {
  it('writes the content to durable memory and confirms', async () => {
    const result = await handleToolCall(
      { toolId: ToolId.RememberThis, toolParameters: { content: 'the gate code is 4821' } },
      's1'
    );

    expect(mockedMemory.writeMemory).toHaveBeenCalledWith(
      'the gate code is 4821',
      expect.objectContaining({ sessionId: 's1' })
    );
    expect(result).toMatch(/remember/i);
  });

  it('reports failure when the memory write fails', async () => {
    mockedMemory.writeMemory.mockResolvedValue(false);
    const result = await handleToolCall(
      { toolId: ToolId.RememberThis, toolParameters: { content: 'something' } },
      's1'
    );
    expect(result).toMatch(/couldn't save/i);
  });

  it('asks again when no content was captured', async () => {
    const result = await handleToolCall({ toolId: ToolId.RememberThis, toolParameters: {} }, 's1');
    expect(mockedMemory.writeMemory).not.toHaveBeenCalled();
    expect(result).toMatch(/didn't catch/i);
  });
});

describe('toSpeakable', () => {
  it('drops the prompt header and turns bullets into sentences', () => {
    expect(toSpeakable('## Relevant context\n- Gate code 4821\n- Parked on level 3')).toBe(
      'Gate code 4821. Parked on level 3.'
    );
  });

  it('keeps punctuation that is already there', () => {
    expect(toSpeakable('- You said the meeting moved to Tuesday.')).toBe(
      'You said the meeting moved to Tuesday.'
    );
  });

  it('speaks a link label rather than reading out the URL', () => {
    expect(toSpeakable('- See [the runbook](https://example.com/a/very/long/url)')).toBe(
      'See the runbook.'
    );
  });

  it('strips emphasis, inline code and ordered-list markers', () => {
    expect(toSpeakable('1. The **API key** is `abc123`')).toBe('The API key is abc123.');
  });

  it('drops horizontal rules and fenced code blocks', () => {
    expect(toSpeakable('---\nA fact worth keeping\n```\nnot speech\n```')).toBe('A fact worth keeping.');
  });

  it('is empty when the block carries no spoken content', () => {
    expect(toSpeakable('## Header only\n\n---')).toBe('');
    expect(toSpeakable('   ')).toBe('');
  });

  it('caps a long recall on a sentence boundary the wearer heard end', () => {
    const block = ['- ' + 'a'.repeat(40) + '.', '- ' + 'b'.repeat(40) + '.', '- ' + 'c'.repeat(40) + '.'].join('\n');

    const spoken = toSpeakable(block, 100);

    expect(spoken.length).toBeLessThanOrEqual(100);
    expect(spoken).toBe(`${'a'.repeat(40)}. ${'b'.repeat(40)}.`);
  });

  it('cuts on a word boundary when not even one sentence fits', () => {
    const spoken = toSpeakable(`- ${'word '.repeat(50)}`, 20);

    expect(spoken.length).toBeLessThanOrEqual(21);
    expect(spoken.endsWith('.')).toBe(true);
    // never mid-word: every token but the last is a whole "word"
    expect(spoken.replace(/\.$/, '').split(' ').every((w) => w === 'word')).toBe(true);
  });
});

describe('search_memory', () => {
  it('returns the recalled block when memory has results', async () => {
    mockedMemory.recall.mockResolvedValue({ block: '## Relevant\nGate code 4821', resultCount: 2 });

    const result = await handleToolCall(
      { toolId: ToolId.SearchMemory, toolParameters: { query: 'gate code' } },
      's1'
    );

    expect(mockedMemory.recall).toHaveBeenCalledWith('gate code');
    expect(result).toContain('Gate code 4821');
  });

  it('speaks recalled memory as sentences, never as a raw prompt block', async () => {
    mockedMemory.recall.mockResolvedValue({
      block: '## Relevant context\n- The gate code is **4821**\n- Parked on level 3\n',
      resultCount: 2,
    });

    const result = await handleToolCall(
      { toolId: ToolId.SearchMemory, toolParameters: { query: 'gate code' } },
      's1'
    );

    // MentraOS reads this string straight to the wearer: no "hash hash", no "dash".
    expect(result).toBe('The gate code is 4821. Parked on level 3.');
    expect(result).not.toContain('Relevant context');
    expect(result).not.toMatch(/[#*`]/);
    expect(result).not.toMatch(/^\s*-\s/m);
  });

  it('answers friendly when nothing is found', async () => {
    const result = await handleToolCall(
      { toolId: ToolId.SearchMemory, toolParameters: { query: 'my yacht' } },
      's1'
    );
    expect(result).toMatch(/couldn't find anything/i);
    expect(result).toContain('my yacht');
  });

  it('treats a present-but-empty block as no results', async () => {
    mockedMemory.recall.mockResolvedValue({ block: '   ', resultCount: 3 });
    const result = await handleToolCall(
      { toolId: ToolId.SearchMemory, toolParameters: { query: 'anything' } },
      's1'
    );
    expect(result).toMatch(/couldn't find anything/i);
  });

  it('asks for a query when none was captured', async () => {
    const result = await handleToolCall({ toolId: ToolId.SearchMemory }, 's1');
    expect(mockedMemory.recall).not.toHaveBeenCalled();
    expect(result).toMatch(/what would you like/i);
  });
});

describe('take_photo', () => {
  it('returns the bare sentinel so the bridge performs the capture', async () => {
    const result = await handleToolCall({ toolId: ToolId.TakePhoto }, 's1');
    expect(result).toBe(TAKE_PHOTO_SENTINEL);
    expect(isTakePhotoSentinel(result)).toBe(true);
    expect(takePhotoNote(result)).toBe('');
  });

  it('carries the wearer note through the sentinel', async () => {
    const result = await handleToolCall(
      { toolId: ToolId.TakePhoto, toolParameters: { note: 'my parking spot' } },
      's1'
    );
    expect(isTakePhotoSentinel(result)).toBe(true);
    expect(takePhotoNote(result)).toBe('my parking spot');
  });

  it('does not mistake an ordinary answer for a capture cue', () => {
    expect(isTakePhotoSentinel('Got it — I will remember that.')).toBe(false);
  });
});

describe('whats_on_my_calendar', () => {
  const future = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

  it('reports nothing when the calendar stream has sent no events', async () => {
    const result = await handleToolCall({ toolId: ToolId.WhatsOnMyCalendar }, 's1');
    expect(result).toMatch(/don't have any upcoming/i);
  });

  it('announces the single upcoming event', async () => {
    recordCalendarEvent('s1', {
      eventId: 'e1',
      title: 'Standup',
      dtStart: future(30),
      dtEnd: future(45),
      timezone: 'UTC',
    });

    const result = await handleToolCall({ toolId: ToolId.WhatsOnMyCalendar }, 's1');
    expect(result).toContain('Standup');
    expect(result).toMatch(/next up/i);
  });

  it('orders multiple events by start time and caps the list at three', async () => {
    recordCalendarEvent('s1', { eventId: 'e3', title: 'Third', dtStart: future(300), timezone: 'UTC' });
    recordCalendarEvent('s1', { eventId: 'e1', title: 'First', dtStart: future(10), timezone: 'UTC' });
    recordCalendarEvent('s1', { eventId: 'e4', title: 'Fourth', dtStart: future(400), timezone: 'UTC' });
    recordCalendarEvent('s1', { eventId: 'e2', title: 'Second', dtStart: future(100), timezone: 'UTC' });

    const result = await handleToolCall({ toolId: ToolId.WhatsOnMyCalendar }, 's1');

    expect(result.indexOf('First')).toBeLessThan(result.indexOf('Second'));
    expect(result.indexOf('Second')).toBeLessThan(result.indexOf('Third'));
    expect(result).not.toContain('Fourth');
  });

  it('ignores events that already ended', async () => {
    recordCalendarEvent('s1', {
      eventId: 'past',
      title: 'Yesterday sync',
      dtStart: new Date(Date.now() - 120 * 60_000).toISOString(),
      dtEnd: new Date(Date.now() - 60 * 60_000).toISOString(),
      timezone: 'UTC',
    });

    const result = await handleToolCall({ toolId: ToolId.WhatsOnMyCalendar }, 's1');
    expect(result).toMatch(/don't have any upcoming/i);
  });

  it('renders the start time in the event timezone', async () => {
    recordCalendarEvent('s1', {
      eventId: 'e1',
      title: 'Flight',
      dtStart: '2999-01-01T15:30:00.000Z',
      timezone: 'UTC',
    });

    const result = await handleToolCall({ toolId: ToolId.WhatsOnMyCalendar }, 's1');
    expect(result).toContain('Flight at 3:30 PM');
  });

  it('falls back to the bare title when the timezone is unusable', async () => {
    recordCalendarEvent('s1', {
      eventId: 'e1',
      title: 'Mystery',
      dtStart: '2999-01-01T15:30:00.000Z',
      timezone: 'Not/AZone',
    });

    const result = await handleToolCall({ toolId: ToolId.WhatsOnMyCalendar }, 's1');
    expect(result).toContain('Mystery');
  });

  it('keeps each session\'s calendar separate and clears on demand', async () => {
    recordCalendarEvent('s1', { eventId: 'e1', title: 'Standup', dtStart: future(30), timezone: 'UTC' });

    expect(await handleToolCall({ toolId: ToolId.WhatsOnMyCalendar }, 's2')).toMatch(/don't have any upcoming/i);

    clearCalendarEvents('s1');
    expect(await handleToolCall({ toolId: ToolId.WhatsOnMyCalendar }, 's1')).toMatch(/don't have any upcoming/i);
  });

  it('deduplicates repeated pushes of the same event', async () => {
    recordCalendarEvent('s1', { eventId: 'e1', title: 'Standup', dtStart: future(30), timezone: 'UTC' });
    recordCalendarEvent('s1', { eventId: 'e1', title: 'Standup (moved)', dtStart: future(45), timezone: 'UTC' });

    const result = await handleToolCall({ toolId: ToolId.WhatsOnMyCalendar }, 's1');
    expect(result).toContain('Standup (moved)');
    expect(result).toMatch(/next up/i);
  });
});

describe('unknown tools', () => {
  it('answers friendly instead of throwing', async () => {
    const result = await handleToolCall({ toolId: 'launch_the_missiles' }, 's1');
    expect(result).toMatch(/don't know how to do that/i);
  });
});

/**
 * One utterance must be handled by exactly one path.
 *
 * MentraOS Cloud activates a tool on an activation phrase, while the bridge's own
 * VAD/STT loop independently feeds every utterance to answer-service — whose
 * `parseRememberCommand` regex writes memory on its own. Any phrase claimed by
 * both double-writes the wearer's memory and speaks twice.
 *
 * These are the deterministic guard: rather than a timing window on the bridge,
 * the manifest and the regex are kept provably disjoint, and this fails loudly
 * the moment either side drifts.
 */
describe('tool activation phrases vs the local remember regex', () => {
  const phrases = manifest.tools.flatMap((tool) =>
    (tool.activationPhrases ?? []).map((phrase) => [tool.id, phrase] as const)
  );

  it('ships activation phrases to check', () => {
    expect(phrases.length).toBeGreaterThan(0);
  });

  it.each(phrases)('%s: "%s" is not also claimed by parseRememberCommand', (_toolId, phrase) => {
    // The wearer says the phrase and then the thing they mean.
    expect(parseRememberCommand(`${phrase} the gate code is 4821`)).toBeNull();
    expect(parseRememberCommand(`${phrase}: the gate code is 4821`)).toBeNull();
  });

  it('leaves the natural "remember this/that …" forms to the local regex alone', () => {
    // These are the phrases the regex claims, so the tool must not advertise them.
    expect(parseRememberCommand('remember this the gate code is 4821')).not.toBeNull();
    expect(parseRememberCommand('remember that the gate code is 4821')).not.toBeNull();

    const rememberTool = manifest.tools.find((tool) => tool.id === ToolId.RememberThis);
    expect(rememberTool?.activationPhrases).toEqual(
      expect.not.arrayContaining(['remember this', 'remember that'])
    );
  });
});

describe('manifest tools', () => {
  it('declares only tools that actually have a handler', async () => {
    for (const tool of manifest.tools) {
      const result = await handleToolCall({ toolId: tool.id, toolParameters: {} }, 's1');
      expect(result).not.toMatch(/don't know how to do that/i);
    }
  });

  it('has a ToolId constant for every manifest tool', () => {
    expect(manifest.tools.map((t) => t.id).sort()).toEqual(Object.values(ToolId).sort());
  });
});
