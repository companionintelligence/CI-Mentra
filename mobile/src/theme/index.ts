import { Platform, useColorScheme } from 'react-native';

import type { Tone } from '../lib/glassesStatus';
import { darkPalette, lightPalette, type Palette } from './palette';

export type { Palette } from './palette';

/** Follows the phone's light or dark appearance. */
export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? darkPalette : lightPalette;
}

export function toneColor(palette: Palette, tone: Tone): string {
  switch (tone) {
    case 'success':
      return palette.success;
    case 'progress':
      return palette.info;
    case 'warning':
      return palette.warning;
    case 'danger':
      return palette.destructive;
    case 'neutral':
      return palette.mutedForeground;
  }
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** Brand radius base is 0.625rem (10px). */
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

export const monoFont = Platform.select({ ios: 'Menlo', default: 'monospace' });
