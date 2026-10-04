// Neutral palettes keep grayscale text neutral, including antialiased edges.
// Filters affect the complete page, so original colors remain essential for figures.
export const darkThemes = {
  graphite: {
    label: 'Graphite',
    description: 'Balanced',
    detail: 'Light gray text on charcoal.',
    filter: 'invert(0.9) hue-rotate(180deg)',
  },
  midnight: {
    label: 'Midnight',
    description: 'High contrast',
    detail: 'Bright text against a moonless sky.',
    filter: 'invert(0.95) hue-rotate(180deg)',
  },
} as const;

export type DarkTheme = keyof typeof darkThemes;

export const defaultDarkTheme: DarkTheme = 'midnight';

export function isDarkTheme(value: unknown): value is DarkTheme {
  return typeof value === 'string' && Object.hasOwn(darkThemes, value);
}
