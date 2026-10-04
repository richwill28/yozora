import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { unzipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function ensurePdfJs(archivePath) {
  const lock = JSON.parse(await readFile(path.join(root, 'pdfjs.lock.json'), 'utf8'));
  const destination = path.join(root, 'vendor/pdfjs');

  try {
    const installed = JSON.parse(await readFile(path.join(destination, 'release.json'), 'utf8'));
    if (installed.sha256 === lock.sha256) {
      await Promise.all(
        [
          'web/viewer.html',
          'web/viewer.mjs',
          'build/pdf.mjs',
          'build/pdf.worker.mjs',
          'web/viewer.mjs.map',
          'build/pdf.mjs.map',
          'build/pdf.worker.mjs.map',
          'build/pdf.sandbox.mjs.map',
        ].map((name) => access(path.join(destination, name))),
      );
      return;
    }
  } catch {
    /* First build, or an interrupted installation. */
  }

  console.log(`Preparing PDF.js ${lock.version}...`);
  const bytes = archivePath ? await readFile(archivePath) : await download(lock.url);
  if (createHash('sha256').update(bytes).digest('hex') !== lock.sha256) {
    throw new Error('PDF.js archive checksum mismatch; no files were installed.');
  }

  const files = unzipSync(bytes);
  await rm(destination, { recursive: true, force: true });
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/') || name.endsWith('.pdf')) {
      continue;
    }
    if (name !== 'LICENSE' && !name.startsWith('build/') && !name.startsWith('web/')) {
      continue;
    }

    const target = path.resolve(destination, name);
    if (!target.startsWith(destination + path.sep)) {
      throw new Error('Unsafe PDF.js archive path.');
    }

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  await writeFile(path.join(destination, 'release.json'), JSON.stringify(lock, null, 2) + '\n');
  console.log('PDF.js archive verified and installed.');
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`PDF.js download failed: HTTP ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--archive');
  await ensurePdfJs(index < 0 ? undefined : process.argv[index + 1]);
}
