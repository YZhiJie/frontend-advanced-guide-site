// 文件: examples/126-02-sw-lifecycle-simulator.ts
// Service Worker 生命周期与版本更新状态机模拟：install → waiting → prompt → skipWaiting → controllerchange。
// 目标：把「新版本什么时候生效、脏表单如何阻止刷新、为什么只刷新一次」变成可断言的状态迁移。
// 运行：npx tsx examples/126-02-sw-lifecycle-simulator.ts

import assert from 'node:assert';

type WorkerState = 'parsed' | 'installing' | 'installed' | 'activating' | 'activated' | 'redundant';
type UpdateState = 'idle' | 'checking' | 'available' | 'prompting' | 'applying' | 'applied' | 'deferred';

interface WorkerRecord {
  version: string;
  state: WorkerState;
}

interface Registry {
  active: WorkerRecord | null;
  waiting: WorkerRecord | null;
  controller: WorkerRecord | null;
  updateState: UpdateState;
  reloadCount: number;
  controllerChanges: number;
  reloadedAfterApply: boolean;
}

interface InstallOptions {
  clientsClaim?: boolean;
}

function makeRegistry(): Registry {
  return {
    active: null,
    waiting: null,
    controller: null,
    updateState: 'idle',
    reloadCount: 0,
    controllerChanges: 0,
    reloadedAfterApply: false,
  };
}

function emitControllerChange(registry: Registry): void {
  registry.controllerChanges += 1;
  if (registry.updateState === 'applied' && !registry.reloadedAfterApply) {
    registry.reloadCount += 1;
    registry.reloadedAfterApply = true;
  }
}

function installVersion(registry: Registry, version: string, options: InstallOptions = {}): WorkerRecord {
  const worker: WorkerRecord = { version, state: 'installing' };
  worker.state = 'installed';

  if (registry.controller && !options.clientsClaim) {
    registry.waiting = worker;
    registry.updateState = 'available';
    return worker;
  }

  worker.state = 'activating';
  worker.state = 'activated';
  registry.active = worker;
  registry.waiting = null;
  if (options.clientsClaim) {
    registry.controller = worker;
    emitControllerChange(registry);
  }
  return worker;
}

function checkForUpdate(registry: Registry, nextVersion: string): UpdateState {
  if (!registry.controller) {
    return 'idle';
  }
  registry.updateState = 'checking';
  installVersion(registry, nextVersion);
  return registry.updateState;
}

function promptUpdate(registry: Registry, hasDirtyForm: boolean): 'deferred' | 'prompting' | 'ignored' {
  if (registry.updateState !== 'available') return 'ignored';
  if (hasDirtyForm) {
    registry.updateState = 'deferred';
    return 'deferred';
  }
  registry.updateState = 'prompting';
  return 'prompting';
}

function resolveDeferred(registry: Registry, hasDirtyForm: boolean): 'deferred' | 'prompting' | 'ignored' {
  if (registry.updateState !== 'deferred') return 'ignored';
  if (hasDirtyForm) return 'deferred';
  registry.updateState = 'prompting';
  return 'prompting';
}

function applyUpdate(registry: Registry): 'applied' | 'ignored' {
  if (registry.updateState !== 'prompting' || !registry.waiting) return 'ignored';
  registry.updateState = 'applying';
  const next = registry.waiting;
  next.state = 'activating';
  next.state = 'activated';
  registry.active = next;
  registry.waiting = null;
  registry.controller = next;
  registry.updateState = 'applied';
  emitControllerChange(registry);
  return 'applied';
}

function skipWaitingImmediately(registry: Registry): 'applied' | 'ignored' {
  if (!registry.waiting) return 'ignored';
  registry.updateState = 'prompting';
  return applyUpdate(registry);
}

const firstInstall = makeRegistry();
installVersion(firstInstall, 'v1');
assert.strictEqual(firstInstall.active?.version, 'v1');
assert.strictEqual(firstInstall.controller, null, '首次安装默认不接管已加载页面');
assert.strictEqual(firstInstall.waiting, null);
assert.strictEqual(firstInstall.reloadCount, 0);

const claimedFirstInstall = makeRegistry();
installVersion(claimedFirstInstall, 'v1', { clientsClaim: true });
assert.strictEqual(claimedFirstInstall.controller?.version, 'v1', 'clientsClaim 让首屏立即可控');
assert.strictEqual(claimedFirstInstall.controllerChanges, 1);
assert.strictEqual(claimedFirstInstall.reloadCount, 0, '首次安装不需要刷新页面');

const updating = makeRegistry();
installVersion(updating, 'v1', { clientsClaim: true });
assert.strictEqual(checkForUpdate(updating, 'v2'), 'available');
assert.strictEqual(updating.active?.version, 'v1', '旧版本继续服务当前页面');
assert.strictEqual(updating.waiting?.version, 'v2', '新版本在 waiting 等待激活');

assert.strictEqual(promptUpdate(updating, true), 'deferred', '脏表单应推迟更新');
assert.strictEqual(updating.updateState, 'deferred');
assert.strictEqual(resolveDeferred(updating, true), 'deferred', '表单未保存时继续推迟');
assert.strictEqual(resolveDeferred(updating, false), 'prompting', '表单保存后才允许更新');
assert.strictEqual(applyUpdate(updating), 'applied');
assert.strictEqual(updating.active?.version, 'v2');
assert.strictEqual(updating.controller?.version, 'v2');
assert.strictEqual(updating.waiting, null);
assert.strictEqual(updating.reloadCount, 1, 'controllerchange 只触发一次刷新');
assert.strictEqual(applyUpdate(updating), 'ignored', '重复点击更新必须幂等');
assert.strictEqual(updating.reloadCount, 1, '重复点击不能再刷新');

const noController = makeRegistry();
installVersion(noController, 'v1');
assert.strictEqual(checkForUpdate(noController, 'v2'), 'idle', '没有 controller 时不存在「更新」流程');

const idlePrompt = makeRegistry();
installVersion(idlePrompt, 'v1', { clientsClaim: true });
assert.strictEqual(promptUpdate(idlePrompt, false), 'ignored', '没有 available 版本时不能弹出更新');
assert.strictEqual(applyUpdate(idlePrompt), 'ignored');

const forceUpdate = makeRegistry();
installVersion(forceUpdate, 'v1', { clientsClaim: true });
checkForUpdate(forceUpdate, 'v2');
assert.strictEqual(skipWaitingImmediately(forceUpdate), 'applied', '紧急修复可绕过提示直接 skipWaiting');
assert.strictEqual(forceUpdate.reloadCount, 1);

const dirtyThenApply = makeRegistry();
installVersion(dirtyThenApply, 'v1', { clientsClaim: true });
checkForUpdate(dirtyThenApply, 'v2');
promptUpdate(dirtyThenApply, true);
assert.strictEqual(dirtyThenApply.updateState, 'deferred');
assert.strictEqual(dirtyThenApply.active?.version, 'v1', '推迟期间旧版本仍然服务');
resolveDeferred(dirtyThenApply, false);
applyUpdate(dirtyThenApply);
assert.strictEqual(dirtyThenApply.active?.version, 'v2');
assert.strictEqual(dirtyThenApply.reloadCount, 1);

const redundant = makeRegistry();
installVersion(redundant, 'v1', { clientsClaim: true });
const failed = checkForUpdate(redundant, 'v2-broken');
failed;
if (redundant.waiting) redundant.waiting.state = 'redundant';
redundant.waiting = null;
redundant.updateState = 'idle';
assert.strictEqual(redundant.active?.version, 'v1', '安装失败的新版本不能影响旧版本');
assert.strictEqual(redundant.waiting, null);

console.log('126-02 SW 生命周期与更新状态机：全部断言通过');
console.log('  首次安装 → controller null；clientsClaim → 立即接管且不刷新');
console.log('  v1 → v2：available → deferred（脏表单）→ prompting → applied → 恰好 1 次刷新');
