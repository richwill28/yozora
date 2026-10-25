import { defaultDarkTheme, isDarkTheme, type DarkTheme } from './appearance';

export type ColorMode = 'dark' | 'original';
// PDF.js SidebarView values: closed, thumbnails, outline, attachments, layers.
export type SidebarView = 0 | 1 | 2 | 3 | 4;

export function isSidebarView(value: unknown): value is SidebarView {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4;
}

export interface ReadingState {
  version: 1;
  documentId: string;
  mode: ColorMode;
  theme: DarkTheme;
  page: number;
  zoom: string;
  rotation: number;
  left: number;
  top: number;
  positioned: boolean;
  sidebarView: SidebarView;
}

export interface ViewerStatus {
  phase: 'loading' | 'ready' | 'error';
  mode: ColorMode;
  theme: DarkTheme;
  page: number;
  pages: number;
  worker: boolean;
  message?: string;
}

export interface ViewerConfig {
  documentId: string;
  filename: string;
  defaultMode: ColorMode;
  defaultTheme: DarkTheme;
  pdfModuleUri: string;
  viewerModuleUri: string;
  workerUri: string;
  assetsUri: string;
}

export type HostMessage =
  | { type: 'document'; data: ArrayBuffer; filename: string }
  | { type: 'error'; message: string }
  | { type: 'toggleMode' }
  | { type: 'setTheme'; theme: DarkTheme }
  | { type: 'previewTheme'; theme: DarkTheme }
  | { type: 'cancelThemePreview' };

export type ViewerMessage =
  | { type: 'ready' }
  | { type: 'reload' }
  | { type: 'restart' }
  | { type: 'showCommandPalette' }
  | { type: 'openLink'; url: string }
  | { type: 'status'; status: ViewerStatus };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isColorMode(value: unknown): value is ColorMode {
  return value === 'dark' || value === 'original';
}

export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) {
    return false;
  }

  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isViewerStatus(status: unknown): status is ViewerStatus {
  return (
    isRecord(status) &&
    (status.phase === 'loading' || status.phase === 'ready' || status.phase === 'error') &&
    isColorMode(status.mode) &&
    isDarkTheme(status.theme) &&
    Number.isSafeInteger(status.page) &&
    Number(status.page) >= 1 &&
    Number.isSafeInteger(status.pages) &&
    Number(status.pages) >= 0 &&
    typeof status.worker === 'boolean' &&
    (status.message === undefined ||
      (typeof status.message === 'string' && status.message.length <= 2000))
  );
}

export function isViewerMessage(value: unknown): value is ViewerMessage {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.type) {
    case 'ready':
    case 'reload':
    case 'restart':
    case 'showCommandPalette':
      return true;
    case 'openLink':
      return isSafeExternalUrl(value.url);
    case 'status':
      return isViewerStatus(value.status);
    default:
      return false;
  }
}

function restoreZoom(value: unknown): string {
  if (typeof value !== 'string') {
    return 'auto';
  }

  const isNamedZoom = ['auto', 'page-fit', 'page-width', 'page-height'].includes(value);
  const isNumericZoom = Number(value) >= 0.1 && Number(value) <= 25;
  return isNamedZoom || isNumericZoom ? value : 'auto';
}

function restoreTheme(value: unknown, defaultTheme: DarkTheme): DarkTheme {
  // The retired Soft theme becomes Graphite; missing choices use the configured default.
  if (value === 'soft') {
    return 'graphite';
  }

  return isDarkTheme(value) ? value : defaultTheme;
}

export function restoreState(
  value: unknown,
  documentId: string,
  defaultMode: ColorMode,
  defaultTheme: DarkTheme = defaultDarkTheme,
): ReadingState {
  const fallback: ReadingState = {
    version: 1,
    documentId,
    mode: defaultMode,
    theme: defaultTheme,
    page: 1,
    zoom: 'auto',
    rotation: 0,
    left: 0,
    top: 0,
    positioned: false,
    sidebarView: 0,
  };

  if (!isRecord(value) || value.version !== 1 || value.documentId !== documentId) {
    return fallback;
  }

  return {
    ...fallback,
    mode: isColorMode(value.mode) ? value.mode : defaultMode,
    // Earlier builds stored the theme under "scheme".
    theme: restoreTheme(value.theme ?? value.scheme, defaultTheme),
    page: Number.isSafeInteger(value.page) && Number(value.page) >= 1 ? Number(value.page) : 1,
    zoom: restoreZoom(value.zoom),
    rotation: [0, 90, 180, 270].includes(Number(value.rotation)) ? Number(value.rotation) : 0,
    left: typeof value.left === 'number' && Number.isFinite(value.left) ? value.left : 0,
    top: typeof value.top === 'number' && Number.isFinite(value.top) ? value.top : 0,
    positioned: value.positioned === true,
    sidebarView: isSidebarView(value.sidebarView) ? value.sidebarView : 0,
  };
}
