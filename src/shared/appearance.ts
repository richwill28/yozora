// Strengthen partially covered text pixels before inversion: simply inverting
// antialiased black-on-white text leaves thin strokes faint on dark backgrounds.
// Keep the black/white endpoints fixed so Dracula's palette remains unchanged.
// https://github.com/dracula/visual-studio-code/blob/master/src/dracula.yml
const draculaTransfer = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="dracula" color-interpolation-filters="sRGB">
<feComponentTransfer>
  <feFuncR type="gamma" amplitude="1" exponent="1.5" offset="0"/>
  <feFuncG type="gamma" amplitude="1" exponent="1.5" offset="0"/>
  <feFuncB type="gamma" amplitude="1" exponent="1.5" offset="0"/>
</feComponentTransfer>
<feComponentTransfer>
  <feFuncR type="table" tableValues="1 0"/>
  <feFuncG type="table" tableValues="1 0"/>
  <feFuncB type="table" tableValues="1 0"/>
</feComponentTransfer>
<feColorMatrix type="hueRotate" values="180"/>
<feComponentTransfer>
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
    filter: `url("data:image/svg+xml,${encodeURIComponent(draculaTransfer)}#dracula")`,
  },
} as const;

export type DarkTheme = keyof typeof darkThemes;

export const defaultDarkTheme: DarkTheme = 'midnight';

export function isDarkTheme(value: unknown): value is DarkTheme {
  return typeof value === 'string' && Object.hasOwn(darkThemes, value);
}
