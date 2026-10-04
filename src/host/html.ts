import type { ViewerConfig } from '../shared/protocol';

export interface HtmlOptions {
  baseUri: string;
  scriptUri: string;
  styleUri: string;
  cspSource: string;
  nonce: string;
  config: ViewerConfig;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

export function renderViewerHtml(template: string, options: HtmlOptions): string {
  const { nonce, cspSource, config } = options;
  const cspDirectives = [
    "default-src 'none'",
    `base-uri ${cspSource}`,
    `script-src 'nonce-${nonce}' ${cspSource} 'wasm-unsafe-eval'`,
    'worker-src blob:',
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} blob: data:`,
    `font-src ${cspSource} blob: data:`,
    `connect-src ${cspSource} blob:`,
    'media-src blob:',
    "object-src 'none'",
    "form-action 'none'",
  ];
  const csp = cspDirectives.join('; ') + ';';

  const scripts = template.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi);
  if (scripts?.length !== 2 || !template.includes('id="toolbarViewerRight"')) {
    throw new Error(
      'Unexpected PDF.js viewer template. Review the integration before upgrading PDF.js.',
    );
  }

  const configJson = JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  return template
    .replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/i, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(
      '<head>',
      `<head>\n<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">\n<base href="${escapeHtml(options.baseUri)}">`,
    )
    .replace(
      '<title>PDF.js viewer</title>',
      `<title>${escapeHtml(config.filename)} — Yozora</title>`,
    )
    .replace(
      '</head>',
      `<link rel="stylesheet" href="${escapeHtml(options.styleUri)}">\n<script id="yozora-config" type="application/json" nonce="${nonce}">${configJson}</script>\n<script type="module" nonce="${nonce}" src="${escapeHtml(options.scriptUri)}"></script>\n</head>`,
    )
    .replace(
      /(<body\b[^>]*>)/,
      '$1\n<div id="yozora-status" role="status"><span id="yozora-status-text">Opening PDF...</span><button id="yozora-retry" type="button" hidden>Retry</button></div>',
    );
}
