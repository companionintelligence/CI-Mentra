import tokens from '../../../public/brand/tokens/tokens.json';
import { darkPalette, lightPalette, TOKEN_SOURCES, type Palette } from './palette';

type TokenGroup = Record<string, { hex?: string }>;

const sources: Record<'light' | 'dark', Record<'core' | 'status', TokenGroup>> = {
  light: { core: tokens.light, status: tokens.status.light },
  dark: { core: tokens.dark, status: tokens.status.dark },
};

describe('brand palette', () => {
  test.each([
    ['light', lightPalette],
    ['dark', darkPalette],
  ] as const)('%s palette matches the vendored brand tokens', (scheme, palette: Palette) => {
    expect(palette.scheme).toBe(scheme);
    for (const [key, source] of Object.entries(TOKEN_SOURCES)) {
      const expected = sources[scheme][source.group][source.token]?.hex;
      expect({ key, hex: palette[key as keyof typeof TOKEN_SOURCES].toLowerCase() }).toEqual({ key, hex: expected });
    }
  });

  test('never uses a retired brand colour', () => {
    const retired = tokens.retired.flatMap((entry) => (entry.hex ? [entry.hex.toLowerCase()] : []));
    const used = [...Object.values(lightPalette), ...Object.values(darkPalette)].map((value) => value.toLowerCase());
    for (const hex of retired) {
      expect(used).not.toContain(hex);
    }
  });
});
