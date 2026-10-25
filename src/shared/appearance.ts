// Map inverted black/white to Dracula's VS Code background/foreground in sRGB.
// https://github.com/dracula/visual-studio-code/blob/master/src/dracula.yml
const draculaTransfer = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="dracula" color-interpolation-filters="sRGB"><feComponentTransfer>
  <feFuncR type="table" tableValues="${40 / 255} ${248 / 255}"/>
  <feFuncG type="table" tableValues="${42 / 255} ${248 / 255}"/>
  <feFuncB type="table" tableValues="${54 / 255} ${242 / 255}"/>
</feComponentTransfer></filter></svg>`;

// Graphite and Midnight keep grayscale text neutral, including antialiased edges.
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
  dracula: {
    label: 'Dracula',
    description: 'VS Code palette',
    detail: 'Off-white text on a blue-gray background, using Dracula’s VS Code colors.',
    filter: `invert(1) hue-rotate(180deg) url("data:image/svg+xml,${encodeURIComponent(draculaTransfer)}#dracula")`,
  },
} as const;

export type DarkTheme = keyof typeof darkThemes;

export const defaultDarkTheme: DarkTheme = 'midnight';

export function isDarkTheme(value: unknown): value is DarkTheme {
  return typeof value === 'string' && Object.hasOwn(darkThemes, value);
}
