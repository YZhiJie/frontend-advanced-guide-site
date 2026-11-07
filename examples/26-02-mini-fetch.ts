// 26.2 mini-fetch: 用 node:http.request 封装, 支持 redirect/abort/timeout
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";

export interface MiniFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  signal?: AbortSignal;
  timeout?: number; // ms, 0 = 无
  redirect?: "follow" | "manual" | "error";
  maxRedirects?: number;
}

export interface MiniResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  url: string;
  body: Buffer;
  text(): string;
  json(): any;
  arrayBuffer(): ArrayBuffer;
}

export async function miniFetch(
  urlStr: string,
  init: MiniFetchOptions = {},
): Promise<MiniResponse> {
  return fetchInternal(urlStr, init, 0);
}

async function fetchInternal(
  urlStr: string,
  init: MiniFetchOptions,
  depth: number,
): Promise<MiniResponse> {
  const maxRedirects = init.maxRedirects ?? 5;
  if (depth > maxRedirects) throw new Error("Too many redirects");

  const url = new URL(urlStr);
  const lib = url.protocol === "https:" ? https : http;

  const method = (init.method ?? "GET").toUpperCase();
  const headers = { ...(init.headers ?? {}) };

  const bodyBuf = init.body
    ? typeof init.body === "string"
      ? Buffer.from(init.body)
      : Buffer.from(init.body)
    : null;

  if (bodyBuf && !headers["content-length"] && !headers["Content-Length"]) {
    headers["Content-Length"] = String(bodyBuf.length);
  }

  if (bodyBuf && !headers["content-type"] && !headers["Content-Type"]) {
    headers["Content-Type"] = "text/plain";
  }

  return new Promise<MiniResponse>((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search + url.hash,
        method,
        headers,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const redirectCodes = [301, 302, 303, 307, 308];

        if (redirectCodes.includes(status) && init.redirect !== "manual") {
          const location = res.headers.location;
          if (!location) {
            reject(new Error(`Redirect status ${status} but no Location header`));
            return;
          }
          // drain body then follow
          res.resume();
          res.on("end", () => {
            const nextUrl = new URL(location, url).href;
            let nextMethod = method;
            if (status === 301 || status === 302 || status === 303) {
              nextMethod = "GET"; // 浏览器语义: 302 POST → GET
            }
            const nextBody = (status === 303 || nextMethod === "GET" || nextMethod === "HEAD") ? undefined : bodyBuf;
            fetchInternal(nextUrl, { ...init, method: nextMethod, body: nextBody }, depth + 1)
              .then(resolve)
              .catch(reject);
          });
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          const responseHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) {
              responseHeaders[k] = v.join(", ");
            } else {
              responseHeaders[k] = v ?? "";
            }
          }

          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage ?? "",
            headers: responseHeaders,
            url: urlStr,
            body,
            text: () => body.toString("utf-8"),
            json: () => JSON.parse(body.toString("utf-8")),
            arrayBuffer: () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
          });
        });
        res.on("error", reject);
      },
    );

    // Abort
    const onAbort = () => {
      req.destroy(new Error("Aborted"));
    };
    if (init.signal) {
      if (init.signal.aborted) {
        onAbort();
      } else {
        init.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    // Timeout
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (init.timeout && init.timeout > 0) {
      timeoutId = setTimeout(() => {
        req.destroy(new Error(`Timeout after ${init.timeout}ms`));
      }, init.timeout);
    }

    req.on("error", reject);
    req.on("close", () => {
      if (timeoutId) clearTimeout(timeoutId);
    });

    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}
