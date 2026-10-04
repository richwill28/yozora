import assert from 'node:assert/strict';
import { CoalescingReader } from '../../src/host/coalescingReader';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}

describe('coalescing PDF reads', () => {
  it('shares a single in-flight read across panels', async () => {
    const file = deferred<string>();
    let reads = 0;
    const reader = new CoalescingReader(() => {
      reads++;
      return file.promise;
    });

    const first = reader.read();
    const second = reader.read();
    assert.equal(first, second);
    assert.equal(reads, 1);

    file.resolve('pdf');
    assert.deepEqual(await Promise.all([first, second]), ['pdf', 'pdf']);
  });

  it('coalesces changes into one sequential fresh read and drops stale bytes', async () => {
    const firstRead = deferred<string>();
    const secondRead = deferred<string>();
    let reads = 0;
    const reader = new CoalescingReader(() =>
      ++reads === 1 ? firstRead.promise : secondRead.promise,
    );

    const result = reader.read();
    reader.invalidate();
    reader.invalidate();
    reader.invalidate();
    assert.equal(reader.read(), result);
    assert.equal(reads, 1);

    firstRead.resolve('obsolete bytes');
    await Promise.resolve();
    assert.equal(reads, 2);

    secondRead.resolve('current bytes');
    assert.equal(await result, 'current bytes');
  });

  it('ignores superseded errors and allows retry after a current read fails', async () => {
    const firstRead = deferred<string>();
    let reads = 0;
    const reader = new CoalescingReader(() =>
      ++reads === 1 ? firstRead.promise : Promise.resolve('rebuilt'),
    );
    const pending = reader.read();
    reader.invalidate();
    firstRead.reject(new Error('incomplete write'));
    assert.equal(await pending, 'rebuilt');

    let fail = true;
    const retryable = new CoalescingReader(async () => {
      if (fail) {
        throw new Error('missing');
      }
      return 'restored';
    });
    await assert.rejects(retryable.read(), /missing/);
    fail = false;
    assert.equal(await retryable.read(), 'restored');
  });
});
