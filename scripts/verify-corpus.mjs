import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = new URL('../test/corpus/', import.meta.url);

export async function verifyCorpus() {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(Array.isArray(manifest.papers) && manifest.papers.length > 0);

  /** @type {Set<string>} */
  const files = new Set();
  const ids = new Set();
  let totalBytes = 0;

  for (const paper of manifest.papers) {
    assert.match(paper.id, /^[a-z0-9-]+$/);
    assert.equal(paper.file, `${paper.id}.pdf`);
    assert.ok(!ids.has(paper.id), `Duplicate ID: ${paper.id}`);
    ids.add(paper.id);
    files.add(paper.file);

    for (const field of [
      'title',
      'authors',
      'citation',
      'version',
      'licenseEvidence',
      'changes',
      'searchTerm',
    ]) {
      assert.ok(
        typeof paper[field] === 'string' && paper[field].length > 0,
        `${paper.id}: missing ${field}`,
      );
    }

    for (const field of ['source', 'download', 'licenseUrl']) {
      assert.equal(new URL(paper[field]).protocol, 'https:');
    }
    assert.ok(['CC-BY-4.0', 'CC-BY-3.0', 'CC-BY-ND-2.0'].includes(paper.license));
    assert.match(paper.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(paper.pages) && paper.pages > 0);
    assert.ok(Array.isArray(paper.samples) && paper.samples.length > 0);

    const samplePages = new Set();
    for (const sample of paper.samples) {
      assert.ok(Number.isInteger(sample.page) && sample.page >= 1 && sample.page <= paper.pages);
      assert.ok(!samplePages.has(sample.page), `${paper.id}: duplicate sample page`);
      samplePages.add(sample.page);
      assert.ok(typeof sample.text === 'string' && sample.text.length > 0);
      assert.ok(Array.isArray(sample.features) && sample.features.length > 0);
      if (sample.neutralRegion) {
        const [x, y, width, height] = sample.neutralRegion;
        assert.equal(sample.neutralRegion.length, 4);
        assert.ok(sample.neutralRegion.every(Number.isFinite));
        assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1);
      }
    }

    const bytes = await readFile(new URL(paper.file, directory));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', `${paper.id}: not a PDF`);
    assert.equal(bytes.length, paper.bytes, `${paper.id}: file size changed`);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      paper.sha256,
      `${paper.id}: checksum mismatch`,
    );
    totalBytes += bytes.length;
  }

  const actual = (await readdir(directory)).filter((name) => name.endsWith('.pdf')).sort();
  assert.deepEqual(
    actual,
    [...files].sort(),
    'Every bundled PDF must have a manifest and attribution entry',
  );

  console.log(
    `Verified ${files.size} unchanged paper PDFs (${(totalBytes / 1024 / 1024).toFixed(1)} MiB).`,
  );

  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await verifyCorpus();
}
