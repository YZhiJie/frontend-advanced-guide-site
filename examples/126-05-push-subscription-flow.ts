// 文件: examples/126-05-push-subscription-flow.ts
// Web Push 订阅与投递流：权限降级、VAPID 公钥转换、订阅复用、404/410 清理、429/5xx 重试、pushsubscriptionchange。
// 目标：推送不是「拿到 endpoint 就完事」，而是权限、密钥、失效清理与重试策略的闭环。
// 运行：npx tsx examples/126-05-push-subscription-flow.ts

import assert from 'node:assert';

type Permission = 'default' | 'granted' | 'denied';

interface PushSubscriptionLike {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface SubscribeOptions {
  userVisibleOnly: boolean;
  applicationServerKey: Uint8Array;
}

interface PushManagerLike {
  getSubscription: () => Promise<PushSubscriptionLike | null>;
  subscribe: (options: SubscribeOptions) => Promise<PushSubscriptionLike>;
}

class FakePushManager implements PushManagerLike {
  subscribeCalls = 0;
  lastOptions: SubscribeOptions | null = null;
  private failNext = false;

  constructor(private existing: PushSubscriptionLike | null = null) {}

  async getSubscription(): Promise<PushSubscriptionLike | null> {
    return this.existing;
  }

  async subscribe(options: SubscribeOptions): Promise<PushSubscriptionLike> {
    this.subscribeCalls += 1;
    this.lastOptions = options;
    if (this.failNext) {
      this.failNext = false;
      throw new Error('push service unavailable');
    }
    const subscription: PushSubscriptionLike = {
      endpoint: `https://push.example.com/sub/new-${this.subscribeCalls}`,
      keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    };
    this.existing = subscription;
    return subscription;
  }

  setExisting(subscription: PushSubscriptionLike | null): void {
    this.existing = subscription;
  }

  failOnNextSubscribe(): void {
    this.failNext = true;
  }
}

interface SubscribeResult {
  status: 'granted' | 'denied' | 'error';
  action: 'created' | 'reused' | 'settings-guide' | 'invalid-key' | 'subscription-failed';
  subscription?: PushSubscriptionLike;
  userVisibleOnly?: boolean;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  if (!base64String) return new Uint8Array();
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function subscribeFlow(input: {
  permission: Permission;
  requestPermission: () => Promise<boolean>;
  manager: PushManagerLike;
  publicKey: string;
}): Promise<SubscribeResult> {
  let permission = input.permission;
  if (permission === 'denied') {
    return { status: 'denied', action: 'settings-guide' };
  }
  if (permission === 'default') {
    const granted = await input.requestPermission();
    if (!granted) return { status: 'denied', action: 'settings-guide' };
    permission = 'granted';
  }

  const applicationServerKey = urlBase64ToUint8Array(input.publicKey);
  if (applicationServerKey.length === 0) {
    return { status: 'error', action: 'invalid-key' };
  }

  const existing = await input.manager.getSubscription();
  if (existing) {
    return { status: 'granted', action: 'reused', subscription: existing, userVisibleOnly: true };
  }

  try {
    const subscription = await input.manager.subscribe({ userVisibleOnly: true, applicationServerKey });
    return { status: 'granted', action: 'created', subscription, userVisibleOnly: true };
  } catch {
    return { status: 'error', action: 'subscription-failed' };
  }
}

class SubscriptionStore {
  private readonly entries = new Map<string, PushSubscriptionLike>();
  removeCount = 0;

  add(subscription: PushSubscriptionLike): void {
    this.entries.set(subscription.endpoint, subscription);
  }

  has(endpoint: string): boolean {
    return this.entries.has(endpoint);
  }

  remove(endpoint: string): boolean {
    const existed = this.entries.delete(endpoint);
    if (existed) this.removeCount += 1;
    return existed;
  }

  get size(): number {
    return this.entries.size;
  }

  replace(oldEndpoint: string, next: PushSubscriptionLike): void {
    this.entries.delete(oldEndpoint);
    this.entries.set(next.endpoint, next);
  }

  endpoints(): string[] {
    return [...this.entries.keys()];
  }
}

interface SendResult {
  action: 'keep' | 'remove' | 'retry' | 'drop';
  removed?: boolean;
  retryAfterSeconds?: number;
  backoffMs?: number;
  reason?: string;
}

function sendPush(
  statusCode: number,
  endpoint: string,
  store: SubscriptionStore,
  options: { attempt?: number; retryAfterSeconds?: number } = {},
): SendResult {
  const attempt = options.attempt ?? 0;
  if (statusCode >= 200 && statusCode < 300) {
    return { action: 'keep' };
  }
  if (statusCode === 404 || statusCode === 410) {
    return { action: 'remove', removed: store.remove(endpoint) };
  }
  if (statusCode === 429) {
    return { action: 'retry', retryAfterSeconds: options.retryAfterSeconds ?? 60 };
  }
  if (statusCode >= 500) {
    return { action: 'retry', backoffMs: 1000 * 2 ** attempt };
  }
  if (statusCode === 400 || statusCode === 401 || statusCode === 403) {
    return { action: 'drop', reason: 'payload-or-auth-invalid' };
  }
  return { action: 'drop', reason: `unexpected-${statusCode}` };
}

type ClickAction = 'open' | 'dismiss';

function notificationClick(action: ClickAction, hasFocusedClient: boolean): 'focus-existing' | 'open-new' | 'close' {
  if (action === 'dismiss') return 'close';
  return hasFocusedClient ? 'focus-existing' : 'open-new';
}

interface ChangeResult {
  status: 'replaced' | 'needs-reauth';
  subscription?: PushSubscriptionLike;
}

async function subscriptionChangeFlow(
  manager: FakePushManager,
  store: SubscriptionStore,
  oldEndpoint: string,
  publicKey: string,
  failed = false,
): Promise<ChangeResult> {
  if (failed) {
    return { status: 'needs-reauth' };
  }
  try {
    const next = await manager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    store.replace(oldEndpoint, next);
    return { status: 'replaced', subscription: next };
  } catch {
    return { status: 'needs-reauth' };
  }
}

const DENIED_MANAGER = new FakePushManager();
const denied = await subscribeFlow({
  permission: 'denied',
  requestPermission: async () => false,
  manager: DENIED_MANAGER,
  publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa',
});
assert.strictEqual(denied.status, 'denied');
assert.strictEqual(denied.action, 'settings-guide');
assert.strictEqual(DENIED_MANAGER.subscribeCalls, 0, '权限已拒绝时不得再调用 subscribe');

const DEFAULT_MANAGER = new FakePushManager();
const rejected = await subscribeFlow({
  permission: 'default',
  requestPermission: async () => false,
  manager: DEFAULT_MANAGER,
  publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa',
});
assert.strictEqual(rejected.action, 'settings-guide');
assert.strictEqual(DEFAULT_MANAGER.subscribeCalls, 0);

const GRANTED_MANAGER = new FakePushManager();
const created = await subscribeFlow({
  permission: 'granted',
  requestPermission: async () => true,
  manager: GRANTED_MANAGER,
  publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa',
});
assert.strictEqual(created.status, 'granted');
assert.strictEqual(created.action, 'created');
assert.strictEqual(created.userVisibleOnly, true, 'Web Push 必须 userVisibleOnly=true');
assert.strictEqual(GRANTED_MANAGER.lastOptions?.userVisibleOnly, true);
assert.ok((GRANTED_MANAGER.lastOptions?.applicationServerKey.length ?? 0) > 0);
assert.ok(created.subscription?.endpoint.startsWith('https://push.example.com/sub/'));

const REUSE_MANAGER = new FakePushManager({
  endpoint: 'https://push.example.com/existing',
  keys: { p256dh: 'p', auth: 'a' },
});
const reused = await subscribeFlow({
  permission: 'granted',
  requestPermission: async () => true,
  manager: REUSE_MANAGER,
  publicKey: 'AQAB',
});
assert.strictEqual(reused.action, 'reused');
assert.strictEqual(REUSE_MANAGER.subscribeCalls, 0, '已有订阅必须复用，避免重复注册');

const INVALID_KEY = await subscribeFlow({
  permission: 'granted',
  requestPermission: async () => true,
  manager: new FakePushManager(),
  publicKey: '',
});
assert.strictEqual(INVALID_KEY.action, 'invalid-key');

const FAILED_MANAGER = new FakePushManager();
FAILED_MANAGER.failOnNextSubscribe();
const failedSubscribe = await subscribeFlow({
  permission: 'granted',
  requestPermission: async () => true,
  manager: FAILED_MANAGER,
  publicKey: 'AQAB',
});
assert.strictEqual(failedSubscribe.status, 'error');
assert.strictEqual(failedSubscribe.action, 'subscription-failed');

const store = new SubscriptionStore();
const target = { endpoint: 'https://push.example.com/sub/1', keys: { p256dh: 'p', auth: 'a' } };
store.add(target);
assert.strictEqual(sendPush(201, target.endpoint, store).action, 'keep');
assert.strictEqual(store.size, 1);
assert.strictEqual(sendPush(429, target.endpoint, store, { retryAfterSeconds: 30 }).retryAfterSeconds, 30);
assert.strictEqual(sendPush(503, target.endpoint, store, { attempt: 2 }).backoffMs, 4000);
assert.strictEqual(sendPush(400, target.endpoint, store).action, 'drop');
assert.strictEqual(store.size, 1);

const gone = sendPush(410, target.endpoint, store);
assert.strictEqual(gone.action, 'remove');
assert.strictEqual(gone.removed, true);
assert.strictEqual(store.size, 0);
const goneAgain = sendPush(410, target.endpoint, store);
assert.strictEqual(goneAgain.removed, false, '重复收到 410 时清理必须幂等');
assert.strictEqual(store.removeCount, 1);

assert.strictEqual(notificationClick('open', true), 'focus-existing');
assert.strictEqual(notificationClick('open', false), 'open-new');
assert.strictEqual(notificationClick('dismiss', true), 'close');

const changeStore = new SubscriptionStore();
changeStore.add(target);
const changeManager = new FakePushManager();
const changed = await subscriptionChangeFlow(
  changeManager,
  changeStore,
  target.endpoint,
  'BEl62iUYgUivxIkv69yViEuiBIa',
);
assert.strictEqual(changed.status, 'replaced');
assert.strictEqual(changeStore.size, 1, '订阅变更后服务器只保留新 endpoint');
assert.ok(!changeStore.has(target.endpoint));

const reauth = await subscriptionChangeFlow(new FakePushManager(), changeStore, target.endpoint, 'AQAB', true);
assert.strictEqual(reauth.status, 'needs-reauth', '重新订阅失败时应要求用户重新授权');

console.log('126-05 推送订阅流：全部断言通过');
console.log('  权限 denied/default 拒绝 → 不 subscribe；granted → userVisibleOnly=true');
console.log('  410 → 幂等清理；429/5xx → 重试；pushsubscriptionchange → 替换或重新授权');
