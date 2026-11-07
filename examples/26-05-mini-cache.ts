// 26.5 mini-http-cache: 强缓存 + 协商缓存 + MemoryCache
import { miniFetch, type MiniResponse } from "./mini-fetch.ts";

interface CacheEntry {
  response: MiniResponse;
  storedAt: number; // ms timestamp
  maxAge: number; // ms, 0 表示无强缓存
  etag?: string;
  lastModified?: string;
  vary?: string;
  // 用来判断是否可被缓存 (no-cache 也可以存,只是每次要协商)
  canUseStale: boolean;
}

export class MemoryCache {
  private store = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    return this.store.get(key);
  }

  /** 强缓存是否命中 */
  isFresh(entry: CacheEntry): boolean {
    if (entry.maxAge <= 0) return false;
    return Date.now() - entry.storedAt <= entry.maxAge;
  }

  set(key: string, entry: CacheEntry) {
    // 简单 size 控制: 超过 100 个先淘汰最早的
    if (this.store.size >= 100) {
      const firstKey = this.store.keys().next().value as string;
      this.store.delete(firstKey);
    }
    this.store.set(key, entry);
  }

  invalidate(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  size() {
    return this.store.size;
  }
}

export interface CacheFetchOptions {
  cache?: MemoryCache;
  useCache?: boolean; // 是否启用缓存, 默认 true
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  signal?: AbortSignal;
  timeout?: number;
  forceRefresh?: boolean; // 跳过缓存直接请求
}

export interface CacheResult {
  response: MiniResponse;
  cached: boolean; // 完全从缓存命中(强缓存)
  revalidated: boolean; // 协商后得到的新鲜响应
}

export async function cacheFetch(
  urlStr: string,
  init: CacheFetchOptions = {},
): Promise<CacheResult> {
  const method = (init.method ?? "GET").toUpperCase();
  const isCacheable = method === "GET" || method === "HEAD";

  const cache = init.cache ?? new MemoryCache();
  const headers = { ...(init.headers ?? {}) };

  // 计算 key (method + url)
  const cacheKey = `${method}:${urlStr}`;

  // 不缓存的方法 → 直接请求
  if (!isCacheable) {
    const resp = await miniFetch(urlStr, { ...init, method, headers });
    return { response: resp, cached: false, revalidated: false };
  }

  let existing: CacheEntry | undefined;
  if (!init.forceRefresh) {
    existing = cache.get(cacheKey);
  }

  // 强缓存命中: 有 entry 且没过期, 且不是 no-cache / no-store
  if (existing && existing.canUseStale && !hasNoCache(existing.response.headers)) {
    if (cache.isFresh(existing)) {
      console.log(`[cache] HIT (strong) ${urlStr}`);
      return { response: existing.response, cached: true, revalidated: false };
    }
  }

  // 协商缓存: 有 etag 或 last-modified
  if (existing) {
    if (existing.etag && !headers["if-none-match"]) {
      headers["If-None-Match"] = existing.etag;
    }
    if (existing.lastModified && !headers["if-modified-since"]) {
      headers["If-Modified-Since"] = existing.lastModified;
    }
  }

  const resp = await miniFetch(urlStr, { ...init, method, headers });

  // 304 Not Modified → 用缓存里的旧 body,但合并新 header
  if (resp.status === 304 && existing) {
    console.log(`[cache] HIT (304 negotiated) ${urlStr}`);
    // 合并 header (cache-control 可能更新)
    const mergedHeaders = { ...existing.response.headers, ...resp.headers };
    const cachedResp: MiniResponse = {
      ...existing.response,
      headers: mergedHeaders,
    };
    // 更新 entry
    const newEntry = buildCacheEntry(cachedResp);
    cache.set(cacheKey, newEntry);
    return { response: cachedResp, cached: false, revalidated: true };
  }

  // 新响应
  const entry = buildCacheEntry(resp);
  if (entry.canUseStale || resp.status === 200 || resp.status === 301 || resp.status === 404) {
    cache.set(cacheKey, entry);
  }

  return { response: resp, cached: false, revalidated: false };
}

function hasNoCache(headers: Record<string, string>): boolean {
  const cc = headers["cache-control"] || headers["Cache-Control"] || "";
  return cc.toLowerCase().includes("no-cache");
}

function buildCacheEntry(resp: MiniResponse): CacheEntry {
  const headers = resp.headers;
  const cc = (headers["cache-control"] || headers["Cache-Control"] || "").toLowerCase();

  let maxAge = 0;
  if (!cc.includes("no-store") && cc.includes("max-age=")) {
    const m = cc.match(/max-age=(\d+)/);
    if (m) maxAge = parseInt(m[1], 10) * 1000;
  }
  // 如果有 expires header 也可以用
  if (maxAge === 0 && headers["expires"]) {
    const exp = new Date(headers["expires"]).getTime();
    maxAge = Math.max(0, exp - Date.now());
  }

  return {
    response: resp,
    storedAt: Date.now(),
    maxAge,
    etag: headers["etag"] || headers["ETag"],
    lastModified: headers["last-modified"] || headers["Last-Modified"],
    canUseStale: !cc.includes("no-store"),
  };
}
