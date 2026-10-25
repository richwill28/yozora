import {
  isRecord,
  isSidebarView,
  isSafeExternalUrl,
  restoreState,
  type HostMessage,
  type ViewerConfig,
  type ViewerMessage,
  type ViewerStatus,
} from '../shared/protocol';
import type { PdfViewerApplication, PdfViewerWindow } from './pdfjsTypes';
import { darkThemes, isDarkTheme, type DarkTheme } from '../shared/appearance';

declare function acquireVsCodeApi(): {
  postMessage(message: ViewerMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// This configuration is serialized by our host HTML adapter, not supplied by the PDF.
const config = JSON.parse(document.getElementById('yozora-config')!.textContent!) as ViewerConfig;
const statusBox = document.getElementById('yozora-status')!;
const statusText = document.getElementById('yozora-status-text')!;
const retryButton = document.getElementById('yozora-retry') as HTMLButtonElement;

let state = restoreState(
  vscode.getState(),
  config.documentId,
  config.defaultMode,
  config.defaultTheme,
);
let previewTheme: DarkTheme | undefined;
let application: PdfViewerApplication | undefined;
let worker: Worker | undefined;
let workerUrl: string | undefined;
let phase: ViewerStatus['phase'] = 'loading';
let isRestoringPosition = true;
let isOpeningDocument = false;
let restartRequired = false;
let pendingDocument: Extract<HostMessage, { type: 'document' }> | undefined;

function reportStatus(message?: string): void {
  vscode.postMessage({
    type: 'status',
    status: {
      phase,
      mode: state.mode,
      theme: state.theme,
      page: Math.max(1, application?.page || state.page),
      pages: application?.pagesCount || 0,
      worker: !!worker,
      ...(message ? { message: message.slice(0, 2000) } : {}),
    },
  });
}

function applyAppearance(): void {
  const root = document.documentElement;
  const theme = previewTheme ?? state.theme;

  root.dataset.yozoraMode = previewTheme ? 'dark' : state.mode;
  root.dataset.yozoraTheme = theme;
  root.style.setProperty('--yozora-page-filter', darkThemes[theme].filter);
}

function saveAppearance(): void {
  applyAppearance();
  vscode.setState(state);
  reportStatus();
}

function toggleMode(): void {
  previewTheme = undefined;
  state.mode = state.mode === 'dark' ? 'original' : 'dark';
  saveAppearance();
}

function showError(error: unknown, restart = false): void {
  phase = 'error';
  restartRequired ||= restart;

  const message = error instanceof Error ? error.message : String(error);
  statusText.textContent = `Unable to open PDF: ${message}`;
  statusBox.hidden = false;
  retryButton.hidden = false;
  document.body.dataset.yozoraStatus = phase;
  reportStatus(message);
}

// Keep the viewer bound to the editor's document and delegate external navigation to VS Code.
function handleLink(event: MouseEvent): void {
  const anchor = event.target instanceof Element ? event.target.closest('a') : null;
  if (
    !anchor ||
    anchor.classList.contains('internalLink') ||
    anchor.getAttribute('href')?.startsWith('#')
  ) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  if (isSafeExternalUrl(anchor.href)) {
    vscode.postMessage({ type: 'openLink', url: anchor.href });
  }
}

function handleHostMessage(event: MessageEvent<unknown>): void {
  const message = event.data;
  if (!isRecord(message)) {
    return;
  }

  switch (message.type) {
    case 'toggleMode':
      toggleMode();
      break;

    case 'setTheme':
      if (isDarkTheme(message.theme)) {
        previewTheme = undefined;
        state = { ...state, theme: message.theme, mode: 'dark' };
        saveAppearance();
      }
      break;

    case 'previewTheme':
      if (isDarkTheme(message.theme)) {
        // Previews never enter saved state, even when scrolling or reloading the PDF.
        previewTheme = message.theme;
        applyAppearance();
      }
      break;

    case 'cancelThemePreview':
      previewTheme = undefined;
      applyAppearance();
      break;

    case 'error':
      if (typeof message.message === 'string') {
        showError(message.message);
      }
      break;

    case 'document':
      if (message.data instanceof ArrayBuffer && typeof message.filename === 'string') {
        pendingDocument = { type: 'document', data: message.data, filename: message.filename };
        void openPendingDocument();
      }
      break;
  }
}

async function openPendingDocument(): Promise<void> {
  if (!application || isOpeningDocument || !pendingDocument || restartRequired) {
    return;
  }

  isOpeningDocument = true;
  try {
    while (pendingDocument) {
      const message = pendingDocument;
      pendingDocument = undefined;

      phase = 'loading';
      document.body.dataset.yozoraStatus = phase;
      isRestoringPosition = true;
      statusText.textContent = 'Opening PDF...';
      statusBox.hidden = false;
      retryButton.hidden = true;
      reportStatus();

      await application.close();
      // Hidden tabs are recreated by VS Code. Restore the reader's choice on
      // both webview initialization and in-place PDF reloads; new readers use NONE.
      (window as unknown as PdfViewerWindow).PDFViewerApplicationOptions.setAll({
        sidebarViewOnLoad: state.sidebarView,
      });
      const zoom = Number.isFinite(Number(state.zoom))
        ? String(Number(state.zoom) * 100)
        : state.zoom;
      // PDF coordinates start at the bottom left: (0, 0) would open at the foot of page 1.
      // Omit coordinates until there is a real saved scroll position.
      // PDF.js's hash parser truncates coordinates to integers. Round as its own
      // bookmark writer does, so fractional A4 page heights do not shift the
      // viewport just inside a page and select the following page at low zoom.
      const position = state.positioned
        ? `,${Math.round(state.left)},${Math.round(state.top)}`
        : '';
      application.initialBookmark = `page=${state.page}&zoom=${zoom}${position}`;
      application.initialRotation = state.rotation;

      await application.open({
        data: new Uint8Array(message.data),
        filename: message.filename,
        isEvalSupported: false,
        useWorkerFetch: false,
      });
    }
  } catch (error) {
    showError(error);
  } finally {
    isOpeningDocument = false;
    if (pendingDocument && !restartRequired) {
      void openPendingDocument();
    }
  }
}

async function createWorker(): Promise<void> {
  // Webview workers must load from blob: URLs; direct vscode-webview-resource URLs are unsupported.
  const response = await fetch(config.workerUri);
  if (!response.ok) {
    throw new Error(`Cannot load PDF worker (HTTP ${response.status}).`);
  }

  const workerSource = (await response.text()).replace(
    /\/\/# sourceMappingURL=.*$/m,
    `//# sourceMappingURL=${config.workerUri}.map`,
  );
  workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  worker = new Worker(workerUrl, { type: 'module', name: 'yozora-pdfjs' });
  worker.addEventListener('error', () => {
    worker?.terminate();
    worker = undefined;
    showError('The PDF rendering worker failed. Retry to restart the viewer.', true);
  });
}

function configureViewer(): void {
  (window as unknown as PdfViewerWindow).PDFViewerApplicationOptions.setAll({
    defaultUrl: '',
    disablePreferences: true,
    disableHistory: true,
    viewOnLoad: 1,
    workerPort: worker,
    workerSrc: workerUrl,

    // Keep the generic viewer read-only and disable optional document features.
    enableScripting: false,
    annotationEditorMode: -1,
    annotationMode: 1,
    enableXfa: false,
    enableComment: false,
    enableAltText: false,
    enableAltTextModelDownload: false,
    enableGuessAltText: false,
    enableSignatureEditor: false,
    enableSignatureVerification: false,
    enableMerge: false,
    enableSplitMerge: false,
    enablePermissions: true,
    supportsPrinting: false,
    externalLinkTarget: 2,
    enableWebGPU: false,

    cMapUrl: config.assetsUri + 'cmaps/',
    standardFontDataUrl: config.assetsUri + 'standard_fonts/',
    wasmUrl: config.assetsUri + 'wasm/',
    iccUrl: config.assetsUri + 'iccs/',
    imageResourcesPath: config.assetsUri + 'images/',
  });
}

function observeViewer(viewer: PdfViewerApplication): void {
  viewer.eventBus.on('sidebarviewchanged', (event) => {
    // Closing/reopening a document resets the PDF.js sidebar. Those intermediate
    // events must not overwrite the saved choice before restoration finishes.
    if (isRestoringPosition || !isSidebarView(event.view)) {
      return;
    }
    state = { ...state, sidebarView: event.view };
    vscode.setState(state);
  });

  viewer.eventBus.on('pagerender', (event) => {
    // PDF.js emits this synchronously before its render-task promise initializes the context.
    // An alpha-enabled canvas uses grayscale antialiasing, avoiding colored LCD fringes
    // when inversion is applied. This preserves colored figures and also covers detail canvases.
    event.source?.canvas?.getContext('2d', { alpha: true, willReadFrequently: true });
  });

  viewer.eventBus.on('documentinit', () => {
    isRestoringPosition = false;
  });

  viewer.eventBus.on('pagerendered', (event) => {
    if (event.error) {
      showError(event.error);
      return;
    }

    // Background page renders must not hide a file-read, page-render, or fatal worker error.
    // A new document load or explicit Retry clears the error instead.
    if (phase === 'error' || restartRequired) {
      return;
    }

    phase = 'ready';
    statusBox.hidden = true;
    document.body.dataset.yozoraStatus = phase;
    reportStatus();
  });

  viewer.eventBus.on('updateviewarea', (event) => {
    if (isRestoringPosition || !application?.pdfDocument) {
      return;
    }

    state = {
      ...state,
      page: application.page,
      zoom: String(application.pdfViewer.currentScaleValue),
      rotation: application.pdfViewer.pagesRotation,
      left: event.location?.left ?? state.left,
      top: event.location?.top ?? state.top,
      positioned: !!event.location || state.positioned,
    };
    vscode.setState(state);
    reportStatus();
  });
}

async function startViewer(): Promise<void> {
  await createWorker();
  await import(/* @vite-ignore */ config.pdfModuleUri);

  document.addEventListener('webviewerloaded', configureViewer, { once: true });
  // In an ordinary browser harness the generic viewer dispatches on parent.document.
  try {
    if (parent !== window) {
      parent.document.addEventListener('webviewerloaded', configureViewer, { once: true });
    }
  } catch {
    /* VS Code isolates the parent origin. */
  }

  await import(/* @vite-ignore */ config.viewerModuleUri);
  application = (window as unknown as PdfViewerWindow).PDFViewerApplication;
  await application.initializedPromise;

  observeViewer(application);
  vscode.postMessage({ type: 'ready' });
}

saveAppearance();

retryButton.addEventListener('click', () => {
  if (!application || restartRequired) {
    vscode.postMessage({ type: 'restart' });
  } else {
    vscode.postMessage({ type: 'reload' });
  }
});

document.addEventListener('click', handleLink, true);
document.addEventListener(
  'auxclick',
  (event) => {
    if (event.button === 1) {
      handleLink(event);
    }
  },
  true,
);

document.addEventListener(
  'drop',
  (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);

window.addEventListener(
  'keydown',
  (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && ['o', 's', 'p'].includes(key)) {
      event.preventDefault();
      event.stopImmediatePropagation();

      // PDF.js also captures Ctrl/Cmd+Shift+P for printing, even with printing disabled.
      // Ask the host to open its palette before blocking PDF.js's file shortcuts.
      if (key === 'p' && event.shiftKey && !event.altKey) {
        vscode.postMessage({ type: 'showCommandPalette' });
      }
    }
  },
  true,
);

window.addEventListener('message', handleHostMessage);

window.addEventListener('pagehide', () => {
  worker?.terminate();
  if (workerUrl) {
    URL.revokeObjectURL(workerUrl);
  }
});

void startViewer().catch((error) => showError(error, true));
