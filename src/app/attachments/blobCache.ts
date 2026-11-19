/**
 * Object URLs for attachment pictures (no asset protocol): `acquire` gives a URL and counts a user, `release` gives it
 * back. Unused URLs stay in a small least-recently-used pool and are revoked when the pool is over `max`.
 * The reading and the URL making are passed in, so this is tested without a DOM.
 */
export interface BlobCache {
  acquire(key: string, read: () => Promise<ArrayBuffer>, type: string): Promise<string>;
  release(key: string): void;
  /** Forgets the key (the blob arrived late: read it again). */
  drop(key: string): void;
}

export function createBlobCache(make: (bytes: ArrayBuffer, type: string) => string, revoke: (url: string) => void, max = 40): BlobCache {
  type Entry = { url: Promise<string>; refs: number; done?: string };
  const entries = new Map<string, Entry>(); // insertion order = least recently used first
  const trim = () => {
    for (const [k, e] of entries) {
      if (entries.size <= max) break;
      if (e.refs === 0) {
        entries.delete(k);
        if (e.done) revoke(e.done);
      }
    }
  };
  return {
    acquire(key, read, type) {
      let e = entries.get(key);
      if (e) {
        entries.delete(key);
        entries.set(key, e);
      } else {
        const fresh: Entry = { refs: 0, url: Promise.resolve("") };
        fresh.url = read().then(
          (bytes) => (fresh.done = make(bytes, type)),
          (err) => {
            if (entries.get(key) === fresh) entries.delete(key);
            throw err;
          },
        );
        entries.set(key, fresh);
        e = fresh;
      }
      e.refs++;
      trim();
      return e.url;
    },
    release(key) {
      const e = entries.get(key);
      if (e && e.refs > 0) e.refs--;
      trim();
    },
    drop(key) {
      const e = entries.get(key);
      if (!e) return;
      entries.delete(key);
      if (e.done) revoke(e.done);
    },
  };
}
