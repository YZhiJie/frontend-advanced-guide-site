// 文件: cases/08-mini-network-stack-lab/src/sse.ts
// ============ 手写 EventSource：fetch + ReadableStream 解析 SSE ============
//
// 提供 EventSource 类，行为对齐浏览器 EventSource API：
// - open / message / error 事件
// - data: / event: / id: / retry: 四种前缀
// - 自动重连（指数退避 + retry: 字段覆盖）
// - lastEventId 跨重连透传
// - 可注入 fetch 实现（默认用本项目的 fetch，也可注入 node 原生 fetch 方便测试）

import { fetch as defaultFetch } from "./fetch.js";
import type { FetchFn } from "./fetch.js";

export type EventSourceState = "connecting" | "open" | "closed";

export interface EventSourceOptions {
  /** 可注入的 fetch 实现 */
  fetch?: FetchFn;
  /** 附加请求头，比如 Authorization */
  headers?: Record<string, string>;
  /** 初始重连间隔（毫秒），默认 1000 */
  initialRetry?: number;
  /** 最大重连间隔，默认 30000 */
  maxRetry?: number;
  /** 初始 lastEventId，可用来续接上次断线前的事件序列 */
  lastEventId?: string;
}

export class MessageEvent {
  readonly data: string;
  readonly type: string;
  readonly lastEventId: string;

  constructor(type: string, data: string, lastEventId: string) {
    this.type = type;
    this.data = data;
    this.lastEventId = lastEventId;
  }
}

export type EventListenerFn = (
  event: MessageEvent | { type: string; error?: unknown },
) => void;

/**
 * 手写 EventSource。不继承全局 EventTarget，自己实现 on/off/dispatch。
 */
export class EventSource {
  readonly url: string;
  state: EventSourceState = "connecting";
  lastEventId = "";

  private fetchImpl: FetchFn;
  private extraHeaders: Record<string, string>;
  private initialRetry: number;
  private maxRetry: number;
  private retryDelay: number;

  private listeners = new Map<string, EventListenerFn[]>();
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  constructor(url: string, options: EventSourceOptions = {}) {
    this.url = url;
    this.fetchImpl = options.fetch ?? (defaultFetch as unknown as FetchFn);
    this.extraHeaders = options.headers ?? {};
    this.initialRetry = options.initialRetry ?? 1000;
    this.maxRetry = options.maxRetry ?? 30000;
    this.retryDelay = this.initialRetry;
    if (options.lastEventId) this.lastEventId = options.lastEventId;
    this.connect();
  }

  // ---- 事件订阅 ----

  addEventListener(type: string, handler: EventListenerFn): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(handler);
    this.listeners.set(type, arr);
  }

  removeEventListener(type: string, handler: EventListenerFn): void {
    const arr = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      arr.filter((h) => h !== handler),
    );
  }

  dispatchEvent(
    event: MessageEvent | { type: string; error?: unknown },
  ): boolean {
    const arr = this.listeners.get(event.type) ?? [];
    for (const handler of arr) {
      try {
        handler(event);
      } catch {
        /* ignore */
      }
    }
    return true;
  }

  close(): void {
    this.closed = true;
    this.state = "closed";
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // ---- 内部连接 ----

  private connect(): void {
    if (this.closed) return;
    this.state = "connecting";

    const controller = new AbortController();
    this.abortController = controller;

    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      ...this.extraHeaders,
    };
    if (this.lastEventId) headers["Last-Event-ID"] = this.lastEventId;

    this._connectNow(headers, controller);
  }

  private _connectNow(
    headers: Record<string, string>,
    controller: AbortController,
  ): void {
    this.fetchImpl(this.url, {
      method: "GET",
      headers,
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          this.dispatchEvent({
            type: "error",
            error: new Error("SSE " + response.status),
          });
          this.scheduleReconnect();
          return;
        }
        this.state = "open";
        this.dispatchEvent({ type: "open" });
        this.retryDelay = this.initialRetry;

        const text = response.body.toString("utf-8");
        this.parseAndDispatch(text);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        this.dispatchEvent({ type: "error", error: err });
        this.scheduleReconnect();
      });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetry);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // ---- SSE 解析 ----

  private parseAndDispatch(text: string): void {
    const normalized = text.replace(/\r\n?/g, "\n");
    const blocks = normalized.split(/\n\n+/);

    for (const block of blocks) {
      if (block.trim() === "") continue;

      let eventType = "message";
      const dataLines: string[] = [];
      let lastId = this.lastEventId;

      for (const rawLine of block.split("\n")) {
        const line = rawLine;
        if (line.startsWith(":")) continue;
        const colonIdx = line.indexOf(":");
        let field: string;
        let value: string;
        if (colonIdx === -1) {
          field = line;
          value = "";
        } else {
          field = line.slice(0, colonIdx);
          value = line.slice(colonIdx + 1);
          if (value.startsWith(" ")) value = value.slice(1);
        }

        switch (field) {
          case "event":
            eventType = value;
            break;
          case "data":
            dataLines.push(value);
            break;
          case "id":
            lastId = value;
            this.lastEventId = value;
            break;
          case "retry": {
            const ms = parseInt(value, 10);
            if (!Number.isNaN(ms) && ms > 0) {
              this.retryDelay = ms;
              this.initialRetry = ms;
            }
            break;
          }
          default:
            break;
        }
      }

      if (dataLines.length === 0) continue;
      const data = dataLines.join("\n");
      const evt = new MessageEvent(eventType, data, lastId);
      this.dispatchEvent(evt);
    }
  }
}
