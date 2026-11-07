// 文件: cases/08-mini-network-stack-lab/src/fetch.ts
// ============ 手写 fetch：http.createConnection / https.request 闭环 ============
//
// 提供 fetch(url, init) → Promise<HttpResponse>，支持：
// - http / https 协议
// - 跟随 3xx 重定向（最多 5 次）
// - AbortController 取消
// - per-request timeout
// - 自定义 headers / body / method

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { Buffer } from "node:buffer";

// ---- 对外类型 ----

export interface FetchInit {
  method?: string;
  headers?: Record<string, string> | HttpHeaders;
  body?: string | Buffer | Uint8Array | null;
  signal?: AbortSignal;
  /** 超时毫秒，0 表示不限时 */
  timeout?: number;
  /** 最大重定向次数，默认 5 */
  maxRedirects?: number;
}

export interface HttpResponseInit {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: Buffer;
  url?: string;
  redirected?: boolean;
}

export class HttpHeaders {
  private _entries: [string, string][] = [];

  constructor(init?: Record<string, string> | HttpHeaders) {
    if (init instanceof HttpHeaders) {
      for (const [k, v] of init._entries) this._entries.push([k, v]);
    } else if (init) {
      for (const [k, v] of Object.entries(init)) this.set(k, v);
    }
  }
  set(name: string, value: string): void {
    const idx = this._entries.findIndex(
      ([k]) => k.toLowerCase() === name.toLowerCase(),
    );
    if (idx >= 0) this._entries[idx] = [this._entries[idx]![0]!, value];
    else this._entries.push([name, value]);
  }
  get(name: string): string | null {
    const entry = this._entries.find(
      ([k]) => k.toLowerCase() === name.toLowerCase(),
    );
    return entry ? entry[1]! : null;
  }
  has(name: string): boolean {
    return this.get(name) !== null;
  }
  entries(): [string, string][] {
    return [...this._entries];
  }
  forEach(fn: (value: string, key: string) => void): void {
    for (const [k, v] of this._entries) fn(v, k);
  }
  append(name: string, value: string): void {
    const existing = this.get(name);
    if (existing) this.set(name, existing + ", " + value);
    else this.set(name, value);
  }
  delete(name: string): void {
    const lower = name.toLowerCase();
    this._entries = this._entries.filter(([k]) => k.toLowerCase() !== lower);
  }
  toRecord(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this._entries) out[k] = v;
    return out;
  }
}

export class HttpResponse {
  status: number;
  statusText: string;
  ok: boolean;
  headers: HttpHeaders;
  body: Buffer;
  url: string;
  redirected: boolean;

  constructor(init: HttpResponseInit = {}) {
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? "";
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new HttpHeaders(init.headers);
    this.body = init.body ?? Buffer.alloc(0);
    this.url = init.url ?? "";
    this.redirected = init.redirected ?? false;
  }

  text(): string {
    return this.body.toString("utf-8");
  }
  json(): unknown {
    return JSON.parse(this.text());
  }
}

export class HttpRequest {
  url: string;
  method: string;
  headers: HttpHeaders;
  body: Buffer;
  signal?: AbortSignal;

  constructor(url: string | URL, init: FetchInit = {}) {
    this.url = url instanceof URL ? url.toString() : url;
    this.method = (init.method ?? "GET").toUpperCase();
    this.headers = new HttpHeaders(init.headers);
    this.body = toBuffer(init.body);
    this.signal = init.signal;
  }
}

// ---- 工具 ----

function toBuffer(body: FetchInit["body"]): Buffer {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (body instanceof Buffer) return body;
  if (body instanceof Uint8Array)
    return Buffer.from(
      body.buffer as ArrayBuffer,
      body.byteOffset,
      body.byteLength,
    );
  if (typeof body === "string") return Buffer.from(body, "utf-8");
  return Buffer.alloc(0);
}

export class AbortError extends Error {
  override name = "AbortError";
  constructor(message = "The operation was aborted.") {
    super(message);
  }
}

export class NetworkError extends Error {
  override name = "NetworkError";
}

export class TimeoutError extends Error {
  override name = "TimeoutError";
}

// ---- 主入口 fetch ----

export async function fetch(
  input: string | URL | HttpRequest,
  init: FetchInit = {},
): Promise<HttpResponse> {
  let currentUrl: URL =
    input instanceof URL
      ? input
      : input instanceof HttpRequest
        ? new URL(input.url)
        : new URL(input);

  const maxRedirects = init.maxRedirects ?? 5;
  let redirected = false;
  let lastStatus = 0;

  // 合并调用方 signal 与 timeout signal
  const callerSignal =
    input instanceof HttpRequest ? (input as HttpRequest).signal : init.signal;
  const combinedSignal = combineWithTimeout(callerSignal, init.timeout);
  const initialBody: Buffer =
    input instanceof HttpRequest
      ? (input as HttpRequest).body
      : toBuffer(init.body);
  const initialMethod = (
    input instanceof HttpRequest
      ? (input as HttpRequest).method
      : (init.method ?? "GET")
  ).toUpperCase();

  if (combinedSignal?.aborted) {
    throw new AbortError();
  }

  let currentMethod = initialMethod;
  let currentHeaders: HttpHeaders = (() => {
    if (input instanceof HttpRequest) return (input as HttpRequest).headers;
    return new HttpHeaders(init.headers);
  })();
  let currentBody = initialBody;

  for (let attempt = 0; attempt <= maxRedirects; attempt++) {
    const response = await doRequest(
      currentUrl,
      currentMethod,
      currentHeaders,
      currentBody,
      combinedSignal,
    );
    lastStatus = response.status;
    response.redirected = redirected;
    response.url = currentUrl.toString();

    // 重定向跳转
    if (isRedirect(response.status) && response.headers.has("location")) {
      const location = response.headers.get("location")!;
      const nextUrl = new URL(location, currentUrl);
      redirected = true;
      currentUrl = nextUrl;

      if (response.status === 303) {
        // 303 强制 GET，丢 body
        currentMethod = "GET";
        currentBody = Buffer.alloc(0);
      } else if (response.status === 301 || response.status === 302) {
        // 浏览器行为：如果原方法是 POST，改成 GET 并丢 body
        if (initialMethod === "POST") {
          currentMethod = "GET";
          currentBody = Buffer.alloc(0);
        }
      }
      continue;
    }
    return response;
  }
  throw new NetworkError(`超过最大重定向次数 ${maxRedirects}`);
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

/** 把调用方 signal 与 timeout 组合成一个 signal */
function combineWithTimeout(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined {
  if (!callerSignal && (!timeoutMs || timeoutMs <= 0)) return callerSignal;
  const controller = new AbortController();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
      return controller.signal;
    }
    callerSignal.addEventListener(
      "abort",
      () => controller.abort(callerSignal.reason),
      { once: true },
    );
  }
  if (timeoutMs && timeoutMs > 0) {
    const timer = setTimeout(
      () => controller.abort(new TimeoutError(`请求超时（>${timeoutMs}ms）`)),
      timeoutMs,
    );
    controller.signal.addEventListener("abort", () => clearTimeout(timer), {
      once: true,
    });
  }
  return controller.signal;
}

// ---- 实际的 socket 请求 ----

function doRequest(
  url: URL,
  method: string,
  headers: HttpHeaders,
  body: Buffer,
  signal: AbortSignal | undefined,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;

    const portNum = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
    const opts: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: portNum,
      path: url.pathname + url.search + url.hash,
      headers: buildNodeHeaders(headers, body, url.host),
    };

    const req = lib.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const bodyBuf = Buffer.concat(chunks);
        const resp = new HttpResponse({
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? "",
          headers: nodeHeadersToRecord(res.headers),
          body: bodyBuf,
        });
        resolve(resp);
      });
      res.on("error", reject);
    });

    let settled = false;
    let aborted = false;

    const makeAbortReason = (signalReason: unknown): Error => {
      if (signalReason instanceof TimeoutError) return signalReason;
      if (signalReason instanceof AbortError) return signalReason;
      if (signalReason instanceof Error) {
        return new AbortError(signalReason.message || "aborted");
      }
      return new AbortError();
    };

    req.on("error", (err) => {
      if (settled) return;
      if (aborted) return;
      settled = true;
      reject(err instanceof Error ? err : new NetworkError(String(err)));
    });

    if (signal) {
      if (signal.aborted) {
        aborted = true;
        settled = true;
        req.destroy();
        reject(makeAbortReason(signal.reason));
        return;
      }
      const onAbort = () => {
        if (settled) return;
        aborted = true;
        settled = true;
        req.destroy();
        reject(makeAbortReason(signal.reason));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => signal.removeEventListener("abort", onAbort));
    }

    if (body.length > 0) req.write(body);
    req.end();
  });
}

function buildNodeHeaders(
  headers: HttpHeaders,
  body: Buffer,
  host: string,
): Record<string, string> {
  const lowerMap: Record<string, string> = {};
  headers.forEach((v, k) => {
    lowerMap[k.toLowerCase()] = k;
  });

  const out: Record<string, string> = {};
  for (const [k, v] of headers.entries()) out[k] = v;
  if (!("host" in lowerMap)) out["Host"] = host;
  if (body.length > 0 && !("content-length" in lowerMap)) {
    out["Content-Length"] = String(body.length);
  }
  return out;
}

function nodeHeadersToRecord(
  raw: http.IncomingHttpHeaders,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) out[k] = v.join(", ");
    else out[k] = v;
  }
  return out;
}

// 导出给其他模块复用
export type FetchFn = (
  url: string | URL,
  init?: FetchInit,
) => Promise<HttpResponse>;
