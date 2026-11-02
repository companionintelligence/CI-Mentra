// Settings and the glasses queue, kept as JSON in the app's private documents folder.
import { File, Paths } from 'expo-file-system';

import type { CaptureRecord, CaptureKind } from './records';
import type { CompanionSettings } from './settings';

const SETTINGS_FILE = 'companion-settings.json';
const QUEUE_FILE = 'companion-capture-queue.json';

const KINDS: readonly CaptureKind[] = ['speech', 'input', 'device'];

function fileNamed(name: string): File {
  return new File(Paths.document, name);
}

async function readJson(name: string): Promise<unknown> {
  const file = fileNamed(name);
  if (!file.exists) {
    return null;
  }
  try {
    return JSON.parse(await file.text());
  } catch {
    // A damaged file means "nothing saved"; the next write replaces it.
    return null;
  }
}

function writeJson(name: string, value: unknown): void {
  const file = fileNamed(name);
  file.create({ intermediates: true, overwrite: true });
  file.write(JSON.stringify(value));
}

function isRecord(value: unknown): value is CaptureRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return (
    typeof fields.id === 'string' &&
    typeof fields.at === 'string' &&
    typeof fields.text === 'string' &&
    typeof fields.kind === 'string' &&
    (KINDS as readonly string[]).includes(fields.kind)
  );
}

export function loadSettings(): Promise<unknown> {
  return readJson(SETTINGS_FILE);
}

export async function saveSettings(settings: CompanionSettings): Promise<void> {
  writeJson(SETTINGS_FILE, settings);
}

export async function loadQueue(): Promise<CaptureRecord[]> {
  const raw = await readJson(QUEUE_FILE);
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
}

export async function saveQueue(records: readonly CaptureRecord[]): Promise<void> {
  writeJson(QUEUE_FILE, records);
}
