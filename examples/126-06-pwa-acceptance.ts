// 文件: examples/126-06-pwa-acceptance.ts
// PWA 验收清单引擎：把 manifest / Service Worker / 缓存 / 离线 / 安装 / 推送 / 调试验收项汇总为可发布的 go/no-go。
// 目标：不靠「感觉能离线」上线；阻断项、告警项、跳过项分层，并正确处理 Lighthouse 12+ 已移除 PWA 分类。
// 运行：npx tsx examples/126-06-pwa-acceptance.ts

import assert from 'node:assert';

type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
type Category = 'manifest' | 'service-worker' | 'cache' | 'offline' | 'install' | 'push' | 'debug';
type Decision = 'ship' | 'ship-with-warnings' | 'hold';

interface CheckResult {
  id: string;
  category: Category;
  status: CheckStatus;
  weight: number;
  detail: string;
}

interface PwaReport {
  manifest: {
    name?: string;
    start_url?: string;
    display?: string;
    id?: string;
    screenshots: boolean;
    icons: Array<{ sizes: string; purpose?: string }>;
  };
  sw: {
    registered: boolean;
    controller: boolean;
    fetchHandler: boolean;
    updateViaCache?: string;
    waiting: boolean;
  };
  caches: {
    names: string[];
    currentVersion: string;
  };
  offline: {
    fallbackPage: boolean;
    e2ePassed: boolean;
    queue: boolean;
  };
  install: {
    platform: 'chromium' | 'ios' | 'other';
    promptEvent: boolean;
    standalone: boolean;
    iosGuide: boolean;
  };
  push: {
    enabled: boolean;
    permission: 'granted' | 'denied' | 'default';
    subscription: boolean;
    vapid: boolean;
  };
  debug: {
    devtoolsChecked: boolean;
    updateRegression: boolean;
    lighthouseVersion: number;
    lighthouseScore?: number;
  };
}

interface Evaluation {
  checks: CheckResult[];
  score: number;
  decision: Decision;
  blockers: CheckResult[];
  warnings: CheckResult[];
}

function hasIcon(icons: Array<{ sizes: string; purpose?: string }>, size: string, purpose: string): boolean {
  return icons.some((icon) => {
    const sizes = icon.sizes.split(/\s+/);
    const purposes = (icon.purpose ?? 'any').split(/\s+/);
    return sizes.includes(size) && purposes.includes(purpose);
  });
}

function check(
  id: string,
  category: Category,
  status: CheckStatus,
  weight: number,
  detail: string,
): CheckResult {
  return { id, category, status, weight, detail };
}

function evaluate(report: PwaReport): Evaluation {
  const checks: CheckResult[] = [];

  checks.push(
    check(
      'manifest-name',
      'manifest',
      report.manifest.name ? 'pass' : 'fail',
      10,
      report.manifest.name ? `name=${report.manifest.name}` : '缺少 name，安装入口无名称',
    ),
  );
  checks.push(
    check(
      'manifest-start-url',
      'manifest',
      report.manifest.start_url ? 'pass' : 'fail',
      10,
      report.manifest.start_url ? `start_url=${report.manifest.start_url}` : '缺少 start_url',
    ),
  );
  checks.push(
    check(
      'manifest-display',
      'manifest',
      report.manifest.display ? 'pass' : 'fail',
      5,
      report.manifest.display ? `display=${report.manifest.display}` : '缺少 display，无法独立窗口启动',
    ),
  );
  checks.push(
    check(
      'manifest-icon-192',
      'manifest',
      hasIcon(report.manifest.icons, '192x192', 'any') ? 'pass' : 'fail',
      10,
      hasIcon(report.manifest.icons, '192x192', 'any') ? '存在 192x192 any 图标' : '缺少 192x192 any 图标',
    ),
  );
  checks.push(
    check(
      'manifest-icon-512',
      'manifest',
      hasIcon(report.manifest.icons, '512x512', 'any') ? 'pass' : 'fail',
      10,
      hasIcon(report.manifest.icons, '512x512', 'any') ? '存在 512x512 any 图标' : '缺少 512x512 any 图标',
    ),
  );
  checks.push(
    check(
      'manifest-id',
      'manifest',
      report.manifest.id ? 'pass' : 'warn',
      2,
      report.manifest.id ? `id=${report.manifest.id}` : '缺少稳定 id，改 start_url 会变成新应用',
    ),
  );
  checks.push(
    check(
      'manifest-maskable',
      'manifest',
      hasIcon(report.manifest.icons, '512x512', 'maskable') ? 'pass' : 'warn',
      3,
      hasIcon(report.manifest.icons, '512x512', 'maskable') ? '存在 512x512 maskable 图标' : '缺少 maskable 图标',
    ),
  );
  checks.push(
    check(
      'manifest-screenshots',
      'manifest',
      report.manifest.screenshots ? 'pass' : 'warn',
      2,
      report.manifest.screenshots ? '存在富安装截图' : '缺少 screenshots，富安装 UI 无预览',
    ),
  );

  checks.push(
    check(
      'sw-registered',
      'service-worker',
      report.sw.registered ? 'pass' : 'fail',
      15,
      report.sw.registered ? 'SW 已注册' : '未注册 SW，离线与推送都无从谈起',
    ),
  );
  checks.push(
    check(
      'sw-controller',
      'service-worker',
      report.sw.controller ? 'pass' : 'warn',
      3,
      report.sw.controller ? '当前页面已被 SW 控制' : '当前页面未被控制，首屏尚未获得离线能力',
    ),
  );
  checks.push(
    check(
      'sw-fetch-handler',
      'service-worker',
      report.sw.fetchHandler ? 'pass' : 'warn',
      4,
      report.sw.fetchHandler
        ? '存在 fetch 处理，可拦截导航与资源'
        : '无 fetch 处理：Chrome 108/112 起菜单安装不再强制，但安装提示仍需要',
    ),
  );
  checks.push(
    check(
      'sw-update-via-cache',
      'service-worker',
      report.sw.updateViaCache === 'none' ? 'pass' : 'warn',
      2,
      report.sw.updateViaCache === 'none' ? 'updateViaCache=none' : 'updateViaCache 未设为 none，SW 脚本可能被 HTTP 缓存拖住',
    ),
  );
  checks.push(
    check(
      'sw-waiting',
      'service-worker',
      report.sw.waiting ? 'warn' : 'pass',
      3,
      report.sw.waiting ? '存在 waiting 新版本，需确认更新提示可触达' : '没有 waiting 新版本',
    ),
  );

  checks.push(
    check(
      'cache-empty',
      'cache',
      report.caches.names.length > 0 ? 'pass' : 'fail',
      8,
      report.caches.names.length > 0 ? `缓存 ${report.caches.names.length} 个` : 'Cache Storage 为空',
    ),
  );
  const staleCaches = report.caches.names.filter((name) => {
    const matched = /-v(\d+)$/.exec(name);
    return matched ? `v${matched[1]}` !== report.caches.currentVersion : false;
  });
  checks.push(
    check(
      'cache-version',
      'cache',
      staleCaches.length === 0 ? 'pass' : 'warn',
      3,
      staleCaches.length === 0 ? `缓存版本 ${report.caches.currentVersion}` : `残留旧版本缓存：${staleCaches.join(', ')}`,
    ),
  );

  checks.push(
    check(
      'offline-fallback',
      'offline',
      report.offline.fallbackPage ? 'pass' : 'fail',
      10,
      report.offline.fallbackPage ? '存在离线兜底页' : '缺少离线兜底页，断网导航会白屏',
    ),
  );
  checks.push(
    check(
      'offline-e2e',
      'offline',
      report.offline.e2ePassed ? 'pass' : 'fail',
      15,
      report.offline.e2ePassed ? '断网 E2E 已通过' : '断网 E2E 未通过，不能仅凭手工感觉上线',
    ),
  );
  checks.push(
    check(
      'offline-queue',
      'offline',
      report.offline.queue ? 'pass' : 'warn',
      3,
      report.offline.queue ? '存在离线写队列' : '没有离线写队列，弱网提交会直接丢失',
    ),
  );

  if (report.install.platform === 'ios') {
    checks.push(
      check(
        'install-ios-guide',
        'install',
        report.install.iosGuide ? 'pass' : 'warn',
        3,
        report.install.iosGuide ? 'iOS 分享引导已配置' : 'iOS 没有 beforeinstallprompt，缺少分享引导会失去 A2HS 入口',
      ),
    );
    checks.push(
      check('install-prompt', 'install', 'skip', 3, 'iOS Safari 不支持 beforeinstallprompt，跳过原生安装弹窗检查'),
    );
  } else if (report.install.platform === 'chromium') {
    checks.push(
      check(
        'install-prompt',
        'install',
        report.install.promptEvent ? 'pass' : 'warn',
        3,
        report.install.promptEvent ? '已捕获 beforeinstallprompt' : '未捕获 beforeinstallprompt，无法自定义安装入口',
      ),
    );
  } else {
    checks.push(check('install-prompt', 'install', 'skip', 3, '非目标平台，跳过安装弹窗检查'));
  }
  checks.push(
    check(
      'install-standalone',
      'install',
      report.install.standalone ? 'pass' : 'warn',
      2,
      report.install.standalone ? '以 standalone 启动' : '当前是浏览器标签页，安装体验尚未验证',
    ),
  );

  if (!report.push.enabled) {
    checks.push(check('push-setup', 'push', 'skip', 5, '本项目未启用推送，跳过推送闭环检查'));
  } else if (report.push.permission !== 'granted') {
    checks.push(
      check(
        'push-permission',
        'push',
        'warn',
        3,
        report.push.permission === 'denied'
          ? '通知权限被拒绝，需展示设置引导而不是反复弹权限框'
          : '通知权限仍为 default，需在用户价值时刻再请求',
      ),
    );
    checks.push(
      check(
        'push-subscription',
        'push',
        report.push.subscription && report.push.vapid ? 'pass' : 'warn',
        2,
        report.push.subscription && report.push.vapid ? '订阅与 VAPID 已就绪' : '订阅或 VAPID 配置缺失',
      ),
    );
  } else {
    checks.push(
      check(
        'push-subscription',
        'push',
        report.push.subscription && report.push.vapid ? 'pass' : 'warn',
        5,
        report.push.subscription && report.push.vapid ? '订阅、VAPID、权限均就绪' : '权限已授予，但订阅或 VAPID 缺失',
      ),
    );
  }

  checks.push(
    check(
      'debug-devtools',
      'debug',
      report.debug.devtoolsChecked ? 'pass' : 'warn',
      3,
      report.debug.devtoolsChecked ? 'Application 面板已核对' : '未核对 DevTools Application 面板',
    ),
  );
  checks.push(
    check(
      'debug-update-regression',
      'debug',
      report.debug.updateRegression ? 'pass' : 'fail',
      5,
      report.debug.updateRegression ? '版本更新回归已执行' : '未执行版本更新回归，可能上线后卡在旧缓存',
    ),
  );
  if (report.debug.lighthouseVersion >= 12) {
    checks.push(
      check(
        'debug-lighthouse',
        'debug',
        'skip',
        3,
        `Lighthouse ${report.debug.lighthouseVersion} 已移除 PWA 分类，改用 DevTools Manifest 与自定义断言`,
      ),
    );
  } else {
    const score = report.debug.lighthouseScore ?? 0;
    checks.push(
      check(
        'debug-lighthouse',
        'debug',
        score >= 90 ? 'pass' : 'warn',
        3,
        `Lighthouse ${report.debug.lighthouseVersion} PWA 得分 ${score}`,
      ),
    );
  }

  const scored = checks.filter((item) => item.status !== 'skip');
  const totalWeight = scored.reduce((sum, item) => sum + item.weight, 0);
  const earnedWeight = scored.reduce((sum, item) => {
    if (item.status === 'pass') return sum + item.weight;
    if (item.status === 'warn') return sum + item.weight * 0.6;
    return sum;
  }, 0);
  const score = totalWeight === 0 ? 100 : Math.round((earnedWeight / totalWeight) * 100);
  const blockers = checks.filter((item) => item.status === 'fail');
  const warnings = checks.filter((item) => item.status === 'warn');
  const decision: Decision = blockers.length > 0 ? 'hold' : warnings.length > 0 ? 'ship-with-warnings' : 'ship';

  return { checks, score, decision, blockers, warnings };
}

const GOOD_REPORT: PwaReport = {
  manifest: {
    name: '前端进阶指南',
    start_url: '/?source=pwa',
    display: 'standalone',
    id: '/?source=pwa',
    screenshots: true,
    icons: [
      { sizes: '192x192', purpose: 'any' },
      { sizes: '512x512', purpose: 'any' },
      { sizes: '512x512', purpose: 'maskable' },
    ],
  },
  sw: { registered: true, controller: true, fetchHandler: true, updateViaCache: 'none', waiting: false },
  caches: { names: ['fag-pages-v3', 'fag-assets-v3'], currentVersion: 'v3' },
  offline: { fallbackPage: true, e2ePassed: true, queue: true },
  install: { platform: 'chromium', promptEvent: true, standalone: true, iosGuide: false },
  push: { enabled: true, permission: 'granted', subscription: true, vapid: true },
  debug: { devtoolsChecked: true, updateRegression: true, lighthouseVersion: 13 },
};

const good = evaluate(GOOD_REPORT);
assert.strictEqual(good.decision, 'ship');
assert.strictEqual(good.score, 100);
assert.strictEqual(good.blockers.length, 0);
assert.strictEqual(good.warnings.length, 0);
assert.strictEqual(good.checks.find((item) => item.id === 'debug-lighthouse')?.status, 'skip');

const BAD_REPORT: PwaReport = {
  manifest: { screenshots: false, icons: [] },
  sw: { registered: false, controller: false, fetchHandler: false, waiting: true },
  caches: { names: [], currentVersion: 'v3' },
  offline: { fallbackPage: false, e2ePassed: false, queue: false },
  install: { platform: 'chromium', promptEvent: false, standalone: false, iosGuide: false },
  push: { enabled: true, permission: 'denied', subscription: false, vapid: false },
  debug: { devtoolsChecked: false, updateRegression: false, lighthouseVersion: 13 },
};
const bad = evaluate(BAD_REPORT);
assert.strictEqual(bad.decision, 'hold');
const blockerIds = bad.blockers.map((item) => item.id).sort();
for (const expected of [
  'manifest-name',
  'manifest-start-url',
  'manifest-display',
  'manifest-icon-192',
  'manifest-icon-512',
  'sw-registered',
  'cache-empty',
  'offline-fallback',
  'offline-e2e',
  'debug-update-regression',
]) {
  assert.ok(blockerIds.includes(expected), `应阻断：${expected}`);
}
assert.ok(bad.score < 20, '阻断报告的分数应显著降低');

const WARN_REPORT: PwaReport = {
  ...GOOD_REPORT,
  manifest: {
    name: 'Warn',
    start_url: '/',
    display: 'standalone',
    screenshots: false,
    icons: [
      { sizes: '192x192', purpose: 'any' },
      { sizes: '512x512', purpose: 'any' },
    ],
  },
  sw: { registered: true, controller: true, fetchHandler: true, updateViaCache: 'normal', waiting: true },
  caches: { names: ['fag-pages-v2', 'fag-pages-v3'], currentVersion: 'v3' },
  offline: { fallbackPage: true, e2ePassed: true, queue: false },
  install: { platform: 'chromium', promptEvent: false, standalone: true, iosGuide: false },
  push: { enabled: false, permission: 'default', subscription: false, vapid: false },
  debug: { devtoolsChecked: true, updateRegression: true, lighthouseVersion: 11, lighthouseScore: 85 },
};
const warned = evaluate(WARN_REPORT);
assert.strictEqual(warned.decision, 'ship-with-warnings');
assert.strictEqual(warned.blockers.length, 0);
assert.ok(warned.warnings.length >= 6, '告警报告应覆盖多个非阻断项');
assert.strictEqual(warned.checks.find((item) => item.id === 'push-setup')?.status, 'skip');
assert.strictEqual(warned.checks.find((item) => item.id === 'manifest-maskable')?.status, 'warn');
assert.strictEqual(warned.checks.find((item) => item.id === 'cache-version')?.status, 'warn');
assert.strictEqual(warned.checks.find((item) => item.id === 'debug-lighthouse')?.status, 'warn');

const IOS_REPORT: PwaReport = {
  ...GOOD_REPORT,
  install: { platform: 'ios', promptEvent: false, standalone: true, iosGuide: true },
  push: { enabled: false, permission: 'denied', subscription: false, vapid: false },
};
const ios = evaluate(IOS_REPORT);
assert.strictEqual(ios.decision, 'ship');
assert.strictEqual(ios.checks.find((item) => item.id === 'install-ios-guide')?.status, 'pass');
assert.strictEqual(ios.checks.find((item) => item.id === 'install-prompt')?.status, 'skip');

const LIGHTHOUSE_12: PwaReport = {
  ...GOOD_REPORT,
  debug: { devtoolsChecked: true, updateRegression: true, lighthouseVersion: 12 },
};
const lh12 = evaluate(LIGHTHOUSE_12);
assert.strictEqual(lh12.checks.find((item) => item.id === 'debug-lighthouse')?.status, 'skip');
assert.strictEqual(lh12.decision, 'ship');

const PUSH_DISABLED: PwaReport = {
  ...GOOD_REPORT,
  push: { enabled: false, permission: 'denied', subscription: false, vapid: false },
};
const noPush = evaluate(PUSH_DISABLED);
assert.strictEqual(noPush.checks.find((item) => item.id === 'push-setup')?.status, 'skip');
assert.strictEqual(noPush.decision, 'ship');

console.log('126-06 PWA 验收清单引擎：全部断言通过');
console.log(`  合格：score=${good.score} / ${good.decision}（fail ${good.blockers.length} / warn ${good.warnings.length}）`);
console.log(`  阻断：score=${bad.score} / ${bad.decision}（${bad.blockers.length} 个阻断项）`);
console.log(`  告警：score=${warned.score} / ${warned.decision}（${warned.warnings.length} 个告警项）`);
console.log('  Lighthouse 12+：PWA 分类跳过，不再作为评分门槛；iOS：分享引导通过、原生弹窗跳过');
