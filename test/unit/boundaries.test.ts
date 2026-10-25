import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderViewerHtml, type HtmlOptions } from '../../src/host/html';
import { readPdf } from '../../src/host/readPdf';
import { isSafeExternalUrl, isViewerMessage, restoreState } from '../../src/shared/protocol';
import { isDarkTheme } from '../../src/shared/appearance';

describe('document and webview boundaries', () => {
  it('rejects privileged URL schemes and malformed messages', () => {
    for (const url of [
      'command:workbench.action.terminal.new',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,test',
      'vscode://file/etc/passwd',
    ]) {
      assert.equal(isSafeExternalUrl(url), false);
      assert.equal(isViewerMessage({ type: 'openLink', url }), false);
    }
    assert.equal(isSafeExternalUrl('https://doi.org/10.1234/example'), true);
    assert.equal(isSafeExternalUrl('mailto:author@example.org'), true);
    assert.equal(
      isViewerMessage({
        type: 'status',
        status: {
          phase: 'ready',
          mode: 'dark',
          theme: 'graphite',
          page: 1,
          pages: 3,
          worker: true,
        },
      }),
      true,
    );
    assert.equal(isViewerMessage({ type: 'status', status: { phase: 'ready' } }), false);
    assert.equal(isViewerMessage(null), false);
  });

  it('validates status phases without coercing malformed values', () => {
    const status = { mode: 'dark', theme: 'midnight', page: 1, pages: 3, worker: true };

    for (const phase of ['loading', 'ready', 'error']) {
      assert.equal(isViewerMessage({ type: 'status', status: { ...status, phase } }), true);
    }

    for (const phase of [undefined, null, 1, 'unknown', ['ready'], { toString: 1 }]) {
      assert.equal(isViewerMessage({ type: 'status', status: { ...status, phase } }), false);
    }
  });

  it('restores only valid state for the same document', () => {
    const saved = {
      version: 1,
      documentId: 'file:///paper.pdf',
      mode: 'original',
      theme: 'midnight',
      page: 3,
      zoom: '1.5',
      rotation: 90,
      left: 12,
      top: 45,
      positioned: true,
      sidebarView: 2,
    };
    assert.deepEqual(restoreState(saved, saved.documentId, 'dark'), saved);
    assert.equal(restoreState(saved, 'file:///other.pdf', 'dark').page, 1);

    const repaired = restoreState(
      { ...saved, page: -1, zoom: 'javascript:alert(1)', top: Infinity, rotation: 45 },
      saved.documentId,
      'dark',
    );
    assert.equal(repaired.page, 1);
    assert.equal(repaired.zoom, 'auto');
    assert.equal(repaired.top, 0);
    assert.equal(repaired.rotation, 0);
  });

  it('migrates old reading states and rejects unknown themes', () => {
    const old = { version: 1, documentId: 'paper', mode: 'original', page: 12, zoom: '0.67' };
    const restored = restoreState(old, 'paper', 'dark', 'midnight');
    assert.equal(restored.theme, 'midnight');
    assert.equal(restored.mode, 'original');
    assert.equal(restored.page, 12);
    assert.equal(restored.zoom, '0.67');
    assert.equal(restored.sidebarView, 0);
    assert.equal(
      restoreState({ ...old, theme: 'graphite' }, 'paper', 'dark', 'midnight').theme,
      'graphite',
    );
    assert.equal(
      restoreState({ ...old, theme: 'graphite' }, 'other', 'dark', 'midnight').theme,
      'midnight',
    );
    assert.deepEqual(restoreState({ ...old, theme: 'soft' }, 'paper', 'dark', 'midnight'), {
      ...restored,
      theme: 'graphite',
    });

    for (const legacyTheme of ['graphite', 'midnight', 'soft']) {
      const migrated = restoreState({ ...old, scheme: legacyTheme }, 'paper', 'dark');
      assert.deepEqual(migrated, {
        ...restored,
        theme: legacyTheme === 'soft' ? 'graphite' : legacyTheme,
      });
      assert.equal(Object.hasOwn(migrated, 'scheme'), false);
    }
    assert.equal(
      restoreState({ ...old, theme: 'midnight', scheme: 'graphite' }, 'paper', 'dark').theme,
      'midnight',
    );
    assert.equal(restoreState({ ...old, scheme: 'graphite' }, 'other', 'dark').theme, 'midnight');

    for (const theme of [
      'soft',
      'toString',
      '__proto__',
      'url(https://example.org/filter)',
      null,
      {},
    ]) {
      assert.equal(isDarkTheme(theme), false);
      assert.equal(
        restoreState({ ...old, theme }, 'paper', 'dark').theme,
        theme === 'soft' ? 'graphite' : 'midnight',
      );
      assert.equal(
        isViewerMessage({
          type: 'status',
          status: { phase: 'ready', mode: 'dark', theme, page: 1, pages: 1, worker: true },
        }),
        false,
      );
    }
  });

  it('restores sidebar choices only for the same document and defaults invalid values to closed', () => {
    const saved = { version: 1, documentId: 'paper' };
    for (const sidebarView of [0, 1, 2, 3, 4]) {
      assert.equal(
        restoreState({ ...saved, sidebarView }, 'paper', 'dark').sidebarView,
        sidebarView,
      );
      assert.equal(restoreState({ ...saved, sidebarView }, 'other', 'dark').sidebarView, 0);
    }
    for (const sidebarView of [undefined, null, -1, 5, 1.5, '2', true, {}]) {
      assert.equal(restoreState({ ...saved, sidebarView }, 'paper', 'dark').sidebarView, 0);
    }
  });

  it('copies exactly the PDF bytes, including pooled-buffer slices', async () => {
    const pooled = new Uint8Array([9, 1, 2, 3, 9]);
    const buffer = await readPdf(
      { stat: async () => ({ size: 3 }), read: async () => pooled.subarray(1, 4) },
      10,
    );
    assert.deepEqual([...new Uint8Array(buffer)], [1, 2, 3]);

    pooled[1] = 99;
    assert.equal(new Uint8Array(buffer)[0], 1);
  });

  it('rejects oversized PDFs before reading and rechecks files that grow', async () => {
    let read = false;
    await assert.rejects(
      readPdf(
        {
          stat: async () => ({ size: 20 }),
          read: async () => {
            read = true;
            return new Uint8Array(20);
          },
        },
        10,
      ),
      /exceeds/,
    );
    assert.equal(read, false);
    await assert.rejects(
      readPdf({ stat: async () => ({ size: 1 }), read: async () => new Uint8Array(20) }, 10),
      /grew/,
    );
    await assert.rejects(
      readPdf({ stat: async () => ({ size: 0 }), read: async () => new Uint8Array() }, 10),
      /empty/,
    );
  });

  it('escapes filenames and replaces upstream scripts and CSP', () => {
    const template = readFileSync('vendor/pdfjs/web/viewer.html', 'utf8');
    const options: HtmlOptions = {
      baseUri: 'https://assets.example/web/',
      scriptUri: 'https://assets.example/bridge.js',
      styleUri: 'https://assets.example/viewer.css',
      cspSource: 'https://assets.example',
      nonce: 'testnonce',
      config: {
        documentId: 'test',
        filename: '</script><script>alert(1)</script>.pdf',
        defaultMode: 'dark',
        defaultTheme: 'graphite',
        pdfModuleUri: '',
        viewerModuleUri: '',
        workerUri: '',
        assetsUri: '',
      },
    };

    const html = renderViewerHtml(template, options);
    assert.equal((html.match(/http-equiv="Content-Security-Policy"/g) ?? []).length, 1);
    assert.equal((html.match(/<script\b/g) ?? []).length, 2);
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.equal(html.includes('connect-src *'), false);
    assert.equal(html.includes('worker-src blob:'), true);
    assert.equal(html.includes('id="yozora-mode"'), false);
    assert.throws(() => renderViewerHtml('<html></html>', options), /Unexpected PDF.js/);
  });
});
