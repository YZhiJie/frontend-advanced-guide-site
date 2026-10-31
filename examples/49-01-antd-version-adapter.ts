// 文件: examples/49-01-antd-version-adapter.ts
// ============ Ant Design 3/4/5 API 适配层:让存量代码和平迁移 ============
// 设计要点:
// 1) 迁移最怕「一次性全量改」——先做适配层,把差异收敛到一个文件,再逐页替换;
// 2) 适配层只做「语义等价」的转译,不偷偷改变业务行为;
// 3) 每个转译都要有测试:旧写法 → 新写法 → 渲染结果一致。

type LegacyProps = Record<string, unknown>;

interface AdaptResult {
  props: Record<string, unknown>;
  warnings: string[];
}

/** Modal / Drawer:visible → open(v5);maskClosable 保持同名 */
function adaptOverlay(props: LegacyProps): AdaptResult {
  const next: LegacyProps = { ...props };
  const warnings: string[] = [];
  if ("visible" in next) {
    if ("open" in next) {
      warnings.push("同时存在 visible 与 open,以 open 为准");
      delete next.visible;
    } else {
      next.open = next.visible;
      delete next.visible;
    }
  }
  return { props: next, warnings };
}

/** Dropdown:overlay → menu(v5);menu 需要包成 { items } */
function adaptDropdown(props: LegacyProps): AdaptResult {
  const next: LegacyProps = { ...props };
  const warnings: string[] = [];
  if ("overlay" in next) {
    const legacy = next.overlay as { items?: unknown[] } | undefined;
    next.menu = { items: legacy?.items ?? [] };
    delete next.overlay;
    warnings.push("overlay 已转为 menu.items,请检查自定义渲染");
  }
  return { props: next, warnings };
}

/** message/notification:静态方法改名(v5),warn → warning */
const MESSAGE_ALIAS: Record<string, string> = {
  warn: "warning",
  error: "error",
  info: "info",
  success: "success",
};

function adaptMessageMethod(method: string): string {
  return MESSAGE_ALIAS[method] ?? method;
}

/** Form: v3 getFieldDecorator 的显式 id/options → v4/v5 的 name + rules */
function adaptFormField(legacy: {
  id: string;
  options?: { rules?: unknown[]; initialValue?: unknown };
}): { name: string; rules: unknown[]; initialValue?: unknown } {
  return {
    name: legacy.id,
    rules: legacy.options?.rules ?? [],
    initialValue: legacy.options?.initialValue,
  };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 场景 1:Modal 迁移 ----------------
const modal = adaptOverlay({ visible: true, title: "编辑", maskClosable: false });
console.log("Modal:", modal.props);
assert(modal.props.open === true && !("visible" in modal.props), "visible 应转成 open");
assert(modal.props.maskClosable === false, "其余属性必须原样保留");

// ---------------- 场景 2:Dropdown 迁移 ----------------
const dropdown = adaptDropdown({
  overlay: { items: [{ key: "a", label: "复制" }] },
  trigger: ["click"],
});
console.log("Dropdown:", JSON.stringify(dropdown.props));
assert(
  Array.isArray((dropdown.props.menu as { items: unknown[] }).items),
  "overlay 应转为 menu.items",
);

// ---------------- 场景 3:message 方法名 ----------------
console.log("message.warn →", adaptMessageMethod("warn"));
assert(adaptMessageMethod("warn") === "warning", "warn 应映射为 warning");

// ---------------- 场景 4:Form 字段声明 ----------------
const field = adaptFormField({
  id: "email",
  options: { rules: [{ required: true, type: "email" }], initialValue: "" },
});
console.log("Form field:", field);
assert(field.name === "email" && field.rules.length === 1, "getFieldDecorator 应转 name + rules");

// ---------------- 冲突检测:visible + open 同时出现 ----------------
const conflict = adaptOverlay({ visible: false, open: true });
assert(conflict.warnings.length === 1 && conflict.props.open === true, "冲突时应保留 open 并告警");

console.log("\n适配完成:4 类差异全部收敛,业务属性零丢失。");

// 标记为模块,避免与其它示例的顶层变量重名
export {};
