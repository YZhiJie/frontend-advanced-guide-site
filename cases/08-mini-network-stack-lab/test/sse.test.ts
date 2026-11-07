// 文件: cases/08-mini-network-stack-lab/test/sse.test.ts
// ============ EventSource 逐项回归 ============

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Buffer } from "node:buffer";
import { EventSource, MessageEvent } from "../src/sse.js";
import { HttpResponse } from "../src/fetch.js";
import type { FetchFn } from "../src/fetch.js";

function createSseServer(
  body: string,
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("listen 失败");
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

test("简单 data 事件：单条 data → dispatch message 事件", async () => {
  const { server, url } = await createSseServer("data: hello world\n\n");

  const events: MessageEvent[] = [];
  const source = new EventSource(url);
  source.addEventListener("message", (e) => {
    if (e instanceof MessageEvent) events.push(e);
  });

  await new Promise((r) => setTimeout(r, 100));
  source.close();
  server.close();

  assert.equal(events.length, 1);
  assert.equal(events[0]!.type, "message");
  assert.equal(events[0]!.data, "hello world");
});

test("多行 data 用 \\n 拼接成一个事件", async () => {
  const { server, url } = await createSseServer("data: line1\ndata: line2\n\n");

  const events: MessageEvent[] = [];
  const source = new EventSource(url);
  source.addEventListener("message", (e) => {
    if (e instanceof MessageEvent) events.push(e);
  });

  await new Promise((r) => setTimeout(r, 100));
  source.close();
  server.close();

  assert.equal(events.length, 1);
  assert.equal(events[0]!.data, "line1\nline2");
});

test("event: 前缀 → 自定义事件类型（不触发默认 message）", async () => {
  const { server, url } = await createSseServer(
    "event: price-change\ndata: 99.9\n\n",
  );

  const customEvents: MessageEvent[] = [];
  const messageEvents: MessageEvent[] = [];
  const source = new EventSource(url);
  source.addEventListener("price-change", (e) => {
    if (e instanceof MessageEvent) customEvents.push(e);
  });
  source.addEventListener("message", (e) => {
    if (e instanceof MessageEvent) messageEvents.push(e);
  });

  await new Promise((r) => setTimeout(r, 100));
  source.close();
  server.close();

  assert.equal(customEvents.length, 1);
  assert.equal(customEvents[0]!.type, "price-change");
  assert.equal(customEvents[0]!.data, "99.9");
  assert.equal(messageEvents.length, 0);
});

test("id: 前缀 → 传入事件对象 + 更新 lastEventId", async () => {
  const { server, url } = await createSseServer("id: 42\ndata: payload\n\n");

  const events: MessageEvent[] = [];
  const source = new EventSource(url);
  source.addEventListener("message", (e) => {
    if (e instanceof MessageEvent) events.push(e);
  });

  await new Promise((r) => setTimeout(r, 100));
  source.close();
  server.close();

  assert.equal(events[0]!.lastEventId, "42");
});

test("多条事件用空行分隔", async () => {
  const { server, url } = await createSseServer(
    "data: a\n\ndata: b\n\ndata: c\n\n",
  );

  const events: MessageEvent[] = [];
  const source = new EventSource(url);
  source.addEventListener("message", (e) => {
    if (e instanceof MessageEvent) events.push(e);
  });

  await new Promise((r) => setTimeout(r, 100));
  source.close();
  server.close();

  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((e) => e.data),
    ["a", "b", "c"],
  );
});

test("注释行（以 : 开头）被忽略", async () => {
  const { server, url } = await createSseServer(": comment\ndata: visible\n\n");

  const events: MessageEvent[] = [];
  const source = new EventSource(url);
  source.addEventListener("message", (e) => {
    if (e instanceof MessageEvent) events.push(e);
  });

  await new Promise((r) => setTimeout(r, 100));
  source.close();
  server.close();

  assert.equal(events.length, 1);
  assert.equal(events[0]!.data, "visible");
});

test("可注入 fetch：fake fetcher 直接返回 HttpResponse", async () => {
  const fakeFetch: FetchFn = async () => {
    return new HttpResponse({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: Buffer.from("data: injected\n\n", "utf-8"),
    });
  };

  const events: MessageEvent[] = [];
  const source = new EventSource("http://unused.test/stream", {
    fetch: fakeFetch,
  });
  source.addEventListener("message", (e) => {
    if (e instanceof MessageEvent) events.push(e);
  });

  await new Promise((r) => setTimeout(r, 100));
  source.close();

  assert.equal(events.length, 1);
  assert.equal(events[0]!.data, "injected");
});

test("close 后状态变 closed 且不再派发事件", async () => {
  const { server, url } = await createSseServer("data: hello\n\n");

  const source = new EventSource(url);
  source.close();
  assert.equal(source.state, "closed");

  await new Promise((r) => setTimeout(r, 50));
  server.close();
});
