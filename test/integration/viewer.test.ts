import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';

import type { YozoraApi } from '../../src/extension';
import type { ViewerStatus } from '../../src/shared/protocol';

const { papers } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../test/corpus/manifest.json'), 'utf8'),
) as {
  papers: { id: string; file: string; pages: number }[];
};

async function waitForViewerStatus(
  read: () => readonly ViewerStatus[],
  predicate: (statuses: readonly ViewerStatus[]) => boolean,
): Promise<readonly ViewerStatus[]> {
  const deadline = Date.now() + 45_000;
  let statuses: readonly ViewerStatus[] = [];
  while (Date.now() < deadline) {
    statuses = read();
    const error = statuses.find((status) => status.phase === 'error');
    if (predicate(statuses)) {
      return statuses;
    }
    if (error) {
      throw new Error(`Webview error: ${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`Timed out waiting for PDF webview: ${JSON.stringify(statuses)}`);
}

suite('PDF editor in the real VS Code webview', () => {
  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  for (const paper of papers) {
    test(`opens ${paper.id} through the real extension host`, async function () {
      this.timeout(90_000);
      const api = await vscode.extensions.getExtension<YozoraApi>('local.yozora')!.activate();
      const uri = vscode.Uri.file(path.resolve(__dirname, '../../../test/corpus', paper.file));
      await vscode.commands.executeCommand('vscode.openWith', uri, 'yozora.pdf');
      const ready = await waitForViewerStatus(
        () => api.getViewerStatus(uri),
        (statuses) => statuses.some((status) => status.phase === 'ready'),
      );
      assert.equal(ready[0]?.pages, paper.pages);
      assert.equal(ready[0]?.worker, true);
      const expectedMode = ready[0]?.mode === 'dark' ? 'original' : 'dark';

      await vscode.commands.executeCommand('yozora.toggleDarkMode');
      await waitForViewerStatus(
        () => api.getViewerStatus(uri),
        (statuses) => statuses[0]?.mode === expectedMode,
      );

      for (const theme of ['midnight', 'dracula']) {
        await vscode.commands.executeCommand('yozora.chooseTheme', theme);
        await waitForViewerStatus(
          () => api.getViewerStatus(uri),
          (statuses) => statuses[0]?.theme === theme && statuses[0]?.mode === 'dark',
        );
      }

      await vscode.commands.executeCommand('yozora.toggleDarkMode');
      await waitForViewerStatus(
        () => api.getViewerStatus(uri),
        (statuses) => statuses[0]?.mode === 'original',
      );

      await vscode.commands.executeCommand('yozora.toggleDarkMode');
      await waitForViewerStatus(
        () => api.getViewerStatus(uri),
        (statuses) => statuses[0]?.mode === 'dark' && statuses[0]?.theme === 'dracula',
      );

      await vscode.commands.executeCommand('yozora.reload');
      await waitForViewerStatus(
        () => api.getViewerStatus(uri),
        (statuses) => statuses[0]?.phase === 'ready' && statuses[0]?.theme === 'dracula',
      );
    });
  }

  test('accepts and cancels the native theme picker without changing another split editor', async function () {
    this.timeout(90_000);
    const api = await vscode.extensions.getExtension<YozoraApi>('local.yozora')!.activate();
    const uri = vscode.Uri.file(path.resolve(__dirname, '../../../test/corpus/m87.pdf'));
    await vscode.commands.executeCommand('vscode.openWith', uri, 'yozora.pdf');
    await waitForViewerStatus(
      () => api.getViewerStatus(uri),
      (statuses) => statuses[0]?.phase === 'ready',
    );

    await vscode.commands.executeCommand('yozora.chooseTheme', 'graphite');
    await waitForViewerStatus(
      () => api.getViewerStatus(uri),
      (statuses) => statuses[0]?.theme === 'graphite' && statuses[0]?.mode === 'dark',
    );

    await vscode.commands.executeCommand('workbench.action.splitEditorRight');
    await waitForViewerStatus(
      () => api.getViewerStatus(uri),
      (statuses) => statuses.length === 2 && statuses.every((status) => status.phase === 'ready'),
    );

    // A new split can restore its own appearance instead of inheriting the first editor's.
    await vscode.commands.executeCommand('yozora.chooseTheme', 'graphite');
    await waitForViewerStatus(
      () => api.getViewerStatus(uri),
      (statuses) =>
        statuses.length === 2 && statuses.every((status) => status.theme === 'graphite'),
    );

    // A title-bar action supplies a URI. Exercise that entry point and VS Code's
    // real quick-pick keyboard commands, rather than mocking the picker.
    const accepted = vscode.commands.executeCommand('yozora.chooseTheme', uri);

    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
      await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
      await accepted;
      await waitForViewerStatus(
        () => api.getViewerStatus(uri),
        (statuses) =>
          statuses.length === 2 &&
          statuses.filter((status) => status.theme === 'midnight').length === 1 &&
          statuses.filter((status) => status.theme === 'graphite').length === 1,
      );

      await vscode.commands.executeCommand('yozora.toggleDarkMode');
      await waitForViewerStatus(
        () => api.getViewerStatus(uri),
        (statuses) =>
          statuses.some((status) => status.theme === 'midnight' && status.mode === 'original'),
      );
      const canceled = vscode.commands.executeCommand('yozora.chooseTheme');
      await new Promise((resolve) => setTimeout(resolve, 300));
      await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
      await canceled;

      await vscode.commands.executeCommand('yozora.reload');
      await waitForViewerStatus(
        () => api.getViewerStatus(uri),
        (statuses) =>
          statuses.length === 2 &&
          statuses.every((status) => status.phase === 'ready') &&
          statuses.some((status) => status.mode === 'original' && status.theme === 'midnight') &&
          statuses.some((status) => status.mode === 'dark' && status.theme === 'graphite'),
      );
      await assert.rejects(
        Promise.resolve(vscode.commands.executeCommand('yozora.chooseTheme', '__proto__')),
        /Unknown PDF theme/,
      );
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    }
  });
});
