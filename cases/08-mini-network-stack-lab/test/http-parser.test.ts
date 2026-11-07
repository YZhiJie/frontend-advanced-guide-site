// 文件: cases/08-mini-network-stack-lab/test/http-parser.test.ts
// ============ HTTP 解析器逐项回归 ============

import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { parse, parseAll, serialize } from "../src/http-parser.js";
import type { HttpMessage } from "../src/http-parser.js";

/** 把文本形式的 HTTP 报文（LF 换行）转成 Buffer（CRLF 换行） */
function buf(s: string): Buffer {
  return Buffer.from(s.replace(/\r?\n/g, "\r\n"), "ascii");
}

test("简单请求：method / path / version / headers / body", () => {
  const b = buf(
    "GET /api/users HTTP/1.1\n" +
      "Host: example.com\n" +
      "Accept: */*\n" +
      "Content-Length: 10\n" +
      "\n" +
      "hello body",
  );
  const msg = parse(b);

  assert.equal(msg.kind, "request");
  if (msg.kind !== "request") return;
  assert.equal(msg.method, "GET");
  assert.equal(msg.path, "/api/users");
  assert.equal(msg.version, "HTTP/1.1");
  assert.equal(msg.headers["host"], "example.com");
  assert.equal(msg.headers["accept"], "*/*");
  assert.equal(msg.body.toString(), "hello body");
  assert.equal(msg.nextOffset, b.length);
});

test("简单响应：statusCode / reason / version", () => {
  const b = buf("HTTP/1.1 200 OK\n" + "Content-Length: 5\n" + "\n" + "hello");
  const msg = parse(b);

  assert.equal(msg.kind, "response");
  if (msg.kind !== "response") return;
  assert.equal(msg.statusCode, 200);
  assert.equal(msg.reasonPhrase, "OK");
  assert.equal(msg.version, "HTTP/1.1");
  assert.equal(msg.body.toString(), "hello");
});

test("无 Content-Length 也没 chunked 时 body 为空", () => {
  const b = buf("GET /ping HTTP/1.1\nHost: x.com\n\n");
  const msg = parse(b);
  assert.equal(msg.body.length, 0);
  assert.equal(msg.nextOffset, b.length);
});

test("chunked body：单 chunk 完整", () => {
  const b = buf(
    "HTTP/1.1 200 OK\n" +
      "Transfer-Encoding: chunked\n" +
      "\n" +
      "5\nhello\n" +
      "0\n\n",
  );
  const msg = parse(b);
  assert.equal(msg.body.toString(), "hello");
  assert.equal(msg.nextOffset, b.length);
});

test("chunked body：多 chunk 拼接", () => {
  const b = buf(
    "HTTP/1.1 200 OK\n" +
      "Transfer-Encoding: chunked\n" +
      "\n" +
      "5\nhello\n" +
      "6\n world\n" +
      "0\n\n",
  );
  const msg = parse(b);
  assert.equal(msg.body.toString(), "hello world");
  assert.equal(msg.nextOffset, b.length);
});

test("chunked body：带 trailer", () => {
  const b = buf(
    "HTTP/1.1 200 OK\n" +
      "Transfer-Encoding: chunked\n" +
      "\n" +
      "5\nhello\n" +
      "0\nX-Trailer: done\n\n",
  );
  const msg = parse(b);
  assert.equal(msg.body.toString(), "hello");
  assert.equal(msg.nextOffset, b.length);
});

test("chunked body：chunk size 带扩展参数 size;foo=bar", () => {
  const b = buf(
    "HTTP/1.1 200 OK\n" +
      "Transfer-Encoding: chunked\n" +
      "\n" +
      "5;foo=bar\nhello\n" +
      "0\n\n",
  );
  const msg = parse(b);
  assert.equal(msg.body.toString(), "hello");
});

test("管道化：一个 Buffer 里包含两条完整报文", () => {
  const b1 = buf("GET /a HTTP/1.1\nHost: x.com\n\n");
  const b2 = buf(
    "POST /b HTTP/1.1\n" +
      "Host: x.com\n" +
      "Content-Length: 3\n" +
      "\n" +
      "xyz",
  );
  const combined = Buffer.concat([b1, b2]);

  const all = parseAll(combined);
  assert.equal(all.length, 2);
  assert.equal(all[0]!.kind, "request");
  assert.equal((all[0] as HttpMessage & { path: string }).path, "/a");
  assert.equal(all[1]!.kind, "request");
  assert.equal((all[1] as HttpMessage & { path: string }).path, "/b");
  assert.equal((all[1] as { body: Buffer }).body.toString(), "xyz");
});

test("管道化：第一条完整，第二条 header 未到齐", () => {
  const b1 = buf("HTTP/1.1 200 OK\n" + "Content-Length: 5\n" + "\n" + "hello");
  const partial = buf("HTTP/1.1 200 OK\nContent-");
  const combined = Buffer.concat([b1, partial]);

  const all = parseAll(combined);
  assert.equal(all.length, 1); // 只有第一条完整
});

test("不完整 header 时 nextOffset = -1", () => {
  const partial = buf("GET /slow HTTP/1.1\nHost:");
  const msg = parse(partial);
  assert.equal(msg.nextOffset, -1);
});

test("header 后续同名值用逗号合并", () => {
  const b = buf("GET /x HTTP/1.1\n" + "Accept: a\n" + "Accept: b\n" + "\n");
  const msg = parse(b);
  assert.equal(msg.headers["accept"], "a, b");
});

test("serialize 可以把 parse 出来的消息序列化回去", () => {
  const original = buf(
    "HTTP/1.1 200 OK\n" + "content-length: 5\n" + "\n" + "hello",
  );
  const msg = parse(original);
  const serialized = serialize(msg);
  assert.deepEqual(serialized, original);
});

test("大 Content-Length：body 未收齐时 nextOffset = -1", () => {
  const partial = buf(
    "HTTP/1.1 200 OK\n" + "Content-Length: 100\n" + "\n" + "short",
  );
  const msg = parse(partial);
  assert.equal(msg.nextOffset, -1);
});

test("pipelining 多条：parseAll 循环切出每条完整报文", () => {
  const m1 = buf("GET /1 HTTP/1.1\nHost: h1\n\n");
  const m2 = buf("GET /2 HTTP/1.1\nHost: h2\n\n");
  const m3 = buf("POST /3 HTTP/1.1\n" + "Content-Length: 2\n" + "\n" + "hi");
  const combined = Buffer.concat([m1, m2, m3]);
  const all = parseAll(combined);
  assert.equal(all.length, 3);
  assert.equal((all[0] as HttpMessage & { path: string }).path, "/1");
  assert.equal((all[1] as HttpMessage & { path: string }).path, "/2");
  assert.equal(
    (all[2] as HttpMessage & { body: Buffer }).body.toString(),
    "hi",
  );
});
