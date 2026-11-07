// 文件: examples/84-01-design-tokens.ts
// ============ shadcn/ui 设计令牌系统：CSS Variables + 主题合并 ============
// 对应 JD 技术栈 shadcn/ui + Radix UI + Tailwind CSS。
// shadcn/ui 的核心是「令牌驱动」：用 CSS Variables 定义设计令牌，
// Tailwind 通过 theme.extend 引用，换肤只需换变量值。纯 TS 演示令牌结构与合并。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. 设计令牌定义 ----------------

/** shadcn/ui 的标准语义令牌，映射到 CSS Variables */
export interface DesignTokens {
  /** 背景与前景（文字） */
  background: string;
  foreground: string;
  /** 卡片 */
  card: string;
  cardForeground: string;
  /** 主色 */
  primary: string;
  primaryForeground: string;
  /** 次要色 */
  secondary: string;
  secondaryForeground: string;
  /** 强调色（hover/选中） */
  accent: string;
  accentForeground: string;
  /** 边框与输入框 */
  border: string;
  input: string;
  ring: string;
  /** 圆角 */
  radius: string;
}

/** 浅色主题令牌 */
export const LIGHT_TOKENS: DesignTokens = {
  background: "0 0% 100%",
  foreground: "240 10% 3.9%",
  card: "0 0% 100%",
  cardForeground: "240 10% 3.9%",
  primary: "240 5.9% 10%",
  primaryForeground: "0 0% 98%",
  secondary: "240 4.8% 95.9%",
  secondaryForeground: "240 5.9% 10%",
  accent: "240 4.8% 95.9%",
  accentForeground: "240 5.9% 10%",
  border: "240 5.9% 90%",
  input: "240 5.9% 90%",
  ring: "240 5.9% 10%",
  radius: "0.5rem",
};

/** 深色主题令牌：只改色值，结构不变 */
export const DARK_TOKENS: DesignTokens = {
  background: "240 10% 3.9%",
  foreground: "0 0% 98%",
  card: "240 10% 3.9%",
  cardForeground: "0 0% 98%",
  primary: "0 0% 98%",
  primaryForeground: "240 5.9% 10%",
  secondary: "240 3.7% 15.9%",
  secondaryForeground: "0 0% 98%",
  accent: "240 3.7% 15.9%",
  accentForeground: "0 0% 98%",
  border: "240 3.7% 15.9%",
  input: "240 3.7% 15.9%",
  ring: "240 4.9% 83.9%",
  radius: "0.5rem",
};

// ---------------- 2. 令牌 → CSS Variables 生成 ----------------

/** 把 DesignTokens 转成 CSS Variables 字符串（HSL 格式，hsl(var(--primary)) 使用） */
export function tokensToCssVars(tokens: DesignTokens): string {
  const map: Record<string, string> = {
    background: tokens.background,
    foreground: tokens.foreground,
    card: tokens.card,
    "card-foreground": tokens.cardForeground,
    primary: tokens.primary,
    "primary-foreground": tokens.primaryForeground,
    secondary: tokens.secondary,
    "secondary-foreground": tokens.secondaryForeground,
    accent: tokens.accent,
    "accent-foreground": tokens.accentForeground,
    border: tokens.border,
    input: tokens.input,
    ring: tokens.ring,
    radius: tokens.radius,
  };
  return Object.entries(map)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join("\n");
}

// ---------------- 3. 主题覆盖：品牌色定制 ----------------

/** 租户/品牌定制：只覆盖指定令牌，其余继承基础主题 */
export function applyBrandOverlay(base: DesignTokens, overlay: Partial<DesignTokens>): DesignTokens {
  return { ...base, ...overlay };
}

// ---------------- 4. 令牌完整性校验 ----------------

/** 校验主题令牌是否完整（所有字段都有值），防止定制时漏配导致样式崩坏 */
export function validateTokens(tokens: DesignTokens): string[] {
  const missing: string[] = [];
  for (const key of Object.keys(tokens) as (keyof DesignTokens)[]) {
    if (!tokens[key] || tokens[key].trim() === "") missing.push(key);
  }
  return missing;
}

// ---------------- 演示与断言 ----------------

function main(): void {
  console.log("===== 1. 浅色 → CSS Variables =====");
  const lightCss = tokensToCssVars(LIGHT_TOKENS);
  assert(lightCss.includes("--background: 0 0% 100%"), "浅色背景变量正确");
  assert(lightCss.includes("--primary: 240 5.9% 10%"), "浅色主色变量正确");
  console.log("✓ 浅色主题 CSS Variables 生成正确");
  console.log(lightCss.split("\n").slice(0, 4).join("\n") + "\n  ...");

  console.log("\n===== 2. 深色主题：结构相同，色值翻转 =====");
  const darkCss = tokensToCssVars(DARK_TOKENS);
  assert(darkCss.includes("--background: 240 10% 3.9%"), "深色背景变量正确");
  assert(darkCss.includes("--foreground: 0 0% 98%"), "深色前景变量正确");
  // radius 在两个主题中一致（圆角不随主题变）
  assert(LIGHT_TOKENS.radius === DARK_TOKENS.radius, "圆角不随主题变化");
  console.log("✓ 深色主题色值翻转，圆角等非色值令牌保持一致");

  console.log("\n===== 3. 品牌覆盖：只改主色 =====");
  const branded = applyBrandOverlay(LIGHT_TOKENS, {
    primary: "221 83% 53%", // 品牌蓝
    primaryForeground: "0 0% 100%",
    ring: "221 83% 53%",
  });
  assert(branded.primary === "221 83% 53%", "品牌主色覆盖成功");
  assert(branded.background === LIGHT_TOKENS.background, "未覆盖的背景继承基础主题");
  console.log(`✓ 品牌覆盖：primary=${branded.primary}，background 继承=${branded.background}`);

  console.log("\n===== 4. 令牌完整性校验 =====");
  const missing = validateTokens(LIGHT_TOKENS);
  assert(missing.length === 0, "完整主题不应有缺失令牌");
  // 模拟漏配
  const incomplete = { ...LIGHT_TOKENS, primary: "" } as DesignTokens;
  const missing2 = validateTokens(incomplete);
  assert(missing2.includes("primary"), "漏配 primary 应被检测到");
  console.log(`✓ 完整性校验：完整主题无缺失，漏配 primary 被检测到`);

  console.log("\n✅ 设计令牌系统：CSS Variables 生成 + 深色翻转 + 品牌覆盖 + 完整性校验全部通过");
}

main();
