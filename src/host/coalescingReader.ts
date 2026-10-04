/** Share one read between editor panels and discard superseded reads before delivery. */
export class CoalescingReader<T> {
  private revision = 0;
  private pending: Promise<T> | undefined;

  constructor(private readonly load: () => Promise<T>) {}

  invalidate(): void {
    this.revision++;
  }

  read(): Promise<T> {
    if (this.pending) {
      return this.pending;
    }

    const pending = this.readLatest();
    this.pending = pending;
    const clear = () => {
      if (this.pending === pending) {
        this.pending = undefined;
      }
    };

    void pending.then(clear, clear);
    return pending;
  }

  private async readLatest(): Promise<T> {
    for (;;) {
      const revision = this.revision;

      try {
        const result = await this.load();
        if (revision === this.revision) {
          return result;
        }
      } catch (error) {
        if (revision === this.revision) {
          throw error;
        }
      }
      // Changes during the read require one fresh read, never overlapping allocations.
    }
  }
}
