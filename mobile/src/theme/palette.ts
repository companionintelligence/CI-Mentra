/**
 * Companion brand palette for the phone app.
 *
 * Values mirror the canonical design tokens vendored into this repo at
 * public/brand/tokens/tokens.json (phthalo-mist palette). `palette.spec.ts`
 * fails if they drift, so update both together when the brand canon changes.
 * Pure data only: no React Native imports, so Jest can load it in Node.
 */
export type Palette = {
  scheme: 'light' | 'dark';
  background: string;
  foreground: string;
  card: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  warning: string;
  info: string;
};

export const lightPalette: Palette = {
  scheme: 'light',
  background: '#f3faf7',
  foreground: '#0a222e',
  card: '#f0f9f5',
  primary: '#0a6358',
  primaryForeground: '#f0fdf4',
  muted: '#e8f2ec',
  mutedForeground: '#3a524b',
  border: '#dfece6',
  destructive: '#ee3533',
  destructiveForeground: '#f8fafc',
  success: '#0f5132',
  warning: '#855500',
  info: '#0284c7',
};

export const darkPalette: Palette = {
  scheme: 'dark',
  background: '#041620',
  foreground: '#e8f2f4',
  card: '#0c323c',
  primary: '#c5e8dc',
  primaryForeground: '#041620',
  muted: '#073038',
  mutedForeground: '#a3babf',
  border: '#073038',
  destructive: '#ef7070',
  destructiveForeground: '#f5f8fa',
  success: '#34d399',
  warning: '#fbbf24',
  info: '#38bdf8',
};

/** Which canonical token each palette key mirrors (light and dark use the same names). */
export const TOKEN_SOURCES: Record<Exclude<keyof Palette, 'scheme'>, { group: 'core' | 'status'; token: string }> = {
  background: { group: 'core', token: 'background' },
  foreground: { group: 'core', token: 'foreground' },
  card: { group: 'core', token: 'card' },
  primary: { group: 'core', token: 'primary' },
  primaryForeground: { group: 'core', token: 'primary-foreground' },
  muted: { group: 'core', token: 'muted' },
  mutedForeground: { group: 'core', token: 'muted-foreground' },
  border: { group: 'core', token: 'border' },
  destructive: { group: 'core', token: 'destructive' },
  destructiveForeground: { group: 'core', token: 'destructive-foreground' },
  success: { group: 'status', token: 'success' },
  warning: { group: 'status', token: 'warning' },
  info: { group: 'status', token: 'info' },
};
