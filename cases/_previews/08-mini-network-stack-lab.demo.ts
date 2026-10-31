// 08-mini-network-stack-lab 在线预览：HTTP 报文解析 / 缓存语义 / SSE 事件流（node:http 已 shim，fetcher 全注入）
import { parse } from "../08-mini-network-stack-lab/src/http-parser.ts";
import {
  cacheFetch,
  MemoryCache,
} from "../08-mini-network-stack-lab/src/cache.ts";
import { EventSource } from "../08-mini-network-stack-lab/src/sse.ts";
import { HttpResponse } from "../08-mini-network-stack-lab/src/fetch.ts";
// 运行时经 esbuild alias 指到 mocks/node-net.ts 的 MiniBuffer；类型上是 @types/node 的 Buffer
import { Buffer } from "node:buffer";
import {
  section,
  button,
  buttonRow,
  textarea,
  output,
  log,
  pre,
  table,
} from "./shared.ts";

const sec = section(
  "① HTTP 报文解析",
  "粘贴原始报文（支持 chunked / 管道化），解析出结构化对象",
);
const out = output(sec);
const ta = textarea(
  sec,
  [
    "HTTP/1.1 200 OK",
    "Content-Type: text/plain",
    "Transfer-Encoding: chunked",
    "",
    "4\r\nWiki\r\n5\r\npedia\r\n0\r\nX-Trailer: v1\r\n\r\n",
  ].join("\n"),
  6,
);

buttonRow(sec);
button(sec, "▶ parse 解析报文", () => {
  try {
    const buf = Buffer.from(ta.value, "latin1");
    const msg = parse(buf);
    pre(
      out,
      {
        kind: msg.kind,
        ...(msg.kind === "request"
          ? { method: msg.method, path: msg.path, version: msg.version }
          : { statusCode: msg.statusCode, reasonPhrase: msg.reasonPhrase }),
        headers: msg.headers,
        body: msg.body.toString("utf-8"),
        bodyBytes: msg.body.length,
        nextOffset: msg.nextOffset,
      },
      "ok",
    );
  } catch (err) {
    pre(out, err, "err");
  }
});

const sec2 = section(
  "② HTTP 缓存语义",
  "注入式 fetcher 每次调用都计数；时钟用真实时间，max-age 设 1 秒",
);
const out2 = output(sec2);
let upstreamCalls = 0;

function upstream(body: string, headers: Record<string, string>): HttpResponse {
  return new HttpResponse({
    status: 200,
    headers,
    body: Buffer.from(body),
  });
}

async function cacheDemo(
  url: string,
  headers: Record<string, string>,
  label: string,
  cache: MemoryCache,
) {
  const before = upstreamCalls;
  const resp = await cacheFetch(
    url,
    {},
    {
      cache,
      fetch: async () => (upstreamCalls++, upstream("payload", headers)),
    },
  );
  log(
    out2,
    `${label}：status=${resp.status} 上游调用 ${upstreamCalls - before} 次`,
    "ok",
  );
}

buttonRow(sec2);
button(sec2, "▶ max-age 1s：1s 内二次请求应命中", async () => {
  upstreamCalls = 0;
  const cache = new MemoryCache();
  await cacheDemo("/api/data", { "Cache-Control": "max-age=1" }, "首次", cache);
  await new Promise((r) => setTimeout(r, 100));
  await cacheDemo(
    "/api/data",
    { "Cache-Control": "max-age=1" },
    "1s 内再请求",
    cache,
  );
  table(out2, [
    ["上游调用总数（应为 1）", upstreamCalls],
    ["缓存条目数", cache.size],
  ]);
});

button(sec2, "▶ 过期 + ETag：条件请求 304", async () => {
  upstreamCalls = 0;
  const cache = new MemoryCache();
  await cacheDemo(
    "/api/etag",
    { "Cache-Control": "max-age=1", ETag: '"v1"' },
    "首次（写入缓存 + ETag）",
    cache,
  );
  log(out2, "等待 1.1s 让缓存过期…", "dim");
  await new Promise((r) => setTimeout(r, 1100));
  const before = upstreamCalls;
  const resp = await cacheFetch(
    "/api/etag",
    {},
    {
      cache,
      fetch: async () => (
        upstreamCalls++,
        new HttpResponse({ status: 304, headers: { ETag: '"v1"' } })
      ),
    },
  );
  log(
    out2,
    `过期后请求：status=${resp.status}（304 → 用缓存副本，不重新下载）`,
    "ok",
  );
  table(out2, [
    ["上游调用总数（304 条件请求算 1 次）", upstreamCalls],
    ["本次上游调用", upstreamCalls - before],
  ]);
});

const sec3 = section(
  "③ SSE 事件流",
  "注入式 fetcher 返回一段 SSE 文本；重连用指数退避（演示里缩短到 100ms）",
);
const out3 = output(sec3);
buttonRow(sec3);
button(sec3, "▶ 播放事件流（data/event/id/retry）", () => {
  const text = [
    "id: 1",
    "event: msg",
    "data: 你好",
    "",
    "data: 无 event 名 → 默认 message",
    "",
    "retry: 100",
    "",
    ": 这行是注释，不产生事件",
    "",
  ].join("\n");
  let closed = false;
  const es = new EventSource("sse://demo", {
    initialRetry: 100,
    fetch: async () =>
      new HttpResponse({ status: 200, body: Buffer.from(text) }),
  });
  es.addEventListener(
    "msg",
    (e) =>
      e &&
      "data" in e &&
      log(out3, `event=msg  data=${e.data}  id=${e.lastEventId}`, "ok"),
  );
  es.addEventListener(
    "message",
    (e) => e && "data" in e && log(out3, `event=message  data=${e.data}`, "ok"),
  );
  es.addEventListener("open", () =>
    log(out3, "连接打开，整段文本一次性 parseAndDispatch", "info"),
  );
  setTimeout(() => {
    if (!closed) {
      closed = true;
      es.close();
      log(out3, "（已关闭连接；retry:100 只在断线重连时生效）", "dim");
    }
  }, 300);
});
button(sec3, "▶ 断线重连（首次 500，退避后重试）", () => {
  let attempts = 0;
  const es = new EventSource("sse://flaky", {
    initialRetry: 100,
    fetch: async () => {
      attempts++;
      if (attempts === 1) {
        log(out3, "第 1 次请求 → 500（触发退避重连）", "err");
        return new HttpResponse({ status: 500 });
      }
      log(out3, "第 2 次请求 → 200", "ok");
      return new HttpResponse({
        status: 200,
        body: Buffer.from("data: reconnected\n\n"),
      });
    },
  });
  es.addEventListener(
    "message",
    (e) => e && "data" in e && log(out3, `收到事件 data=${e.data}`, "ok"),
  );
  setTimeout(() => es.close(), 1000);
});
