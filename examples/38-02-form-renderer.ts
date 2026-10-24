// 文件: examples/38-02-form-renderer.ts
// ============ 渲染器：Schema → 组件树 ============
// 渲染器是低代码表单的引擎：递归遍历 Schema，产出组件树（本例产出"渲染描述树"，
// 对应 Vue/React 里的 VNode）。三个职责：
// 1) 类型映射：type → 组件（组件注册表，业务可扩展自定义字段组件）；
// 2) 联动裁剪：visibleWhen 不满足的分支整枝剪掉（含其值）；
// 3) 值注入：defaultValue / 已有数据 / disabled 状态全部注入节点属性。

import {
  type FieldSchema,
  type FormSchema,
  type Condition,
} from "./38-01-form-schema.js";

/** 组件注册表：新增字段类型 = 注册一个组件，渲染器零改动（开闭原则） */
export const componentRegistry: Record<string, string> = {
  input: "ElInput",
  textarea: "ElInputTextarea",
  number: "ElInputNumber",
  select: "ElSelect",
  date: "ElDatePicker",
  switch: "ElSwitch",
};

/** 联动条件求值 */
export function evalCondition(
  cond: Condition,
  values: Record<string, unknown>,
): boolean {
  const v = values[cond.field];
  switch (cond.op) {
    case "eq":
      return v === cond.value;
    case "neq":
      return v !== cond.value;
    case "in":
      return Array.isArray(cond.value) && cond.value.includes(v as never);
    case "gt":
      return (v as number) > (cond.value as number);
    case "truthy":
      return Boolean(v);
    default:
      return false;
  }
}

export interface RenderNode {
  component: string;
  props: Record<string, unknown>;
  fieldKey: string;
  visible: boolean;
  disabled: boolean;
  children?: RenderNode[];
}

/**
 * 渲染表单：产出节点树。
 * - visible=false 的节点仍产出（占位），但标注 visible 供框架层 v-if；
 * - 值收集时 visible=false 的字段必须剔除（见 38-05 提交管道）。
 */
export function renderForm(
  schema: FormSchema,
  values: Record<string, unknown>,
): RenderNode[] {
  return schema.fields.map((f) => renderField(f, values));
}

function renderField(
  f: FieldSchema,
  values: Record<string, unknown>,
): RenderNode {
  const visible = !f.visibleWhen || evalCondition(f.visibleWhen, values);
  const disabled = f.disabledWhen
    ? evalCondition(f.disabledWhen, values)
    : false;
  return {
    component: componentRegistry[f.type] ?? "UnknownField",
    fieldKey: f.key,
    visible,
    disabled,
    props: {
      label: f.label,
      placeholder: f.placeholder,
      modelValue: values[f.key] ?? f.defaultValue ?? null,
      options: f.options,
      required: f.required,
    },
  };
}

/** 值收集：带 defaultValue 的字段自动初始化（visible 裁剪在提交管道做） */
export function initValues(
  schema: FormSchema,
  preset: Record<string, unknown> = {},
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of schema.fields) {
    values[f.key] = f.key in preset ? preset[f.key] : (f.defaultValue ?? null);
  }
  return values;
}

// ---------------- 验证 ----------------

const schema: FormSchema = {
  formName: "请假申请",
  fields: [
    {
      key: "name",
      type: "input",
      label: "姓名",
      required: true,
      defaultValue: "",
    },
    { key: "days", type: "number", label: "请假天数", defaultValue: 1 },
    {
      key: "proxy",
      type: "select",
      label: "代理人工号",
      options: [
        { label: "张三", value: "e001" },
        { label: "李四", value: "e002" },
      ],
      visibleWhen: { field: "days", op: "gt", value: 3 },
    },
  ],
};

console.log("=== 初始渲染（days=1 → proxy 不可见） ===");
const v1 = initValues(schema);
console.log("初始值:", v1);
console.log(
  "proxy 节点:",
  renderForm(schema, v1).find((n) => n.fieldKey === "proxy"),
);

console.log("\n=== 改 days=5 → proxy 出现 ===");
const v2 = { ...v1, days: 5 };
const proxyNode = renderForm(schema, v2).find((n) => n.fieldKey === "proxy")!;
console.log(
  "proxy visible:",
  proxyNode.visible,
  "component:",
  proxyNode.component,
  "options:",
  (proxyNode.props.options as unknown[] | undefined)?.length,
);

console.log("\n=== 注册表扩展：新类型零改动 ===");
componentRegistry["rating"] = "ElRate";
const node = renderField(
  { key: "score", type: "rating" as never, label: "评分" },
  {},
);
console.log("rating →", node.component);

console.log("\n=== 对应 Vue 侧的渲染循环（示意） ===");
console.log(`
<v-for="node in nodes" :key="node.fieldKey">
  <component :is="node.component" v-show="node.visible" :disabled="node.disabled" v-bind="node.props" />`);
