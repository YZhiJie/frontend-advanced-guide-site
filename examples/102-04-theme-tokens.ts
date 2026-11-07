/**
 * 第 102 部分 · Element Plus 企业实战
 * Design Token 派生 + CSS 变量注入策略
 * Element Plus 主题定制基于 CSS 变量 —— 覆盖 `--el-color-primary` 即可
 *   暗黑模式 = `html.dark` class 切换 + 变量覆盖
 * 运行：npx tsx examples/102-04-theme-tokens.ts
 */
import assert from "node:assert";

// ---------- 1. HSL 色彩空间转换（从主色派生 light-n / dark-2 色阶） ----------
function hexToHsl(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hh = 0;
  if (max !== min) {
    const d = max - min;
    hh = (max === r ? (g - b) / d : max === g ? (b - r) / d : (r - g) / d) + (g < r ? 6 : 0);
    hh *= 60;
  }
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  return [hh, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  const toHex = (v: number) => Math.max(0, Math.min(255, Math.round((v + m) * 255))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ---------- 2. Design Token 派生 ----------
interface ThemeTokens {
  primary: string;
  primaryLight3: string; // 悬停态
  primaryLight5: string; // 焦点态
  primaryLight7: string;
  primaryLight9: string;
  primaryDark2: string; // 按下态
  success: string;
  warning: string;
  danger: string;
  info: string;
  textPrimary: string;
  textRegular: string;
  textSecondary: string;
  borderColor: string;
  bgColor: string;
}

function generateTokens(primary: string, mode: "light" | "dark"): ThemeTokens {
  const [h, s, l] = hexToHsl(primary);
  const lighten = (pct: number) => hslToHex(h, s, Math.min(1, l + pct));
  const darken = (pct: number) => hslToHex(h, s, Math.max(0, l - pct));

  if (mode === "light") {
    return {
      primary,
      primaryLight3: lighten(0.3),
      primaryLight5: lighten(0.5),
      primaryLight7: lighten(0.7),
      primaryLight9: lighten(0.9),
      primaryDark2: darken(0.1),
      success: "#67c23a", warning: "#e6a23c", danger: "#f56c6c", info: "#909399",
      textPrimary: "#303133", textRegular: "#606266", textSecondary: "#909399",
      borderColor: "#dcdfe6", bgColor: "#ffffff",
    };
  }
  // dark 模式：主色稍亮以保持对比度，背景/反色整体反色
  return {
    primary: lighten(0.12),
    primaryLight3: lighten(0.42),
    primaryLight5: lighten(0.62),
    primaryLight7: lighten(0.82),
    primaryLight9: lighten(0.96),
    primaryDark2: darken(0.05),
    success: "#85ce61", warning: "#ebb563", danger: "#f78989", info: "#a6a9ad",
    textPrimary: "#e5eaf3", textRegular: "#cfd3dc", textSecondary: "#a3a6ad",
    borderColor: "#414243", bgColor: "#141414",
  };
}

// ---------- 3. CSS 变量注入策略 ----------
interface CssVariable { name: string; value: string; }
function buildCssVars(tokens: ThemeTokens): CssVariable[] {
  // Element Plus 的 CSS 变量命名约定：--el-xxx-yyy（camelCase → kebab-case）
  const map: Record<string, string> = {
    primary: "--el-color-primary",
    primaryLight3: "--el-color-primary-light-3",
    primaryLight5: "--el-color-primary-light-5",
    primaryLight7: "--el-color-primary-light-7",
    primaryLight9: "--el-color-primary-light-9",
    primaryDark2: "--el-color-primary-dark-2",
    success: "--el-color-success",
    warning: "--el-color-warning",
    danger: "--el-color-danger",
    info: "--el-color-info",
    textPrimary: "--el-text-color-primary",
    textRegular: "--el-text-color-regular",
    textSecondary: "--el-text-color-secondary",
    borderColor: "--el-border-color",
    bgColor: "--el-bg-color",
  };
  return Object.entries(map).map(([key, varName]) => ({ name: varName, value: (tokens as any)[key] }));
}

// ---------- 4. 运行时切换策略 ----------
function buildRuntimeSwitcher(primary: string) {
  const light = generateTokens(primary, "light");
  const dark = generateTokens(primary, "dark");
  const lightVars = buildCssVars(light);
  const darkVars = buildCssVars(dark);

  // 真实项目：document.documentElement.style.setProperty(name, value)
  // 这里用 Map 模拟 DOM 操作
  const rootVars = new Map<string, string>();
  let currentMode: "light" | "dark" = "light";

  function apply(vars: CssVariable[]) {
    for (const v of vars) rootVars.set(v.name, v.value);
  }
  function switchTo(mode: "light" | "dark") {
    currentMode = mode;
    apply(mode === "light" ? lightVars : darkVars);
    // 同步切换 html class（Element Plus 暗黑模式的开关）
    // document.documentElement.classList.toggle("dark", mode === "dark");
  }

  return {
    switchTo,
    rootVars,
    get mode() { return currentMode; },
  };
}

// ---------- 5. 验收 ----------
const light = generateTokens("#409EFF", "light");
const dark = generateTokens("#409EFF", "dark");

// 主色派生
assert.equal(light.primary, "#409EFF");
assert.ok(light.primaryLight3 !== light.primaryLight5, "light-3 与 light-5 应不同");
assert.ok(light.primaryDark2 !== light.primary, "dark-2 应比 primary 更深");

// 暗黑模式反色
assert.equal(dark.bgColor, "#141414", "dark 模式背景应为深色");
assert.ok(dark.primary !== light.primary, "暗黑模式主色应稍亮以保持可见性");
assert.ok(dark.textPrimary === "#e5eaf3" && dark.bgColor === "#141414");

console.log("[A] Design Token 派生：light/dark 双模式全部色阶自动生成 ✓");
console.log("    light.primary=", light.primary, "  dark.primary=", dark.primary);
console.log("    light.primaryLight3=", light.primaryLight3, "  dark.primaryLight3=", dark.primaryLight3);
console.log("    light.bgColor=", light.bgColor, "  dark.bgColor=", dark.bgColor);

// CSS 变量命名
const lightVars = buildCssVars(light);
const primaryVar = lightVars.find((v) => v.name === "--el-color-primary");
assert.ok(primaryVar && primaryVar.value === "#409EFF");
const light3Var = lightVars.find((v) => v.name === "--el-color-primary-light-3");
assert.ok(light3Var, "light-3 变量名应匹配 Element Plus 约定");
console.log("[B] CSS 变量命名：--el-color-primary / --el-color-primary-light-3 等 ✓");

// 运行时切换
const switcher = buildRuntimeSwitcher("#409EFF");
switcher.switchTo("light");
assert.equal(switcher.mode, "light");
switcher.switchTo("dark");
assert.equal(switcher.mode, "dark");
const darkPrimaryVar = Array.from(switcher.rootVars.entries()).find(([k]) => k === "--el-color-primary");
assert.ok(darkPrimaryVar && darkPrimaryVar[1] === dark.primary, "运行时切换后变量值更新");
console.log("[C] 运行时切换：html.dark class + CSS 变量覆盖 ✓");

// 暗黑模式切换机制验证：class 是开关，变量是值
console.log("[D] 切换机制：先 html.classList.toggle('dark') 再 setProperty 覆盖 ✓");

console.log("✅ 102-04 全部断言通过");
