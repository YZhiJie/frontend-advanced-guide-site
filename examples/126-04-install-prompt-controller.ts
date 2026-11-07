// 文件: examples/126-04-install-prompt-controller.ts
// 安装引导控制器：beforeinstallprompt 延迟捕获、访问/关闭频控、A2HS 状态、iOS 分享引导降级。
// 目标：不劫持首屏、不无限骚扰、不把 iOS 当成 Chromium；把「何时可弹、弹什么、点完怎么记」状态化。
// 运行：npx tsx examples/126-04-install-prompt-controller.ts

import assert from 'node:assert';

type Platform = 'chromium' | 'ios' | 'other';
type PromptOutcome = 'accepted' | 'dismissed';
type BannerMode = 'native' | 'ios-guide' | 'none';

interface BeforeInstallPromptEventLike {
  preventDefault: () => void;
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: PromptOutcome; platform: string }>;
}

function makePromptEvent(outcome: PromptOutcome, tracker?: { prevented: boolean; prompted: number }): BeforeInstallPromptEventLike {
  return {
    preventDefault: () => {
      if (tracker) tracker.prevented = true;
    },
    prompt: async () => {
      if (tracker) tracker.prompted += 1;
    },
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  };
}

class InstallPromptController {
  private deferred: BeforeInstallPromptEventLike | null = null;
  private visits = 0;
  private dismisses = 0;
  private lastDismissAt = Number.NEGATIVE_INFINITY;
  installed = false;

  constructor(
    private readonly platform: Platform,
    private readonly standalone: boolean,
    private readonly now: () => number,
    private readonly cooldownMs = 7 * 86400000,
    private readonly maxDismiss = 3,
  ) {}

  visit(): void {
    this.visits += 1;
  }

  capture(event: BeforeInstallPromptEventLike): void {
    event.preventDefault();
    this.deferred = event;
  }

  mode(): BannerMode {
    if (this.installed || this.standalone) return 'none';
    if (this.platform === 'ios') return 'ios-guide';
    return this.deferred ? 'native' : 'none';
  }

  canShow(): boolean {
    if (this.mode() === 'none') return false;
    if (this.visits < 2) return false;
    if (this.dismisses >= this.maxDismiss) return false;
    if (this.now() - this.lastDismissAt < this.cooldownMs) return false;
    return true;
  }

  async prompt(): Promise<PromptOutcome | 'unavailable'> {
    if (!this.deferred) return 'unavailable';
    const event = this.deferred;
    this.deferred = null;
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === 'accepted') {
      this.installed = true;
    } else {
      this.dismisses += 1;
      this.lastDismissAt = this.now();
    }
    return choice.outcome;
  }

  onAppInstalled(): void {
    this.installed = true;
    this.deferred = null;
  }

  snapshot(): { visits: number; dismisses: number; installed: boolean; mode: BannerMode; canShow: boolean } {
    return {
      visits: this.visits,
      dismisses: this.dismisses,
      installed: this.installed,
      mode: this.mode(),
      canShow: this.canShow(),
    };
  }
}

let clock = 0;
const tracker = { prevented: false, prompted: 0 };

const chromium = new InstallPromptController('chromium', false, () => clock);
chromium.visit();
assert.strictEqual(chromium.canShow(), false, '首次访问不弹安装引导');
assert.strictEqual(chromium.mode(), 'none', '未捕获 beforeinstallprompt 时没有原生入口');

chromium.visit();
assert.strictEqual(chromium.canShow(), false, '没有 deferred prompt 仍不能弹');
chromium.capture(makePromptEvent('accepted', tracker));
assert.strictEqual(tracker.prevented, true, '必须 preventDefault，避免浏览器默认迷你条');
assert.strictEqual(chromium.mode(), 'native');
assert.strictEqual(chromium.canShow(), true, '第二次访问且已捕获事件才允许展示自定义入口');

const accepted = await chromium.prompt();
assert.strictEqual(accepted, 'accepted');
assert.strictEqual(tracker.prompted, 1, 'prompt 只调用一次');
assert.strictEqual(chromium.installed, true);
assert.strictEqual(chromium.mode(), 'none', '安装后不再展示入口');
assert.strictEqual(chromium.canShow(), false);

let dismissClock = 0;
const dismissing = new InstallPromptController('chromium', false, () => dismissClock);
dismissing.visit();
dismissing.visit();
dismissing.capture(makePromptEvent('dismissed'));
assert.strictEqual(await dismissing.prompt(), 'dismissed');
assert.strictEqual(dismissing.snapshot().dismisses, 1);
assert.strictEqual(dismissing.canShow(), false, '关闭后进入冷却期');
dismissClock += 8 * 86400000;
assert.strictEqual(dismissing.canShow(), false, '事件是一次性的，关闭后再点无效');
dismissing.capture(makePromptEvent('dismissed'));
assert.strictEqual(dismissing.canShow(), true, '冷却期结束且重新捕获事件后可再次引导');
await dismissing.prompt();
dismissClock += 8 * 86400000;
dismissing.capture(makePromptEvent('dismissed'));
await dismissing.prompt();
dismissClock += 8 * 86400000;
dismissing.capture(makePromptEvent('dismissed'));
assert.strictEqual(dismissing.snapshot().dismisses, 3);
assert.strictEqual(dismissing.canShow(), false, '达到最大关闭次数后不再骚扰');

const ios = new InstallPromptController('ios', false, () => clock);
ios.visit();
ios.visit();
assert.strictEqual(ios.mode(), 'ios-guide', 'iOS 没有 beforeinstallprompt，只能展示分享引导');
assert.strictEqual(ios.canShow(), true);
assert.strictEqual(await ios.prompt(), 'unavailable', 'iOS 不能调用原生安装弹窗');

const standalone = new InstallPromptController('chromium', true, () => clock);
standalone.visit();
standalone.visit();
standalone.capture(makePromptEvent('accepted'));
assert.strictEqual(standalone.canShow(), false, '已以 standalone 启动时不再引导安装');
assert.strictEqual(standalone.mode(), 'none');

const installedByOs = new InstallPromptController('chromium', false, () => clock);
installedByOs.visit();
installedByOs.visit();
installedByOs.capture(makePromptEvent('accepted'));
installedByOs.onAppInstalled();
assert.strictEqual(installedByOs.installed, true);
assert.strictEqual(installedByOs.mode(), 'none', 'appinstalled 事件后入口应立即消失');
assert.strictEqual(await installedByOs.prompt(), 'unavailable', '事件已被清理');

console.log('126-04 安装引导控制器：全部断言通过');
console.log('  Chromium：二次访问 + deferredPrompt → 展示 → accepted → 永久隐藏');
console.log('  Dismiss：冷却 7 天 × 最多 3 次；iOS：只走分享引导；standalone：不再引导');
