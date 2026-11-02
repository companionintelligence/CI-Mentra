import { normalizeApplianceUrl } from './config';

/** What the user chose on the phone. Stored on the phone only. */
export interface CompanionSettings {
  /** Origin of the appliance, or '' until one is set. */
  applianceUrl: string;
  /** Master switch. Nothing from the glasses is stored while this is off. */
  captureEnabled: boolean;
  /** Final transcripts of what the wearer says, through the glasses microphone. */
  captureSpeech: boolean;
  /** Button presses, touch gestures and head movement. */
  captureInput: boolean;
  /** Battery level and connection changes. */
  captureDevice: boolean;
}

export const DEFAULT_SETTINGS: CompanionSettings = {
  applianceUrl: '',
  captureEnabled: false,
  captureSpeech: true,
  captureInput: true,
  captureDevice: true,
};

/**
 * Read stored settings defensively. A missing or damaged file gives the
 * defaults, and a field that is the wrong type falls back to its default. The
 * appliance address is normalized again, so a hand-edited file cannot point the
 * app somewhere the UI would refuse.
 */
export function parseSettings(raw: unknown): CompanionSettings {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_SETTINGS };
  }
  const fields = raw as Record<string, unknown>;
  const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
  const applianceUrl =
    typeof fields.applianceUrl === 'string' ? normalizeApplianceUrl(fields.applianceUrl) : null;

  return {
    applianceUrl: applianceUrl ?? DEFAULT_SETTINGS.applianceUrl,
    captureEnabled: flag(fields.captureEnabled, DEFAULT_SETTINGS.captureEnabled),
    captureSpeech: flag(fields.captureSpeech, DEFAULT_SETTINGS.captureSpeech),
    captureInput: flag(fields.captureInput, DEFAULT_SETTINGS.captureInput),
    captureDevice: flag(fields.captureDevice, DEFAULT_SETTINGS.captureDevice),
  };
}
