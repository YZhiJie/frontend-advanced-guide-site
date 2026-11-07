// 文件: examples/126-03-cache-route-matrix.ts
// 缓存路由矩阵：按请求类型选择策略、超时、过期规则与离线兜底，并演示版本化缓存清理计划。
// 目标：把「全都 CacheFirst」改成「导航/静态/接口/写操作各归其位」，同时避免误删其他应用缓存。
// 运行：npx tsx examples/126-03-cache-route-matrix.ts

import assert from 'node:assert';

type Strategy = 'CacheFirst' | 'NetworkFirst' | 'StaleWhileRevalidate' | 'NetworkOnly' | 'CacheOnly';
type Mode = 'navigate' | 'cors' | 'no-cors' | 'same-origin';

interface RequestLike {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  mode?: Mode;
  destination?: string;
  sameOrigin?: boolean;
}

interface Rule {
  id: string;
  test: (request: RequestLike, url: URL) => boolean;
  strategy: Strategy;
  cacheName: string | null;
  networkTimeoutSeconds?: number;
  fallback?: string;
  queueOnFailure?: boolean;
  expiration?: { maxEntries: number; maxAgeSeconds: number };
  reason: string;
}

interface Decision {
  rule: string;
  strategy: Strategy;
  cacheName: string | null;
  networkTimeoutSeconds?: number;
  fallback?: string;
  queueOnFailure?: boolean;
  expiration?: { maxEntries: number; maxAgeSeconds: number };
  reason: string;
}

const RULES: Rule[] = [
  {
    id: 'mutation',
    test: (request) => (request.method ?? 'GET') !== 'GET',
    strategy: 'NetworkOnly',
    cacheName: null,
    queueOnFailure: true,
    reason: '写请求绝不进 Cache API，失败进入 IDB 队列',
  },
  {
    id: 'navigation',
    test: (request) => request.mode === 'navigate',
    strategy: 'NetworkFirst',
    cacheName: 'fag-pages-v3',
    networkTimeoutSeconds: 3,
    fallback: '/offline.html',
    expiration: { maxEntries: 50, maxAgeSeconds: 86400 },
    reason: '导航优先拿新页面，3 秒超时回落缓存与离线页',
  },
  {
    id: 'hashed-asset',
    test: (_request, url) => /\/assets\/.+-[0-9a-f]{8,}\.(?:js|css|woff2)$/.test(url.pathname),
    strategy: 'CacheFirst',
    cacheName: 'fag-assets-v3',
    expiration: { maxEntries: 80, maxAgeSeconds: 365 * 86400 },
    reason: '带内容哈希的静态资源可长期缓存',
  },
  {
    id: 'image',
    test: (_request, url) => /\.(?:png|jpg|jpeg|webp|avif|svg)$/i.test(url.pathname),
    strategy: 'CacheFirst',
    cacheName: 'fag-images-v3',
    expiration: { maxEntries: 100, maxAgeSeconds: 30 * 86400 },
    reason: '图片变化频率低，限制条目数与 30 天有效期',
  },
  {
    id: 'api-config',
    test: (_request, url) => url.pathname.startsWith('/api/config'),
    strategy: 'StaleWhileRevalidate',
    cacheName: 'fag-api-config-v3',
    reason: '配置可先旧后新，后台静默更新',
  },
  {
    id: 'api-orders',
    test: (_request, url) => url.pathname.startsWith('/api/orders'),
    strategy: 'NetworkFirst',
    cacheName: 'fag-api-orders-v3',
    networkTimeoutSeconds: 2,
    reason: '订单列表要新，弱网 2 秒后回缓存',
  },
  {
    id: 'api-other',
    test: (_request, url) => url.pathname.startsWith('/api/'),
    strategy: 'NetworkFirst',
    cacheName: 'fag-api-v3',
    networkTimeoutSeconds: 3,
    reason: '默认接口走 NetworkFirst，避免展示过期数据',
  },
  {
    id: 'font',
    test: (_request, url) => /fonts\.(?:googleapis|gstatic)\.com/.test(url.hostname),
    strategy: 'StaleWhileRevalidate',
    cacheName: 'fag-fonts-v3',
    expiration: { maxEntries: 20, maxAgeSeconds: 365 * 86400 },
    reason: '字体先旧后新，跨源资源需确认 CORS',
  },
  {
    id: 'default',
    test: () => true,
    strategy: 'NetworkOnly',
    cacheName: null,
    reason: '未命中规则不缓存，避免无界缓存膨胀',
  },
];

function decide(request: RequestLike): Decision {
  const url = new URL(request.url, 'https://app.example.com');
  const rule = RULES.find((item) => item.test(request, url));
  if (!rule) throw new Error('路由表必须包含 default 规则');
  return {
    rule: rule.id,
    strategy: rule.strategy,
    cacheName: rule.cacheName,
    networkTimeoutSeconds: rule.networkTimeoutSeconds,
    fallback: rule.fallback,
    queueOnFailure: rule.queueOnFailure,
    expiration: rule.expiration,
    reason: rule.reason,
  };
}

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref'];

function normalizeCacheKey(rawUrl: string, base = 'https://app.example.com'): string {
  const url = new URL(rawUrl, base);
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.includes(key) || key.startsWith('utm_')) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return `${url.pathname}${url.search}`;
}

function offlineFallback(hasCachedPage: boolean): string | null {
  return hasCachedPage ? null : '/offline.html';
}

function planCachePurge(existing: string[], current: string[], ownedPrefix = 'fag-'): { keep: string[]; remove: string[] } {
  const currentSet = new Set(current);
  const keep: string[] = [];
  const remove: string[] = [];
  for (const name of existing) {
    if (!name.startsWith(ownedPrefix)) {
      keep.push(name);
      continue;
    }
    if (currentSet.has(name)) keep.push(name);
    else remove.push(name);
  }
  return { keep: keep.sort(), remove: remove.sort() };
}

const navigation = decide({ url: 'https://app.example.com/docs/126?utm_source=wechat', mode: 'navigate' });
assert.strictEqual(navigation.strategy, 'NetworkFirst');
assert.strictEqual(navigation.cacheName, 'fag-pages-v3');
assert.strictEqual(navigation.networkTimeoutSeconds, 3);
assert.strictEqual(navigation.fallback, '/offline.html');
assert.strictEqual(navigation.queueOnFailure, undefined);

const hashed = decide({ url: 'https://app.example.com/assets/app-abc12345.js', destination: 'script' });
assert.strictEqual(hashed.strategy, 'CacheFirst');
assert.strictEqual(hashed.cacheName, 'fag-assets-v3');
assert.strictEqual(hashed.expiration?.maxAgeSeconds, 365 * 86400);

const image = decide({ url: 'https://app.example.com/covers/pwa.webp' });
assert.strictEqual(image.strategy, 'CacheFirst');
assert.strictEqual(image.cacheName, 'fag-images-v3');
assert.strictEqual(image.expiration?.maxEntries, 100);

const configApi = decide({ url: 'https://app.example.com/api/config/theme' });
assert.strictEqual(configApi.strategy, 'StaleWhileRevalidate');
assert.strictEqual(configApi.cacheName, 'fag-api-config-v3');

const ordersApi = decide({ url: 'https://app.example.com/api/orders?page=2' });
assert.strictEqual(ordersApi.strategy, 'NetworkFirst');
assert.strictEqual(ordersApi.networkTimeoutSeconds, 2);

const otherApi = decide({ url: 'https://app.example.com/api/user/profile' });
assert.strictEqual(otherApi.strategy, 'NetworkFirst');
assert.strictEqual(otherApi.cacheName, 'fag-api-v3');

const mutation = decide({ url: 'https://app.example.com/api/orders', method: 'POST' });
assert.strictEqual(mutation.strategy, 'NetworkOnly');
assert.strictEqual(mutation.cacheName, null);
assert.strictEqual(mutation.queueOnFailure, true);

const font = decide({ url: 'https://fonts.gstatic.com/s/inter/v13/font.woff2' });
assert.strictEqual(font.strategy, 'StaleWhileRevalidate');
assert.strictEqual(font.cacheName, 'fag-fonts-v3');

const unknown = decide({ url: 'https://app.example.com/random/path', mode: 'cors' });
assert.strictEqual(unknown.rule, 'default');
assert.strictEqual(unknown.strategy, 'NetworkOnly');
assert.strictEqual(unknown.cacheName, null);

assert.strictEqual(normalizeCacheKey('https://app.example.com/docs/126?utm_source=wechat&page=2'), '/docs/126?page=2');
assert.strictEqual(
  normalizeCacheKey('https://app.example.com/docs/126?fbclid=x&utm_campaign=y&b=2&a=1'),
  '/docs/126?a=1&b=2',
);
assert.strictEqual(normalizeCacheKey('https://app.example.com/docs/126?utm_source=a&utm_medium=b'), '/docs/126');

assert.strictEqual(offlineFallback(true), null);
assert.strictEqual(offlineFallback(false), '/offline.html');

const purge = planCachePurge(
  ['fag-pages-v2', 'fag-assets-v2', 'fag-pages-v3', 'other-app-cache', 'fag-fonts-v3'],
  ['fag-pages-v3', 'fag-fonts-v3'],
);
assert.deepStrictEqual(purge.keep, ['fag-fonts-v3', 'fag-pages-v3', 'other-app-cache']);
assert.deepStrictEqual(purge.remove, ['fag-assets-v2', 'fag-pages-v2']);
assert.ok(!purge.remove.includes('other-app-cache'), '不得删除非本应用前缀的缓存');

console.log('126-03 缓存路由矩阵：全部断言通过');
console.log(`  规则数：${RULES.length}，导航兜底：${offlineFallback(false)}`);
console.log(`  版本清理：保留 ${purge.keep.join(', ')}；删除 ${purge.remove.join(', ')}`);
