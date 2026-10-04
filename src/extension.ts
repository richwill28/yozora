import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { posix } from 'node:path';

import { renderViewerHtml } from './host/html';
import { readPdf } from './host/readPdf';
import { CoalescingReader } from './host/coalescingReader';
import {
  isColorMode,
  isViewerMessage,
  type HostMessage,
  type ViewerStatus,
} from './shared/protocol';
import { darkThemes, defaultDarkTheme, isDarkTheme, type DarkTheme } from './shared/appearance';

const viewType = 'yozora.pdf';

class PdfDocument implements vscode.CustomDocument {
  private readonly changes = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changes.event;
  private readonly watcher: vscode.FileSystemWatcher;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private readonly reader = new CoalescingReader(() => this.readBytes());

  constructor(readonly uri: vscode.Uri) {
    const directory = uri.with({ path: posix.dirname(uri.path) });
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(directory, '*'),
    );

    const changed = (candidate: vscode.Uri) => {
      if (candidate.toString() !== uri.toString()) {
        return;
      }

      this.reader.invalidate();
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.changes.fire(), 200);
    };

    this.watcher.onDidChange(changed);
    this.watcher.onDidCreate(changed);
    this.watcher.onDidDelete(changed);
  }

  read(): Promise<ArrayBuffer> {
    return this.reader.read();
  }

  private async readBytes(): Promise<ArrayBuffer> {
    if (this.closed) {
      throw new Error('This PDF editor is closed.');
    }

    const configured = vscode.workspace
      .getConfiguration('yozora', this.uri)
      .get<number>('maxFileSizeMiB', 100);
    const maxMiB =
      typeof configured === 'number' && Number.isFinite(configured)
        ? Math.min(512, Math.max(1, configured))
        : 100;

    return readPdf(
      {
        stat: () => vscode.workspace.fs.stat(this.uri),
        read: () => vscode.workspace.fs.readFile(this.uri),
      },
      maxMiB * 1024 * 1024,
    );
  }

  dispose(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.watcher.dispose();
    this.changes.dispose();
  }
}

export interface YozoraApi {
  getViewerStatus(uri: vscode.Uri): readonly ViewerStatus[];
}

interface PanelState {
  uri: vscode.Uri;
  status: ViewerStatus;
}

class PdfProvider implements vscode.CustomReadonlyEditorProvider<PdfDocument>, YozoraApi {
  private readonly panels = new Map<vscode.WebviewPanel, PanelState>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): PdfDocument {
    return new PdfDocument(uri);
  }

  async resolveCustomEditor(
    document: PdfDocument,
    panel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const pdfAssets = vscode.Uri.joinPath(this.context.extensionUri, 'vendor/pdfjs');
    const webviewAssets = vscode.Uri.joinPath(this.context.extensionUri, 'dist/webview');
    panel.webview.options = { enableScripts: true, localResourceRoots: [pdfAssets, webviewAssets] };

    const configuredMode = vscode.workspace
      .getConfiguration('yozora', document.uri)
      .get('defaultMode');
    const mode = isColorMode(configuredMode) ? configuredMode : 'dark';
    const configuredTheme = vscode.workspace
      .getConfiguration('yozora', document.uri)
      .get('defaultTheme');
    const theme = isDarkTheme(configuredTheme) ? configuredTheme : defaultDarkTheme;

    const entry: PanelState = {
      uri: document.uri,
      status: { phase: 'loading', mode, theme, page: 1, pages: 0, worker: false },
    };
    this.panels.set(panel, entry);

    let disposed = false;
    let loadGeneration = 0;
    const postMessage = (message: HostMessage) => panel.webview.postMessage(message);

    const loadDocument = async () => {
      const generation = ++loadGeneration;
      try {
        const data = await document.read();
        if (!disposed && generation === loadGeneration) {
          await postMessage({
            type: 'document',
            data,
            filename: posix.basename(document.uri.path),
          });
        }
      } catch (error) {
        if (!disposed && generation === loadGeneration) {
          await postMessage({
            type: 'error',
            message: error instanceof Error ? error.message : 'Unable to read this PDF.',
          });
        }
      }
    };

    const subscriptions = [
      panel.webview.onDidReceiveMessage((message: unknown) => {
        if (!isViewerMessage(message) || disposed) {
          return;
        }

        switch (message.type) {
          case 'ready':
          case 'reload':
            void loadDocument();
            break;
          case 'restart':
            this.restartPanel(panel);
            break;
          case 'showCommandPalette':
            void vscode.commands.executeCommand('workbench.action.showCommands');
            break;
          case 'status':
            entry.status = { ...message.status };
            break;
          case 'openLink':
            void vscode.env.openExternal(vscode.Uri.parse(message.url));
            break;
        }
      }),
      document.onDidChange(() => {
        void loadDocument();
      }),
    ];

    panel.onDidDispose(() => {
      disposed = true;
      loadGeneration++;
      subscriptions.forEach((subscription) => {
        subscription.dispose();
      });
      this.panels.delete(panel);
    });

    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(pdfAssets, 'web/viewer.html'),
    );
    if (disposed || token.isCancellationRequested) {
      return;
    }

    const assetUri = (...segments: string[]) =>
      panel.webview.asWebviewUri(vscode.Uri.joinPath(pdfAssets, ...segments)).toString();

    panel.webview.html = renderViewerHtml(new TextDecoder().decode(bytes), {
      nonce: randomBytes(24).toString('hex'),
      cspSource: panel.webview.cspSource,
      baseUri: assetUri('web') + '/',
      scriptUri: panel.webview
        .asWebviewUri(vscode.Uri.joinPath(webviewAssets, 'bridge.js'))
        .toString(),
      styleUri: panel.webview
        .asWebviewUri(vscode.Uri.joinPath(webviewAssets, 'viewer.css'))
        .toString(),
      config: {
        documentId: document.uri.toString(),
        filename: posix.basename(document.uri.path),
        defaultMode: mode,
        defaultTheme: theme,
        pdfModuleUri: assetUri('build/pdf.mjs'),
        viewerModuleUri: assetUri('web/viewer.mjs'),
        workerUri: assetUri('build/pdf.worker.mjs'),
        assetsUri: assetUri('web') + '/',
      },
    });
  }

  toggleActiveMode(): void {
    for (const [panel] of this.panels) {
      if (panel.active) {
        void panel.webview.postMessage({ type: 'toggleMode' } satisfies HostMessage);
        return;
      }
    }
  }

  async chooseActiveTheme(theme?: unknown): Promise<void> {
    // Editor-title actions may supply the editor URI as their first argument.
    if (theme instanceof vscode.Uri) {
      theme = undefined;
    }
    if (theme !== undefined && !isDarkTheme(theme)) {
      throw new Error('Unknown PDF theme.');
    }

    const active = [...this.panels].find(([panel]) => panel.active);
    if (!active) {
      return;
    }

    // Capture the target before opening the picker, so focus changes cannot
    // apply a preview or an accepted choice to a different PDF/split editor.
    const [panel, entry] = active;
    if (isDarkTheme(theme)) {
      await panel.webview.postMessage({ type: 'setTheme', theme } satisfies HostMessage);
      return;
    }

    const cancellation = new vscode.CancellationTokenSource();
    const panelClosed = panel.onDidDispose(() => cancellation.cancel());
    const items = Object.entries(darkThemes).map(([id, palette]) => ({
      id: id as DarkTheme,
      label: palette.label,
      description: palette.description + (id === entry.status.theme ? ' · Current' : ''),
      detail: palette.detail,
    }));

    // Put the current choice first so opening the picker does not change a dark page.
    items.sort((a, b) => Number(b.id === entry.status.theme) - Number(a.id === entry.status.theme));

    try {
      const choice = await vscode.window.showQuickPick(
        items,
        {
          title: 'PDF Theme',
          placeHolder: 'Preview with ↑/↓ · Enter to apply · Esc to cancel',
          onDidSelectItem: (item) => {
            const selected = items.find((candidate) => candidate === item);
            if (selected && !cancellation.token.isCancellationRequested) {
              void panel.webview.postMessage({
                type: 'previewTheme',
                theme: selected.id,
              } satisfies HostMessage);
            }
          },
        },
        cancellation.token,
      );

      if (choice && !cancellation.token.isCancellationRequested) {
        await panel.webview.postMessage({
          type: 'setTheme',
          theme: choice.id,
        } satisfies HostMessage);
      }
    } finally {
      if (!cancellation.token.isCancellationRequested) {
        await panel.webview.postMessage({ type: 'cancelThemePreview' } satisfies HostMessage);
      }

      panelClosed.dispose();
      cancellation.dispose();
    }
  }

  reloadActive(): void {
    // Reload the webview itself, including its worker, while keeping VS Code's saved reading state.
    for (const [panel] of this.panels) {
      if (panel.active) {
        this.restartPanel(panel);
        return;
      }
    }
  }

  private restartPanel(panel: vscode.WebviewPanel): void {
    const entry = this.panels.get(panel);
    if (!entry) {
      return;
    }

    entry.status = { ...entry.status, phase: 'loading', worker: false };
    panel.webview.html =
      panel.webview.html.replace(/<!--yozora-reload:[^>]*-->/g, '') +
      `<!--yozora-reload:${randomBytes(8).toString('hex')}-->`;
  }

  getViewerStatus(uri: vscode.Uri): readonly ViewerStatus[] {
    return [...this.panels.values()]
      .filter((entry) => entry.uri.toString() === uri.toString())
      .map((entry) => ({ ...entry.status }));
  }
}

async function openPdf(resource?: vscode.Uri): Promise<void> {
  let uri: vscode.Uri | undefined;

  if (resource instanceof vscode.Uri) {
    uri = resource;
  } else {
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { PDF: ['pdf'] },
      openLabel: 'Open with Yozora',
    });
    uri = selected?.[0];
  }

  if (uri) {
    await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
  }
}

export function activate(context: vscode.ExtensionContext): YozoraApi {
  const provider = new PdfProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(viewType, provider, {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: false },
    }),
    vscode.commands.registerCommand('yozora.open', openPdf),
    vscode.commands.registerCommand('yozora.toggleDarkMode', () => provider.toggleActiveMode()),
    vscode.commands.registerCommand('yozora.chooseTheme', (theme?: unknown) =>
      provider.chooseActiveTheme(theme),
    ),
    vscode.commands.registerCommand('yozora.reload', () => provider.reloadActive()),
  );

  return provider;
}
