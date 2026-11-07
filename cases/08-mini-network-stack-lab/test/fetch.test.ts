// 文件: cases/08-mini-network-stack-lab/test/fetch.test.ts
// ============ fetch 逐项回归 ============

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Buffer } from "node:buffer";
import { fetch, AbortError, TimeoutError } from "../src/fetch.js";

/** 启动一个会在所有测试结束后自动关闭的 server */
function createServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; url: string; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("listen 失败");
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
      });
    });
  });
}

test("简单 GET：200 + body + headers", async () => {
  const { server, url } = await createServer((req, res) => {
    assert.equal(req.method, "GET");
    res.writeHead(200, { "X-Custom": "yes", "Content-Length": "5" });
    res.end("hello");
  });

  const resp = await fetch(`${url}/`);
  assert.equal(resp.status, 200);
  assert.equal(resp.text(), "hello");
  assert.equal(resp.headers.get("x-custom"), "yes");
  server.close();
});

test("POST：body + Content-Length", async () => {
  const { server, url } = await createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      assert.equal(req.method, "POST");
      assert.ok(req.headers["content-length"]);
      assert.equal(body, '{"a":1}');
      res.writeHead(201);
      res.end("created");
    });
  });

  const resp = await fetch(`${url}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"a":1}',
  });
  assert.equal(resp.status, 201);
  server.close();
});

test("重定向：302 → 新 URL 跟随 + redirected = true", async () => {
  const { server, url } = await createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/final" });
      res.end();
    } else if (req.url === "/final") {
      res.writeHead(200, { "Content-Length": "6" });
      res.end("landed");
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const resp = await fetch(`${url}/redirect`);
  assert.equal(resp.status, 200);
  assert.equal(resp.text(), "landed");
  assert.equal(resp.redirected, true);
  assert.match(resp.url, /\/final$/);
  server.close();
});

test("重定向：303 POST → 转 GET + body 丢弃", async () => {
  let seenMethod = "";
  const { server, url } = await createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(303, { Location: "/after" });
      res.end();
    } else {
      seenMethod = req.method!;
      res.writeHead(200);
      res.end("ok");
    }
  });

  await fetch(`${url}/redirect`, {
    method: "POST",
    body: "payload",
  });
  assert.equal(seenMethod, "GET");
  server.close();
});

test("重定向链：超过 maxRedirects 抛错", async () => {
  const { server, url } = await createServer((req, res) => {
    res.writeHead(302, { Location: `/next${Math.random()}` });
    res.end();
  });

  await assert.rejects(
    fetch(`${url}/loop`, { maxRedirects: 2 }),
    /超过最大重定向次数/,
  );
  server.close();
});

test("AbortController：请求发出前 abort → 立即抛 AbortError", async () => {
  const { server, url } = await createServer(() => {
    /* never reached */
  });

  const controller = new AbortController();
  controller.abort(new Error("canceled by user"));

  await assert.rejects(
    fetch(`${url}/slow`, { signal: controller.signal }),
    (err) =>
      err instanceof AbortError ||
      (err as Error).message === "canceled by user",
  );
  server.close();
});

test("AbortController：请求中 abort → socket 被销毁", async () => {
  const { server, url } = await createServer((_req, res) => {
    // 永远不结束
    res.writeHead(200, { "Transfer-Encoding": "chunked" });
    res.write("x");
  });

  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("用户取消")), 30);

  await assert.rejects(
    fetch(`${url}/slow`, { signal: controller.signal }),
    (err) => err instanceof AbortError,
  );
  server.close();
});

test("超时：timeout 到达后 socket 被销毁 + TimeoutError", async () => {
  const { server, url } = await createServer((_req, res) => {
    res.writeHead(200, { "Transfer-Encoding": "chunked" });
    res.write("start");
    // 不结束
  });

  await assert.rejects(
    fetch(`${url}/slow`, { timeout: 30 }),
    (err) => err instanceof TimeoutError,
  );
  server.close();
});

test("HTTP 非 2xx：status 正确 + ok 为 false", async () => {
  const { server, url } = await createServer((_req, res) => {
    res.writeHead(404, { "Content-Length": "9" });
    res.end("not found");
  });

  const resp = await fetch(`${url}/missing`);
  assert.equal(resp.status, 404);
  assert.equal(resp.ok, false);
  assert.equal(resp.text(), "not found");
  server.close();
});

test("自定义 headers 透传到服务端", async () => {
  const { server, url } = await createServer((req, res) => {
    assert.equal(req.headers["x-api-key"], "secret-123");
    assert.ok(req.headers["user-agent"]?.includes("test"));
    res.writeHead(200);
    res.end("ok");
  });

  await fetch(`${url}/auth`, {
    headers: {
      "X-API-Key": "secret-123",
      "User-Agent": "test-agent/1.0",
    },
  });
  server.close();
});
