// 文件: cases/08-mini-network-stack-lab/src/cache.ts
// ============ HTTP 缓存：Cache-Control / ETag / Last-Modified 全链路 ============
//
// 提供：
// - MemoryCache：带 LRU 淘汰的 key-value 存储
// - parseCacheControl：把 Cache-Control 字符串拆开成结构化配置
// - cacheFetch：装饰 fetch，自动处理 max-age / must-revalidate / no-cache / ETag / Last-Modified
//
// 测试里用 node:http 起 mock server，真实发请求 + 解析，离线可控。

import { fetch as defaultFetch, HttpResponse } from "./fetch.js";
import type { FetchFn, FetchInit } from "./fetch.js";

export interface CacheControlConfig {
  /** 客户端允许缓存的秒数；0 = 不缓存 */
  maxAge: number;
  /** 如果存在，则只在 max-age 到期后才发条件请求 */
  mustRevalidate: boolean;
  /** 完全不缓存（但仍发条件请求） */
  noCache: boolean;
  /** 不存储，拿到即丢 */
  noStore: boolean;
  /** 私有缓存专用（这里简化处理） */
  private: boolean;
}

export interface CacheEntry {
  response: HttpResponse;
  /** 原始响应 URL（处理重定向后） */
  url: string;
  /** 绝对过期时间戳（毫秒）；0 表示无过期（需校验） */
  expiresAt: number;
  /** max-age 原始秒数，仅用于调试 */
  maxAge: number;
  /** Last-Modified 值（用于条件请求） */
  lastModified: string | null;
  /** ETag 值（用于条件请求） */
  etag: string | null;
  /** 写入时间戳 */
  storedAt: number;
}

export interface MemoryCacheOptions {
  /** 最多多少条目，默认 1000 */
  maxEntries?: number;
}

/**
 * LRU 风格的内存缓存：用 Map 保序，get 后把元素删了重插到尾部。
 */
export class MemoryCache {
  private entries = new Map<string, CacheEntry>();
  private maxEntries: number;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  set(key: string, entry: CacheEntry): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, entry);
    // 淘汰最老的
    while (this.entries.size > this.maxEntries) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey !== undefined) this.entries.delete(firstKey);
      else break;
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  keys(): IterableIterator<string> {
    return this.entries.keys();
  }
}

// ---- Cache-Control 解析 ----

export function parseCacheControl(
  value: string | null | undefined,
): CacheControlConfig {
  const result: CacheControlConfig = {
    maxAge: 0,
    mustRevalidate: false,
    noCache: false,
    noStore: false,
    private: false,
  };
  if (!value) return result;
  const tokens = value.split(",").map((t) => t.trim().toLowerCase());
  for (const token of tokens) {
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq).trim();
    const val =
      eq === -1
        ? null
        : token
            .slice(eq + 1)
            .trim()
            .replace(/^"|"$/g, "");
    switch (name) {
      case "max-age":
        result.maxAge = val !== null ? parseInt(val, 10) || 0 : 0;
        break;
      case "must-revalidate":
        result.mustRevalidate = true;
        break;
      case "no-cache":
        result.noCache = true;
        break;
      case "no-store":
        result.noStore = true;
        break;
      case "private":
        result.private = true;
        break;
      default:
        break;
    }
  }
  return result;
}

// ---- cacheFetch 核心 ----

export interface CacheFetchOptions {
  cache?: MemoryCache;
  fetch?: FetchFn;
  /** 强制跳过缓存（等价于客户端加 Cache-Control: no-cache） */
  force?: boolean;
  /** 时钟，注入后测试离线 */
  now?: () => number;
}

const DEFAULT_CACHE = new MemoryCache();

/**
 * 装饰 fetch：在 fetch 外面套一层 HTTP 缓存语义。
 * - max-age 内：直接返回缓存副本（不发请求）
 * - max-age 外但有 ETag / Last-Modified：发条件请求（If-None-Match / If-Modified-Since）
 * - 304 Not Modified：服务端告诉我缓存没过期，用原响应（刷新 expiresAt）
 * - no-store / no-cache / 无缓存头：直接透传给 fetch
 * - 2xx 新响应：写入缓存并设置 expiresAt
 */
export async function cacheFetch(
  url: string,
  init: FetchInit = {},
  options: CacheFetchOptions = {},
): Promise<HttpResponse> {
  const cache = options.cache ?? DEFAULT_CACHE;
  const fetchImpl = options.fetch ?? (defaultFetch as unknown as FetchFn);
  const nowFn = options.now ?? Date.now;

  if (options.force) {
    const resp = await fetchImpl(url, init);
    cache.set(url, makeCacheEntry(resp, url, nowFn()));
    return resp;
  }

  const entry = cache.get(url);
  const now = nowFn();

  if (entry) {
    // 还在 max-age 内，直接返回缓存副本
    if (entry.expiresAt > now) {
      return cloneResponse(entry.response);
    }
    // 过期了，但有 ETag / Last-Modified，发条件请求
    const condHeaders: Record<string, string> = {};
    if (entry.etag) condHeaders["if-none-match"] = entry.etag;
    if (entry.lastModified)
      condHeaders["if-modified-since"] = entry.lastModified;

    if (Object.keys(condHeaders).length > 0) {
      const mergedHeaders = { ...(init.headers ?? {}), ...condHeaders };
      const condResp = await fetchImpl(url, {
        ...init,
        headers: mergedHeaders,
      });
      if (condResp.status === 304) {
        // 服务端说缓存仍有效，刷新过期时间
        const updatedEntry = updateEntryFrom304(entry, condResp, now);
        cache.set(url, updatedEntry);
        return cloneResponse(updatedEntry.response);
      }
      // 有新内容，覆盖
      cache.set(url, makeCacheEntry(condResp, url, now));
      return condResp;
    }
    // 没有条件头可用，透传
  }

  const resp = await fetchImpl(url, init);
  if (resp.ok) {
    cache.set(url, makeCacheEntry(resp, url, now));
  }
  return resp;
}

function makeCacheEntry(
  response: HttpResponse,
  url: string,
  now: number,
): CacheEntry {
  const cc = parseCacheControl(response.headers.get("cache-control"));
  let expiresAt = 0;
  if (!cc.noStore && cc.maxAge > 0) {
    expiresAt = now + cc.maxAge * 1000;
  } else if (cc.noStore) {
    expiresAt = 0; // 不缓存
  }
  return {
    response: cloneResponse(response),
    url,
    expiresAt,
    maxAge: cc.maxAge,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    storedAt: now,
  };
}

function updateEntryFrom304(
  prev: CacheEntry,
  resp: HttpResponse,
  now: number,
): CacheEntry {
  // 用 304 响应里可能带的头更新条目；若无则沿用原数据
  const cc = parseCacheControl(resp.headers.get("cache-control"));
  const maxAge = resp.headers.has("cache-control") ? cc.maxAge : prev.maxAge;
  const etag = resp.headers.get("etag") ?? prev.etag;
  const lm = resp.headers.get("last-modified") ?? prev.lastModified;

  return {
    ...prev,
    expiresAt: now + (maxAge > 0 ? maxAge * 1000 : prev.maxAge * 1000),
    maxAge,
    etag,
    lastModified: lm,
  };
}

function cloneResponse(resp: HttpResponse): HttpResponse {
  // HttpResponse 浅拷贝 + Buffer.slice(0) 确保不与原响应共享引用
  return new HttpResponse({
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers.toRecord(),
    body: Buffer.from(resp.body),
    url: resp.url,
    redirected: resp.redirected,
  });
}
