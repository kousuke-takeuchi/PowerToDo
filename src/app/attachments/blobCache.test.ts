import { test } from "node:test";
import assert from "node:assert/strict";
import { createBlobCache } from "./blobCache.ts";

const setup = (max: number) => {
  const made: string[] = [];
  const revoked: string[] = [];
  const cache = createBlobCache(
    () => {
      const u = `blob:${made.length}`;
      made.push(u);
      return u;
    },
    (u) => revoked.push(u),
    max,
  );
  return { cache, made, revoked };
};
const read = () => Promise.resolve(new ArrayBuffer(1));

test("the_same_key_reads_once", async () => {
  const { cache, made } = setup(5);
  const a = await cache.acquire("k", read, "image/png");
  const b = await cache.acquire("k", read, "image/png");
  assert.equal(a, b);
  assert.equal(made.length, 1);
});

test("unused_urls_are_revoked_oldest_first_once_over_the_limit", async () => {
  const { cache, revoked } = setup(2);
  for (const k of ["a", "b", "c"]) {
    await cache.acquire(k, read, "image/png");
    cache.release(k);
  }
  assert.deepEqual(revoked, ["blob:0"]);
});

test("a_url_in_use_is_never_revoked", async () => {
  const { cache, revoked } = setup(1);
  await cache.acquire("a", read, "image/png");
  await cache.acquire("b", read, "image/png");
  assert.deepEqual(revoked, []);
  cache.release("a");
  assert.deepEqual(revoked, ["blob:0"]);
});

test("a_failed_read_is_not_remembered", async () => {
  const { cache, made } = setup(5);
  await assert.rejects(cache.acquire("k", () => Promise.reject(new Error("no")), "image/png"));
  await cache.acquire("k", read, "image/png");
  assert.equal(made.length, 1);
});

test("drop_revokes_and_forgets", async () => {
  const { cache, revoked, made } = setup(5);
  await cache.acquire("k", read, "image/png");
  cache.drop("k");
  assert.deepEqual(revoked, ["blob:0"]);
  await cache.acquire("k", read, "image/png");
  assert.equal(made.length, 2);
});
