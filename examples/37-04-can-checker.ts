// 文件: examples/37-04-can-checker.ts
// ============ casl 风格 can() 判定器 ============
// 前端最流行的 ABAC 封装形态（casl 库的 API 风格）：
//   can(action, subject, field?) → boolean
// 规则用 AbilityBuilder 声明：can(动作, 资源, 字段?, 条件?)，通配符 * 表示全部。
// 判定顺序与语义：deny 规则优先于 can（显式 cannot 覆盖 cannot 外的 can）。
// 界面侧用 $can 做按钮显隐，路由守卫用它拦页面——判定逻辑全站一份。

export type AbacAction = string; // read/edit/delete/manage...
export type SubjectType = string; // Post/Order/*...

export interface AbilityRule {
  action: AbacAction;
  subject: SubjectType;
  fields?: string[]; // 限定字段；undefined = 全字段
  inverted?: boolean; // true = cannot 规则
  /** 条件函数（可选）：拿到具体资源实例做属性判断 */
  when?: (subject: Record<string, unknown>) => boolean;
}

export class Ability {
  constructor(private rules: readonly AbilityRule[]) {}

  can(
    action: AbacAction,
    subject: SubjectType,
    field?: string,
    instance?: Record<string, unknown>,
  ): boolean {
    let allowed = false;
    for (const rule of this.rules) {
      if (!this.matchRule(rule, action, subject, field, instance)) continue;
      // 后写的规则覆盖先写的（与 casl 一致：允许用 cannot 收窄）
      allowed = !rule.inverted;
    }
    return allowed;
  }

  private matchRule(
    rule: AbilityRule,
    action: AbacAction,
    subject: SubjectType,
    field?: string,
    instance?: Record<string, unknown>,
  ): boolean {
    if (rule.action !== action && rule.action !== "manage") return false;
    if (rule.subject !== subject && rule.subject !== "all") return false;
    if (field && rule.fields && !rule.fields.includes(field)) return false;
    if (rule.when && instance && !rule.when(instance)) return false;
    if (rule.when && !instance) return false; // 有条件但没实例：无法确认（保守拒绝）
    return true;
  }
}

/** casl 风格的声明式构建器（方法用箭头函数字段绑定 this，支持解构调用） */
export class AbilityBuilder {
  readonly rules: AbilityRule[] = [];

  can = (
    action: AbacAction,
    subject: SubjectType,
    fields?: string[],
    when?: AbilityRule["when"],
  ): void => {
    this.rules.push({ action, subject, fields, when });
  };

  cannot = (
    action: AbacAction,
    subject: SubjectType,
    fields?: string[],
    when?: AbilityRule["when"],
  ): void => {
    this.rules.push({ action, subject, fields, when, inverted: true });
  };

  build = (): Ability => new Ability(this.rules);
}

// ---------------- 验证 ----------------

const { can, cannot, build } = new AbilityBuilder();

// 方法用箭头函数字段定义（而非原型方法），解构后 this 依然正确——casl 的同款技巧。
// 若用普通方法定义，`const { can } = builder` 再调用会报 "Cannot read properties of undefined (reading 'rules')"。

// 基础：读者能读文章
can("read", "Post");
// 编辑：仅自己的草稿（属性条件）
can(
  "edit",
  "Post",
  ["title", "content"],
  (post) => post.authorId === "u1" && post.status === "draft",
);
// 全局：管理员管理一切
cannot("delete", "Post");
can("manage", "Post", undefined, (post) => post.isAdmin === true);

const ability = build();

console.log("=== 无实例的场景（仅查类型级权限） ===");
console.log("能读 Post?", ability.can("read", "Post")); // true

console.log("\n=== 带实例的属性判定 ===");
const myDraft = { authorId: "u1", status: "draft", isAdmin: false };
const myPublished = { authorId: "u1", status: "published", isAdmin: false };
const otherDraft = { authorId: "u2", status: "draft", isAdmin: false };

console.log("编辑自己的草稿:", ability.can("edit", "Post", "title", myDraft)); // true
console.log(
  "编辑已发布(状态不满足):",
  ability.can("edit", "Post", "title", myPublished),
); // false
console.log("编辑他人草稿:", ability.can("edit", "Post", "title", otherDraft)); // false

console.log("\n=== 字段级：条件规则只开放 title/content ===");
console.log(
  "改自己草稿的 title:",
  ability.can("edit", "Post", "title", myDraft),
); // true
console.log(
  "改自己草稿的 rating(未开放字段):",
  ability.can("edit", "Post", "rating", myDraft),
); // false

console.log("\n=== cannot 收窄 + manage 通配 ===");
console.log(
  "普通人删除 Post:",
  ability.can("delete", "Post", undefined, { ...myDraft, isAdmin: false }),
); // false
console.log(
  "管理员删除 Post:",
  ability.can("delete", "Post", undefined, { ...myDraft, isAdmin: true }),
); // true
console.log(
  "管理员更新 Post(manage 通配):",
  ability.can("update", "Post", undefined, { isAdmin: true }),
); // true

console.log("\n=== 界面接线形态（Vue/React 通用思路） ===");
console.log(`
// Vue: <button v-if="$can('edit', 'Post', 'title', post)">编辑</button>
// React: {ability.can('edit', 'Post', 'title', post) && <button>编辑</button>}`);
