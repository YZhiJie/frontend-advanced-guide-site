// 26.3 mini-sse: 手写 EventSource 客户端
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";

export class MiniEventSource extends EventTarget {
  private url: string;
  private headers: Record<string, string>;
  private lastEventId: string = "";
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private defaultRetryMs = 3000;
  private req: any = null;

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readyState = MiniEventSource.CONNECTING;

  constructor(url: string, opts?: { headers?: Record<string, string> }) {
    super();
    this.url = url;
    this.headers = opts?.headers ?? {};
    this.connect();
  }

  private connect() {
    this.readyState = MiniEventSource.CONNECTING;

    const url = new URL(this.url);
    const lib = url.protocol === "https:" ? https : http;

    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      ...this.headers,
    };
    if (this.lastEventId) headers["Last-Event-ID"] = this.lastEventId;

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "GET",
        headers,
      },
      (res) => {
        if (res.statusCode !== 200) {
          this.dispatchEvent(new Event("error"));
          this.scheduleReconnect();
          return;
        }
        this.buffer = "";
        this.readyState = MiniEventSource.OPEN;
        this.dispatchEvent(new Event("open"));

        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => {
          this.buffer += chunk;
          this.processBuffer();
        });
        res.on("end", () => {
          this.dispatchEvent(new Event("error"));
          this.scheduleReconnect();
        });
        res.on("error", () => {
          this.dispatchEvent(new Event("error"));
          this.scheduleReconnect();
        });
      },
    );
    req.on("error", () => {
      this.dispatchEvent(new Event("error"));
      this.scheduleReconnect();
    });
    req.end();
    this.req = req;
  }

  private buffer: string = "";

  private processBuffer() {
    let idx = 0;
    while (true) {
      const sep = this.buffer.indexOf("\n\n", idx);
      if (sep === -1) break;
      const eventText = this.buffer.slice(idx, sep);
      idx = sep + 2;
      this.dispatchSseEvent(eventText);
    }
    this.buffer = this.buffer.slice(idx);
  }

  private dispatchSseEvent(text: string) {
    let eventType = "message";
    const dataLines: string[] = [];
    let id = this.lastEventId;
    let retryMs = this.defaultRetryMs;

    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = normalized.split("\n");

    for (const line of lines) {
      if (!line || line.startsWith(":")) continue;

      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon).trim();
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);

      switch (field) {
        case "event": eventType = value || "message"; break;
        case "data": dataLines.push(value); break;
        case "id": id = value; break;
        case "retry": {
          const n = parseInt(value, 10);
          if (!isNaN(n)) retryMs = n;
          break;
        }
      }
    }

    if (dataLines.length === 0) return;
    this.lastEventId = id;
    this.defaultRetryMs = retryMs;

    const ev = new MessageEvent(eventType, {
      data: dataLines.join("\n"),
      lastEventId: id,
    });
    this.dispatchEvent(ev);
  }

  private scheduleReconnect() {
    this.readyState = MiniEventSource.CONNECTING;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), this.defaultRetryMs);
  }

  close() {
    this.readyState = MiniEventSource.CLOSED;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    try { this.req?.destroy(); } catch { /* ignore */ }
  }

  addEventListener(type: string, listener: (e: any) => void): void {
    super.addEventListener(type, listener as any);
  }
}
