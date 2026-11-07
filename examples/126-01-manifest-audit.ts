// 文件: examples/126-01-manifest-audit.ts
// Web App Manifest 审计器：字段完整性、start_url/scope 同源与包含关系、图标矩阵、maskable 提示、颜色与截图规范。
// 目标：把「manifest 写了」升级为「manifest 可安装，且能被安装 UI 正确消费」；错误与警告分层输出。
// 运行：npx tsx examples/126-01-manifest-audit.ts

import assert from 'node:assert';

type Purpose = 'any' | 'maskable' | 'monochrome';

interface ManifestIcon {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
}

interface ManifestScreenshot {
  src: string;
  sizes: string;
  type?: string;
  form_factor?: string;
}

interface ManifestShortcut {
  name: string;
  short_name?: string;
  url: string;
  icons?: ManifestIcon[];
}

interface ShareTarget {
  action: string;
  method?: 'GET' | 'POST';
  enctype?: string;
  params?: Record<string, string>;
}

interface WebAppManifest {
  id?: string;
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  display_override?: string[];
  orientation?: string;
  theme_color?: string;
  background_color?: string;
  lang?: string;
  dir?: string;
  categories?: string[];
  icons?: ManifestIcon[];
  screenshots?: ManifestScreenshot[];
  shortcuts?: ManifestShortcut[];
  share_target?: ShareTarget;
  related_applications?: Array<{ platform: string; url: string; id?: string }>;
  prefer_related_applications?: boolean;
}

interface Issue {
  code: string;
  message: string;
}

interface AuditResult {
  errors: Issue[];
  warnings: Issue[];
}

interface AuditOptions {
  manifestUrl: string;
  origin: string;
}

const DISPLAY_MODES = ['fullscreen', 'standalone', 'minimal-ui', 'browser'];
const DISPLAY_OVERRIDES = ['window-controls-overlay', 'standalone', 'minimal-ui', 'fullscreen', 'browser'];
const ORIENTATIONS = [
  'any',
  'natural',
  'portrait',
  'portrait-primary',
  'portrait-secondary',
  'landscape',
  'landscape-primary',
  'landscape-secondary',
];
const DIRS = ['ltr', 'rtl', 'auto'];
const COLOR_RE = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\([^)]+\))$/i;

function resolveUrl(value: string, base: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function parseSizes(sizes: string): Array<{ width: number; height: number } | 'any'> {
  if (sizes.trim() === 'any') return ['any'];
  return sizes
    .trim()
    .split(/\s+/)
    .map((item) => {
      const matched = /^(\d+)x(\d+)$/.exec(item);
      if (!matched) throw new Error(`无法解析图标尺寸：${item}`);
      return { width: Number(matched[1]), height: Number(matched[2]) };
    });
}

function isSameOrigin(url: URL, origin: string): boolean {
  return url.origin === origin;
}

function isInsideScope(targetPath: string, scopePath: string): boolean {
  const normalizedScope = scopePath.replace(/\/$/, '');
  const normalizedTarget = targetPath.replace(/\/$/, '');
  return normalizedScope === '' || normalizedTarget === normalizedScope || normalizedTarget.startsWith(`${normalizedScope}/`);
}

function auditManifest(manifest: WebAppManifest, options: AuditOptions): AuditResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const fail = (code: string, message: string): void => {
    errors.push({ code, message });
  };
  const warn = (code: string, message: string): void => {
    warnings.push({ code, message });
  };

  if (!manifest.name) fail('E_NAME', '缺少 name，安装入口没有可读名称');
  if (!manifest.short_name) {
    warn('W_SHORT_NAME', '缺少 short_name，主屏图标下方可能显示被截断的完整名称');
  } else if (manifest.short_name.length > 12) {
    warn('W_SHORT_NAME_LONG', 'short_name 超过 12 个字符，安装 UI 可能截断');
  }

  const rawStartUrl = manifest.start_url;
  if (!rawStartUrl) {
    fail('E_START_URL', '缺少 start_url，浏览器无法确定安装后的启动地址');
  }
  const startUrl = rawStartUrl ? resolveUrl(rawStartUrl, options.manifestUrl) : null;
  if (rawStartUrl && !startUrl) {
    fail('E_START_URL_INVALID', `start_url 不是合法 URL：${rawStartUrl}`);
  }
  if (startUrl && !isSameOrigin(startUrl, options.origin)) {
    fail('E_START_ORIGIN', 'start_url 必须与站点同源，跨源 start_url 会被浏览器拒绝');
  }

  const rawScope = manifest.scope;
  const scopeUrl = rawScope ? resolveUrl(rawScope, options.manifestUrl) : startUrl;
  if (rawScope && !scopeUrl) {
    fail('E_SCOPE_INVALID', `scope 不是合法 URL：${rawScope}`);
  }
  if (scopeUrl && !isSameOrigin(scopeUrl, options.origin)) {
    fail('E_SCOPE_ORIGIN', 'scope 必须与站点同源');
  }
  if (startUrl && scopeUrl && !isInsideScope(startUrl.pathname, scopeUrl.pathname)) {
    fail('E_START_OUTSIDE_SCOPE', 'start_url 必须落在 scope 内，否则安装后会被判定为外部导航');
  }

  if (manifest.id) {
    const idUrl = resolveUrl(manifest.id, options.manifestUrl);
    if (!idUrl) {
      fail('E_ID_INVALID', `id 不是合法 URL：${manifest.id}`);
    } else if (!isSameOrigin(idUrl, options.origin)) {
      warn('W_ID_ORIGIN', '建议 id 与站点同源，跨源 id 会削弱应用身份稳定性');
    }
  } else {
    warn('W_ID', '缺少 id，浏览器将回退到 start_url；改版 start_url 会变成「另一个应用」');
  }

  if (!manifest.display) {
    fail('E_DISPLAY', '缺少 display，无法进入独立窗口安装流程');
  } else if (!DISPLAY_MODES.includes(manifest.display)) {
    fail('E_DISPLAY_INVALID', `display 取值非法：${manifest.display}`);
  }

  if (manifest.display_override) {
    for (const mode of manifest.display_override) {
      if (!DISPLAY_OVERRIDES.includes(mode)) {
        warn('W_DISPLAY_OVERRIDE_INVALID', `display_override 含未知取值：${mode}`);
      }
    }
  }

  if (manifest.orientation && !ORIENTATIONS.includes(manifest.orientation)) {
    fail('E_ORIENTATION', `orientation 取值非法：${manifest.orientation}`);
  }
  if (manifest.dir && !DIRS.includes(manifest.dir)) {
    fail('E_DIR', `dir 取值非法：${manifest.dir}`);
  }
  if (manifest.lang && !/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(manifest.lang)) {
    warn('W_LANG', `lang 不是常见的 BCP 47 写法：${manifest.lang}`);
  }
  if (manifest.theme_color && !COLOR_RE.test(manifest.theme_color)) {
    fail('E_THEME_COLOR', `theme_color 不是合法 CSS 颜色：${manifest.theme_color}`);
  }
  if (manifest.background_color && !COLOR_RE.test(manifest.background_color)) {
    fail('E_BACKGROUND_COLOR', `background_color 不是合法 CSS 颜色：${manifest.background_color}`);
  }

  const icons = manifest.icons ?? [];
  let hasAny192 = false;
  let hasAny512 = false;
  let hasMaskable = false;
  const iconOrigins = new Set<string>();

  icons.forEach((icon, index) => {
    if (!icon.src) {
      fail('E_ICON_SRC', `第 ${index + 1} 个图标缺少 src`);
      return;
    }
    const iconUrl = resolveUrl(icon.src, options.manifestUrl);
    if (!iconUrl) {
      fail('E_ICON_URL', `图标 src 不是合法 URL：${icon.src}`);
    } else {
      iconOrigins.add(iconUrl.origin);
      if (!isSameOrigin(iconUrl, options.origin)) {
        warn('W_ICON_CROSS_ORIGIN', `图标跨源，需确认 CORS 与缓存头：${icon.src}`);
      }
    }

    let sizes: Array<{ width: number; height: number } | 'any'>;
    try {
      sizes = parseSizes(icon.sizes);
    } catch {
      fail('E_ICON_SIZE', `图标 sizes 无法解析：${icon.sizes}`);
      return;
    }
    if (sizes.includes('any') && icon.type !== 'image/svg+xml') {
      fail('E_ICON_SVG_ANY', 'sizes="any" 只适用于 SVG；PNG/WebP 必须写具体像素尺寸');
    }

    const purposes = (icon.purpose ?? 'any').split(/\s+/) as Purpose[];
    if (purposes.includes('any') && purposes.includes('maskable')) {
      warn('W_ICON_PURPOSE_COMBINED', `建议把 any 与 maskable 拆成两个图标条目：${icon.src}`);
    }
    if (purposes.includes('maskable')) {
      hasMaskable = true;
      const hasLargeMaskable = sizes.some((size) => size !== 'any' && size.width >= 512 && size.height >= 512);
      if (!hasLargeMaskable) {
        warn('W_MASKABLE_SIZE', 'maskable 图标建议至少 512x512，并保留中心 80% 安全区');
      }
    }
    if (purposes.includes('any')) {
      if (sizes.some((size) => size !== 'any' && size.width === 192 && size.height === 192)) hasAny192 = true;
      if (sizes.some((size) => size !== 'any' && size.width === 512 && size.height === 512)) hasAny512 = true;
    }
  });

  if (!hasAny192) fail('E_ICON_192', '缺少 192x192 的 any 图标，部分安装入口不会出现');
  if (!hasAny512) fail('E_ICON_512', '缺少 512x512 的 any 图标，安装弹窗与商店物料会缺失');
  if (!hasMaskable) warn('W_MASKABLE', '没有 maskable 图标，Android 自适应图标可能被裁切或加白底');
  if (icons.length > 0 && !icons.some((icon) => icon.type)) {
    warn('W_ICON_TYPE', '建议为图标声明 type，避免浏览器探测 MIME 失败');
  }

  const screenshots = manifest.screenshots;
  if (!screenshots || screenshots.length === 0) {
    warn('W_SCREENSHOTS', '没有 screenshots，Chrome Android 的富安装 UI 无法展示应用预览');
  } else {
    for (const shot of screenshots) {
      try {
        parseSizes(shot.sizes);
      } catch {
        fail('E_SCREENSHOT_SIZE', `截图 sizes 无法解析：${shot.sizes}`);
      }
      if (!shot.form_factor) {
        warn('W_SCREENSHOT_FORM_FACTOR', `截图缺少 form_factor：${shot.src}`);
      } else if (!['wide', 'narrow'].includes(shot.form_factor)) {
        fail('E_SCREENSHOT_FORM_FACTOR', `screenshot form_factor 只能是 wide/narrow：${shot.form_factor}`);
      }
      if (!shot.type) warn('W_SCREENSHOT_TYPE', `截图缺少 type：${shot.src}`);
    }
  }

  if (manifest.shortcuts) {
    if (manifest.shortcuts.length > 4) {
      warn('W_SHORTCUT_COUNT', '快捷方式超过 4 个，桌面/安卓长按菜单通常只展示前 4 个');
    }
    for (const shortcut of manifest.shortcuts) {
      if (!shortcut.name) fail('E_SHORTCUT_NAME', '快捷方式缺少 name');
      const shortcutUrl = resolveUrl(shortcut.url, options.manifestUrl);
      if (!shortcutUrl) {
        fail('E_SHORTCUT_URL', `快捷方式 url 非法：${shortcut.url}`);
      } else {
        if (!isSameOrigin(shortcutUrl, options.origin)) fail('E_SHORTCUT_ORIGIN', '快捷方式必须同源');
        if (scopeUrl && !isInsideScope(shortcutUrl.pathname, scopeUrl.pathname)) {
          fail('E_SHORTCUT_SCOPE', `快捷方式越过 scope：${shortcut.url}`);
        }
      }
    }
  }

  if (manifest.share_target) {
    const target = manifest.share_target;
    const actionUrl = resolveUrl(target.action, options.manifestUrl);
    if (!actionUrl) {
      fail('E_SHARE_ACTION', `share_target.action 非法：${target.action}`);
    } else {
      if (!isSameOrigin(actionUrl, options.origin)) fail('E_SHARE_ORIGIN', 'share_target.action 必须同源');
      if (scopeUrl && !isInsideScope(actionUrl.pathname, scopeUrl.pathname)) {
        fail('E_SHARE_SCOPE', 'share_target.action 必须落在 scope 内');
      }
    }
    const method = target.method ?? 'GET';
    if (!['GET', 'POST'].includes(method)) {
      fail('E_SHARE_METHOD', `share_target.method 只能是 GET/POST：${method}`);
    }
    if (method === 'POST' && !target.enctype) {
      fail('E_SHARE_ENCTYPE', 'POST 分享必须声明 enctype');
    }
    if (target.enctype && !['multipart/form-data', 'application/x-www-form-urlencoded'].includes(target.enctype)) {
      fail('E_SHARE_ENCTYPE_VALUE', `share_target.enctype 非法：${target.enctype}`);
    }
    if (target.params && Object.keys(target.params).length === 0) {
      warn('W_SHARE_PARAMS_EMPTY', 'share_target.params 为空，接收端拿不到分享内容');
    }
  }

  const related = manifest.related_applications ?? [];
  if (manifest.prefer_related_applications === true && related.length === 0) {
    fail('E_RELATED_APPS', 'prefer_related_applications=true 时 related_applications 不能为空');
  }
  for (const app of related) {
    if (!app.platform || !app.url) fail('E_RELATED_APP_FIELDS', 'related_applications 条目需要 platform 与 url');
  }

  return { errors, warnings };
}

function codes(items: Issue[]): string[] {
  return [...new Set(items.map((item) => item.code))].sort();
}

const MANIFEST_URL = 'https://app.example.com/manifest.webmanifest';
const ORIGIN = 'https://app.example.com';

const GOOD_MANIFEST: WebAppManifest = {
  id: '/?source=pwa',
  name: '前端进阶指南',
  short_name: '前端指南',
  start_url: '/?source=pwa',
  scope: '/',
  display: 'standalone',
  display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
  orientation: 'any',
  theme_color: '#0f172a',
  background_color: '#0f172a',
  lang: 'zh-CN',
  dir: 'ltr',
  categories: ['education', 'books'],
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  screenshots: [
    { src: '/screenshots/wide.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide' },
    { src: '/screenshots/narrow.png', sizes: '720x1280', type: 'image/png', form_factor: 'narrow' },
  ],
  shortcuts: [
    { name: '最近阅读', url: '/recent' },
    { name: '知识地图', url: '/knowledge-map' },
  ],
  share_target: {
    action: '/share',
    method: 'GET',
    params: { title: 'title', text: 'text', url: 'url' },
  },
  related_applications: [],
  prefer_related_applications: false,
};

const goodResult = auditManifest(GOOD_MANIFEST, { manifestUrl: MANIFEST_URL, origin: ORIGIN });
assert.deepStrictEqual(goodResult.errors, [], '合格 manifest 不应产生错误');
assert.deepStrictEqual(goodResult.warnings, [], '合格 manifest 不应产生警告');

const MINIMAL_MANIFEST: WebAppManifest = {
  name: 'Minimal',
  start_url: '/',
  display: 'standalone',
  icons: [
    { src: '/icons/192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
};
const minimalResult = auditManifest(MINIMAL_MANIFEST, { manifestUrl: MANIFEST_URL, origin: ORIGIN });
assert.deepStrictEqual(minimalResult.errors, [], '最小可安装集不应产生错误');
assert.deepStrictEqual(
  codes(minimalResult.warnings),
  ['W_ID', 'W_MASKABLE', 'W_SCREENSHOTS', 'W_SHORT_NAME'].sort(),
  '最小集应只提示 id/short_name/maskable/screenshots 缺失',
);

const BAD_MANIFEST: WebAppManifest = {
  short_name: '这是一个非常非常长的应用短名称会被安装界面截断',
  start_url: 'https://evil.example/app',
  scope: 'https://evil.example/',
  display: 'floating',
  orientation: 'diagonal',
  theme_color: '#12',
  background_color: '#12',
  icons: [{ src: '/icons/logo.png', sizes: 'any', type: 'image/png', purpose: 'any maskable' }],
  screenshots: [{ src: '/screenshots/a.png', sizes: '100x100', form_factor: 'square' }],
  shortcuts: [{ name: '', url: 'https://evil.example/s' }],
  share_target: { action: 'https://evil.example/share', method: 'POST', enctype: 'text/plain', params: {} },
  prefer_related_applications: true,
};
const badResult = auditManifest(BAD_MANIFEST, { manifestUrl: MANIFEST_URL, origin: ORIGIN });
const badCodes = codes(badResult.errors);
for (const expected of [
  'E_NAME',
  'E_START_ORIGIN',
  'E_SCOPE_ORIGIN',
  'E_DISPLAY_INVALID',
  'E_ORIENTATION',
  'E_THEME_COLOR',
  'E_BACKGROUND_COLOR',
  'E_ICON_192',
  'E_ICON_512',
  'E_ICON_SVG_ANY',
  'E_SCREENSHOT_FORM_FACTOR',
  'E_SHORTCUT_NAME',
  'E_SHORTCUT_ORIGIN',
  'E_SHARE_ORIGIN',
  'E_SHARE_ENCTYPE_VALUE',
  'E_RELATED_APPS',
]) {
  assert.ok(badCodes.includes(expected), `应命中错误码 ${expected}`);
}
assert.ok(badResult.errors.length >= 16, '坏 manifest 应产生足够多的阻断错误');
assert.ok(codes(badResult.warnings).includes('W_ICON_PURPOSE_COMBINED'), '应提示 any/maskable 未拆分');
assert.ok(codes(badResult.warnings).includes('W_SHORT_NAME_LONG'), '应提示 short_name 过长');
assert.ok(codes(badResult.warnings).includes('W_MASKABLE_SIZE'), '应提示 maskable 尺寸不足 512');

const SCOPE_MANIFEST: WebAppManifest = {
  name: 'Scope',
  start_url: '/outside',
  scope: '/app/',
  display: 'standalone',
  icons: [
    { src: '/icons/192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  screenshots: [{ src: '/screenshots/wide.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide' }],
  id: '/app/',
};
const scopeResult = auditManifest(SCOPE_MANIFEST, { manifestUrl: MANIFEST_URL, origin: ORIGIN });
assert.ok(codes(scopeResult.errors).includes('E_START_OUTSIDE_SCOPE'), 'start_url 越出 scope 应报错');

const SVG_MANIFEST: WebAppManifest = {
  ...MINIMAL_MANIFEST,
  id: '/',
  short_name: 'Mini',
  screenshots: [{ src: '/screenshots/wide.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide' }],
  icons: [
    { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: '/icons/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
const svgResult = auditManifest(SVG_MANIFEST, { manifestUrl: MANIFEST_URL, origin: ORIGIN });
assert.ok(codes(svgResult.errors).includes('E_ICON_192'), 'SVG any 不能替代 192 PNG');
assert.ok(!codes(svgResult.errors).includes('E_ICON_SVG_ANY'), 'SVG 使用 sizes=any 不应报错');

console.log('126-01 manifest 审计：全部断言通过');
console.log(`  合格 manifest：${goodResult.errors.length} errors / ${goodResult.warnings.length} warnings`);
console.log(`  最小 manifest：${minimalResult.errors.length} errors / ${minimalResult.warnings.length} warnings`);
console.log(`  坏 manifest：${badResult.errors.length} errors / ${badResult.warnings.length} warnings`);
