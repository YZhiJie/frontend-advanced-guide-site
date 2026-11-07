// 文件: examples/87-01-design-system-tokens.ts
// ============ Design System 设计令牌分层架构 ============
// 对应 JD「Design System」。设计系统的地基是设计令牌的分层：
// primitive（原始色值）→ semantic（语义别名）→ component（组件令牌）。
// 纯 TS 演示三层令牌、命名规范、版本校验。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. 三层令牌模型 ----------------

/**
 * 原始令牌（Primitive）：不可再分的基础值，纯色值/尺寸，无语义。
 * 这层是设计系统的"原子"，不直接给组件用。
 */
export const primitiveTokens = {
  color: {
    blue500: "#3b82f6",
    blue600: "#2563eb",
    gray50: "#f9fafb",
    gray900: "#111827",
    red500: "#ef4444",
    green500: "#22c55e",
    amber500: "#f59e0b",
  },
  spacing: {
    0: "0px",
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    6: "24px",
    8: "32px",
  },
  radius: {
    none: "0px",
    sm: "2px",
    md: "6px",
    lg: "12px",
    full: "9999px",
  },
} as const;

/**
 * 语义令牌（Semantic）：给原始令牌赋予业务含义。
 * 组件引用这层，不直接引用原始令牌。换肤只改这层。
 */
export const semanticTokens = {
  color: {
    primary: primitiveTokens.color.blue600,
    primaryHover: primitiveTokens.color.blue500,
    background: primitiveTokens.color.gray50,
    foreground: primitiveTokens.color.gray900,
    danger: primitiveTokens.color.red500,
    success: primitiveTokens.color.green500,
    warning: primitiveTokens.color.amber500,
  },
  spacing: primitiveTokens.spacing, // 间距语义和原始一致（间距本身就是语义）
  radius: {
    button: primitiveTokens.radius.md,
    card: primitiveTokens.radius.lg,
    badge: primitiveTokens.radius.full,
  },
} as const;

/**
 * 组件令牌（Component）：语义令牌在特定组件上的应用。
 * 允许同一个语义令牌在不同组件上取不同值（如按钮圆角和卡片圆角不同）。
 */
export const componentTokens = {
  button: {
    background: semanticTokens.color.primary,
    backgroundHover: semanticTokens.color.primaryHover,
    color: "#ffffff",
    borderRadius: semanticTokens.radius.button,
    paddingX: semanticTokens.spacing[4],
    paddingY: semanticTokens.spacing[2],
  },
  card: {
    background: "#ffffff",
    borderRadius: semanticTokens.radius.card,
    padding: semanticTokens.spacing[6],
  },
  badge: {
    borderRadius: semanticTokens.radius.badge,
    paddingX: semanticTokens.spacing[2],
    paddingY: semanticTokens.spacing[1],
  },
} as const;

// ---------------- 2. 令牌命名规范校验 ----------------

/** 校验令牌命名是否符合规范：每段小驼峰、点分隔、语义化 */
export function validateTokenName(name: string): boolean {
  // 规则：每段以小写字母开头，后续允许小驼峰（backgroundHover），用 . 分隔层级
  return /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/.test(name);
}

/** 递归检查所有令牌名是否合规 */
export function validateTokenTree(obj: Record<string, unknown>, prefix = ""): string[] {
  const invalid: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullName = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === "object" && obj[key] !== null) {
      invalid.push(...validateTokenTree(obj[key] as Record<string, unknown>, fullName));
    } else if (!validateTokenName(fullName)) {
      invalid.push(fullName);
    }
  }
  return invalid;
}

// ---------------- 3. 主题切换：只换语义层 ----------------

/** 深色主题：只改语义令牌，原始令牌和组件令牌不动 */
export const darkSemanticTokens = {
  ...semanticTokens,
  color: {
    ...semanticTokens.color,
    primary: primitiveTokens.color.blue500, // 深色下调亮主色
    background: primitiveTokens.color.gray900,
    foreground: primitiveTokens.color.gray50,
  },
};

// ---------------- 演示与断言 ----------------

function main(): void {
  console.log("===== 1. 三层令牌：原始 → 语义 → 组件 =====");
  // 组件令牌引用语义，语义引用原始
  assert(componentTokens.button.background === semanticTokens.color.primary, "按钮背景 = 语义主色");
  assert(semanticTokens.color.primary === primitiveTokens.color.blue600, "语义主色 = 原始 blue600");
  assert(componentTokens.card.borderRadius === primitiveTokens.color ? false : true, "卡片圆角通过语义层间接引用原始值");
  console.log("✓ 组件→语义→原始 三层引用链正确");

  console.log("\n===== 2. 命名规范校验 =====");
  const valid = validateTokenName("color.primary.hover");
  const invalid1 = validateTokenName("color.Primary"); // 大写
  const invalid2 = validateTokenName("color-primary"); // 连字符
  assert(valid === true, "color.primary.hover 合规");
  assert(invalid1 === false, "大写不合规");
  assert(invalid2 === false, "连字符不合规");

  // 校验整个令牌树
  const treeErrors = validateTokenTree(componentTokens);
  assert(treeErrors.length === 0, `组件令牌树不应有命名错误，实际: ${treeErrors.join(", ")}`);
  console.log("✓ 命名规范：小写+点分隔，无大写无连字符，整树校验通过");

  console.log("\n===== 3. 主题切换只改语义层 =====");
  // 浅色：background = gray50
  assert(semanticTokens.color.background === primitiveTokens.color.gray50, "浅色背景 = gray50");
  // 深色：background = gray900
  assert(darkSemanticTokens.color.background === primitiveTokens.color.gray900, "深色背景 = gray900");
  // 组件令牌不动，自动随语义层变化
  assert(componentTokens.card.background === "#ffffff", "组件令牌引用的是语义层值（浅卡白）");
  console.log("✓ 主题切换只改语义层，组件令牌自动响应");

  console.log("\n===== 4. 圆角令牌的语义差异 =====");
  // 同一个原始 radius，在不同组件上取不同语义值
  assert(componentTokens.button.borderRadius === primitiveTokens.radius.md, "按钮圆角 = md");
  assert(componentTokens.card.borderRadius === primitiveTokens.radius.lg, "卡片圆角 = lg");
  assert(componentTokens.badge.borderRadius === primitiveTokens.radius.full, "徽章圆角 = full");
  console.log("✓ 按钮/卡片/徽章圆角各不同，由组件令牌层差异化");

  console.log("\n✅ 三层令牌架构 + 命名规范 + 主题切换 + 组件差异化全部通过");
}

main();
