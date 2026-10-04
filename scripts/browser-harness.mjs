import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['src/host/html.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { renderViewerHtml } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const template = await readFile('vendor/pdfjs/web/viewer.html', 'utf8');
const corpus = JSON.parse(await readFile('test/corpus/manifest.json', 'utf8'));
const papers = new Map();

for (const paper of corpus.papers) {
  if (!/^[a-z0-9-]+\.pdf$/.test(paper.file) || papers.has(paper.file)) {
    throw new Error('Invalid corpus filename');
  }
  papers.set(paper.file, 'test/corpus/' + paper.file);
}

const defaultPaper = corpus.papers[0]?.file;
if (!defaultPaper) {
  throw new Error('Empty paper corpus');
}

const contentTypes = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ftl': 'text/plain',
  '.html': 'text/html',
};

const harnessScript = `
window.__messages = [];
window.__violations = [];

document.addEventListener('securitypolicyviolation', event => {
  window.__violations.push(event.violatedDirective + ': ' + event.blockedURI);
});

const paper = new URL(location.href).searchParams.get('paper') || ${JSON.stringify(defaultPaper)};
const stateKey = 'yozora-test:' + paper;

window.acquireVsCodeApi = () => ({
  getState: () => JSON.parse(sessionStorage.getItem(stateKey) || 'null'),
  setState: state => sessionStorage.setItem(stateKey, JSON.stringify(state)),
  postMessage: async message => {
    window.__messages.push(message);

    if (message.type === 'restart') {
      location.reload();
      return;
    }

    if (message.type === 'ready' || message.type === 'reload') {
      const response = await fetch('/paper/' + encodeURIComponent(paper));
      if (!response.ok) {
        throw new Error('Cannot load paper: ' + response.status);
      }

      const data = await response.arrayBuffer();
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'document', data, filename: paper },
      }));
    }
  }
});
`;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:4173');
    if (url.pathname === '/') {
      const paper = url.searchParams.get('paper') || defaultPaper;
      if (!papers.has(paper)) {
        throw new Error('Unknown paper');
      }

      const html = renderViewerHtml(template, {
        baseUri: '/vendor/pdfjs/web/',
        scriptUri: '/dist/webview/bridge.js',
        styleUri: '/dist/webview/viewer.css',
        cspSource: "'self'",
        nonce: 'harness',
        config: {
          documentId: paper,
          filename: paper,
          defaultMode: 'dark',
          defaultTheme: 'midnight',
          pdfModuleUri: '/vendor/pdfjs/build/pdf.mjs',
          viewerModuleUri: '/vendor/pdfjs/web/viewer.mjs',
          workerUri: '/vendor/pdfjs/build/pdf.worker.mjs',
          assetsUri: '/vendor/pdfjs/web/',
        },
      }).replace(
        '<script id="yozora-config"',
        '<script nonce="harness" src="/harness.js"></script><script id="yozora-config"',
      );
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(html);
      return;
    }

    if (url.pathname === '/harness.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(harnessScript);
      return;
    }

    const isPaper = url.pathname.startsWith('/paper/');
    const relative = isPaper
      ? papers.get(decodeURIComponent(url.pathname.slice('/paper/'.length)))
      : url.pathname.slice(1);
    if (!relative) {
      throw new Error('Unknown resource');
    }

    const allowedAssetRoots = ['vendor/pdfjs/', 'dist/webview/'];
    if (!isPaper && !allowedAssetRoots.some((prefix) => relative.startsWith(prefix))) {
      throw new Error('Unknown resource');
    }

    const file = path.resolve(relative);
    if (!file.startsWith(process.cwd() + path.sep)) {
      throw new Error('Invalid path');
    }

    const bytes = await readFile(file);
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(file)] ?? 'application/octet-stream',
    });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

server.listen(4173, '127.0.0.1', () =>
  console.log('PDF.js browser harness: http://127.0.0.1:4173'),
);
