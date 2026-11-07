// 文件: cases/08-mini-network-stack-lab/test/cache.test.ts
// ============ HTTP 缓存逐项回归 ============

import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { MemoryCache, parseCacheControl, cacheFetch } from "../src/cache.js";
import { HttpResponse } from "../src/fetch.js";
import type { FetchFn, FetchInit } from "../src/fetch.js";

// ---- parseCacheControl ----

test("parseCacheControl：max-age 提取正确", () => {
  assert.equal(parseCacheControl("max-age=60").maxAge, 60);
  assert.equal(parseCacheControl("public, max-age=300").maxAge, 300);
  assert.equal(parseCacheControl(null).maxAge, 0);
  assert.equal(parseCacheControl(undefined).maxAge, 0);
  assert.equal(parseCacheControl("").maxAge, 0);
});

test("parseCacheControl：no-store 被识别", () => {
  assert.equal(parseCacheControl("no-store").noStore, true);
  assert.equal(parseCacheControl("no-cache, no-store").noStore, true);
  assert.equal(parseCacheControl("no-cache").noStore, false);
});

test("parseCacheControl：no-cache 被识别", () => {
  assert.equal(parseCacheControl("no-cache").noCache, true);
  assert.equal(parseCacheControl("public").noCache, false);
});

test("parseCacheControl：must-revalidate 被识别", () => {
  assert.equal(
    parseCacheControl("max-age=10, must-revalidate").mustRevalidate,
    true,
  );
});

// ---- MemoryCache ----

test("MemoryCache：get/set/delete/size", () => {
  const cache = new MemoryCache();
  const resp1 = new HttpResponse({ status: 200, body: Buffer.from("a") });
  const resp2 = new HttpResponse({ status: 200, body: Buffer.from("b") });

  cache.set("k1", {
    response: resp1,
    url: "",
    expiresAt: 0,
    maxAge: 0,
    etag: null,
    lastModified: null,
    storedAt: 0,
  });
  cache.set("k2", {
    response: resp2,
    url: "",
    expiresAt: 0,
    maxAge: 0,
    etag: null,
    lastModified: null,
    storedAt: 0,
  });
  assert.equal(cache.size, 2);
  assert.ok(cache.get("k1"));
  cache.delete("k1");
  assert.equal(cache.size, 1);
  assert.ok(!cache.get("k1"));
  cache.clear();
  assert.equal(cache.size, 0);
});

test("MemoryCache：超过 maxEntries 时 LRU 淘汰最老的", () => {
  const cache = new MemoryCache({ maxEntries: 3 });
  const mkEntry = (v: string) => ({
    response: new HttpResponse({ status: 200, body: Buffer.from(v) }),
    url: "",
    expiresAt: 0,
    maxAge: 0,
    etag: null,
    lastModified: null,
    storedAt: 0,
  });
  cache.set("a", mkEntry("a"));
  cache.set("b", mkEntry("b"));
  cache.set("c", mkEntry("c"));
  cache.get("a");
  cache.set("d", mkEntry("d"));
  assert.equal(cache.size, 3);
  assert.ok(cache.get("a"), "a 应该还在");
  assert.ok(!cache.get("b"), "b 应该被淘汰");
  assert.ok(cache.get("c"), "c 应该还在");
  assert.ok(cache.get("d"), "d 是新加入的");
});

// ---- cacheFetch ----

test("cacheFetch：max-age 内命中缓存，不重新调用 fetch", async () => {
  let calls = 0;
  const fakeFetch: FetchFn = async () => {
    calls++;
    return new HttpResponse({
      status: 200,
      headers: { "cache-control": "max-age=100" },
      body: Buffer.from("value"),
    });
  };
  const cache = new MemoryCache();
  let clock = 0;

  const url = "http://test/foo";
  const r1 = await cacheFetch(
    url,
    {},
    { cache, fetch: fakeFetch, now: () => clock },
  );
  assert.equal(r1.text(), "value");
  assert.equal(calls, 1);

  clock = 50_000; // max-age=100 秒，过期时间 100_000ms；50_000ms 还在有效期
  const r2 = await cacheFetch(
    url,
    {},
    { cache, fetch: fakeFetch, now: () => clock },
  );
  assert.equal(r2.text(), "value");
  assert.equal(calls, 1);
});

test("cacheFetch：max-age 过期后重新 fetch", async () => {
  let calls = 0;
  const fakeFetch: FetchFn = async () => {
    calls++;
    return new HttpResponse({
      status: 200,
      headers: { "cache-control": "max-age=10" },
      body: Buffer.from("v" + calls),
    });
  };
  const cache = new MemoryCache();
  let clock = 0;

  // expiresAt = 0 + 10*1000 = 10000
  const r1 = await cacheFetch(
    "http://test/",
    {},
    { cache, fetch: fakeFetch, now: () => clock },
  );
  assert.equal(r1.text(), "v1");

  clock = 9999;
  const r2 = await cacheFetch(
    "http://test/",
    {},
    { cache, fetch: fakeFetch, now: () => clock },
  );
  assert.equal(r2.text(), "v1"); // 还没过期

  clock = 10001;
  const r3 = await cacheFetch(
    "http://test/",
    {},
    { cache, fetch: fakeFetch, now: () => clock },
  );
  assert.equal(r3.text(), "v2"); // 过期了，重新 fetch
  assert.equal(calls, 2);
});

test("cacheFetch：force 选项强制跳过缓存", async () => {
  let calls = 0;
  const fakeFetch: FetchFn = async () => {
    calls++;
    return new HttpResponse({
      status: 200,
      headers: { "cache-control": "max-age=100" },
      body: Buffer.from("v" + calls),
    });
  };
  const cache = new MemoryCache();

  await cacheFetch("http://test/", {}, { cache, fetch: fakeFetch });
  assert.equal(calls, 1);
  await cacheFetch("http://test/", {}, { cache, fetch: fakeFetch });
  assert.equal(calls, 1);
  await cacheFetch(
    "http://test/",
    {},
    { cache, fetch: fakeFetch, force: true },
  );
  assert.equal(calls, 2);
});

test("cacheFetch：304 Not Modified → 刷新过期时间", async () => {
  let calls = 0;
  const fakeFetch: FetchFn = async () => {
    calls++;
    if (calls === 1) {
      return new HttpResponse({
        status: 200,
        headers: {
          "cache-control": "max-age=10",
          etag: '"abc"',
        },
        body: Buffer.from("original"),
      });
    }
    return new HttpResponse({
      status: 304,
      headers: { "cache-control": "max-age=10" },
    });
  };
  const cache = new MemoryCache();
  let clock = 0;

  // 存一个 max-age=10s 的条目，expiresAt = 10000
  const r1 = await cacheFetch(
    "http://test/",
    {},
    { cache, fetch: fakeFetch, now: () => clock },
  );
  assert.equal(r1.text(), "original");

  // 过了 10001ms，过期，发条件请求，返回 304
  clock = 10_001;
  const r2 = await cacheFetch(
    "http://test/",
    {},
    { cache, fetch: fakeFetch, now: () => clock },
  );
  assert.equal(r2.text(), "original"); // 304，用原 body
  assert.equal(calls, 2);

  // 304 刷新了 expiresAt = 10001 + 10000 = 20001，这时候 clock=15000 应该还命中
  clock = 15_000;
  const r3 = await cacheFetch(
    "http://test/",
    {},
    { cache, fetch: fakeFetch, now: () => clock },
  );
  assert.equal(r3.text(), "original");
  assert.equal(calls, 2); // 不应该再发请求
});

test("cacheFetch：条件请求头 If-None-Match / If-Modified-Since 被正确附加", async () => {
  const condRequests: { url: string; headers: Record<string, string> }[] = [];
  let callIdx = 0;
  const fakeFetch: FetchFn = async (url: string | URL, init?: FetchInit) => {
    callIdx++;
    if (callIdx === 1) {
      return new HttpResponse({
        status: 200,
        headers: {
          "cache-control": "max-age=0",
          etag: '"e1"',
          "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
        },
        body: Buffer.from("v1"),
      });
    }
    // 第二次就是条件请求了，记下 headers
    condRequests.push({
      url: url instanceof URL ? url.toString() : url,
      headers: { ...(init?.headers as Record<string, string> | undefined) },
    });
    return new HttpResponse({ status: 304 });
  };
  const cache = new MemoryCache();
  let clock = 0;

  // max-age=0，所以存入即过期
  await cacheFetch(
    "http://test/",
    {},
    { cache, fetch: fakeFetch, now: () => clock },
  );

  // 第二次应该触发条件请求
  clock = 1;
  await cacheFetch(
    "http://test/",
    {},
    { cache, fetch: fakeFetch, now: () => clock },
  );

  assert.equal(condRequests.length, 1);
  const headers = condRequests[0]!.headers;
  assert.equal(headers["if-none-match"], '"e1"');
  assert.equal(headers["if-modified-since"], "Wed, 01 Jan 2025 00:00:00 GMT");
});

test("cacheFetch：no-store 响应不写入缓存", async () => {
  let calls = 0;
  const fakeFetch: FetchFn = async () => {
    calls++;
    return new HttpResponse({
      status: 200,
      headers: { "cache-control": "no-store" },
      body: Buffer.from("secret" + calls),
    });
  };
  const cache = new MemoryCache();

  const r1 = await cacheFetch("http://test/", {}, { cache, fetch: fakeFetch });
  assert.equal(r1.text(), "secret1");
  const r2 = await cacheFetch("http://test/", {}, { cache, fetch: fakeFetch });
  assert.equal(r2.text(), "secret2");
  assert.equal(calls, 2);
});
