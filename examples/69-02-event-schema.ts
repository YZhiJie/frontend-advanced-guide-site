// 文件: examples/69-02-event-schema.ts
// ============ 事件 schema 注册表 + 装载期校验：把埋点规范变成可执行的代码 ============
// 规范写在文档里没人看，写进注册表里就会在「注册时」和「上报前」两道关卡被强制校验。

// ---------------- 类型 ----------------

/** 硬断言：console.assert 在 Node 里只打印不退出，演示脚本需要「错了就红」 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

type PropType = "string" | "number" | "boolean";

interface PropSpec {
  type: PropType;
  required: boolean;
  desc: string;
}

/** 事件 schema：一次埋点需求评审的结构化产物 */
interface EventSchema {
  name: string; // object_action 蛇形命名，如 submit_order_click
  version: number; // schema 演进靠版本号，禁止原地改义
  owner: string; // 负责人：数据对不上时找得到人
  desc: string;
  props: Record<string, PropSpec>;
}

/** 所有事件必须携带的公共参数（SDK 自动注入，此处做装载期校验演示） */
const COMMON_PARAMS: Record<string, PropType> = {
  app_version: "string",
  device_id: "string",
  uid: "string",
  session_id: "string",
  network: "string",
  platform: "string",
};

// ---------------- 注册表 ----------------

const NAME_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/; // 蛇形且至少两段：object_action

class SchemaRegistry {
  /** key = `${name}@${version}`，允许同名多版本并存（灰度期新旧并存） */
  private schemas = new Map<string, EventSchema>();
  /** 每个事件名的最新版本号，防止旧版本覆盖新版本 */
  private latestVersion = new Map<string, number>();

  /** 装载期校验第一关：注册时就不合规直接拒绝（返回错误列表，便于一次性暴露全部问题） */
  register(schema: EventSchema): string[] {
    const errors: string[] = [];

    if (!NAME_RE.test(schema.name)) {
      errors.push(
        `事件名「${schema.name}」不合规：必须是 object_action 蛇形命名（如 submit_order_click）`,
      );
    }
    if (!Number.isInteger(schema.version) || schema.version < 1) {
      errors.push(`事件「${schema.name}」version 必须是 >= 1 的整数`);
    }
    if (!schema.owner) {
      errors.push(`事件「${schema.name}」缺少 owner（数据对不上时找不到负责人）`);
    }
    // 属性名禁止与公共参数撞名：SDK 注入的公共参数会被业务属性覆盖，数据就脏了
    for (const p of Object.keys(schema.props)) {
      if (p in COMMON_PARAMS) {
        errors.push(`事件「${schema.name}」属性「${p}」与公共参数撞名，会被 SDK 注入值覆盖`);
      }
      if (!NAME_RE.test(p) && !/^[a-z][a-z0-9]*$/.test(p)) {
        errors.push(`事件「${schema.name}」属性「${p}」必须蛇形命名`);
      }
    }
    const latest = this.latestVersion.get(schema.name);
    if (latest !== undefined && schema.version <= latest) {
      errors.push(
        `事件「${schema.name}」版本回退：已存在 v${latest}，不能再注册 v${schema.version}（演进只能升版）`,
      );
    }
    if (errors.length > 0) return errors;

    this.schemas.set(`${schema.name}@${schema.version}`, schema);
    this.latestVersion.set(schema.name, schema.version);
    return [];
  }

  /** 装载期校验第二关：事件上报前校验（属性齐不齐、类型对不对、公共参数有没有注入） */
  validate(
    name: string,
    props: Record<string, unknown>,
    context: Record<string, unknown>,
  ): string[] {
    const errors: string[] = [];
    const latest = this.latestVersion.get(name);
    if (latest === undefined) {
      return [`事件「${name}」未注册：先写埋点需求文档并注册 schema，再写代码`];
    }
    const schema = this.schemas.get(`${name}@${latest}`)!;

    for (const [prop, spec] of Object.entries(schema.props)) {
      const value = props[prop];
      if (value === undefined || value === null) {
        if (spec.required) errors.push(`「${name}」缺少必填属性「${prop}」（${spec.desc}）`);
        continue;
      }
      if (typeof value !== spec.type) {
        errors.push(
          `「${name}」属性「${prop}」类型错误：期望 ${spec.type}，实际 ${typeof value}（值 ${JSON.stringify(value)}）`,
        );
      }
    }
    // 公共参数由 SDK 注入，这里校验注入结果
    for (const [key, type] of Object.entries(COMMON_PARAMS)) {
      const value = context[key];
      if (value === undefined || value === null || value === "") {
        errors.push(`公共参数「${key}」缺失：检查 SDK 初始化与 identify 时序`);
      } else if (typeof value !== type) {
        errors.push(`公共参数「${key}」类型应为 ${type}`);
      }
    }
    return errors;
  }
}

// ---------------- 演示 ----------------

function main() {
  const reg = new SchemaRegistry();

  console.log("===== 1. 注册合法事件 =====");
  const schemas: EventSchema[] = [
    {
      name: "submit_order_click",
      version: 1,
      owner: "张三",
      desc: "提交订单按钮点击",
      props: {
        sku_id: { type: "string", required: true, desc: "商品 ID" },
        amount: { type: "number", required: true, desc: "金额（分）" },
        from_banner: { type: "boolean", required: false, desc: "是否来自 banner" },
      },
    },
    {
      name: "home_banner_exposure",
      version: 1,
      owner: "李四",
      desc: "首页 banner 曝光（判定标准见 43.4）",
      props: {
        banner_id: { type: "string", required: true, desc: "banner ID" },
      },
    },
  ];
  for (const s of schemas) {
    const errs = reg.register(s);
    assert(errs.length === 0, `「${s.name}」注册应通过`);
    console.log(`注册成功：${s.name}@v${s.version}（owner: ${s.owner}）`);
  }

  console.log("\n===== 2. 拦截不合规注册 =====");
  const badOnes: EventSchema[] = [
    {
      name: "ClickButton", // 大驼峰，违规
      version: 1,
      owner: "王五",
      desc: "坏示范",
      props: {},
    },
    {
      name: "pay_click",
      version: 1,
      owner: "", // 缺负责人
      desc: "坏示范",
      props: {},
    },
    {
      name: "order_submit",
      version: 1,
      owner: "赵六",
      desc: "坏示范",
      props: {
        uid: { type: "string", required: true, desc: "与公共参数撞名" },
      },
    },
  ];
  for (const s of badOnes) {
    const errs = reg.register(s);
    assert(errs.length > 0, `「${s.name}」应被拦截`);
    for (const e of errs) console.log(`  ✗ ${e}`);
  }
  // 版本回退拦截
  const rollback = reg.register({ ...schemas[0], version: 1 });
  assert(rollback.some((e) => e.includes("版本回退")), "重复注册 v1 应报版本回退");
  console.log(`  ✗ ${rollback[0]}`);

  console.log("\n===== 3. 上报前校验：合法事件通过 =====");
  const context = {
    app_version: "3.2.1",
    device_id: "dev-abc",
    uid: "u-10086",
    session_id: "sess-xyz",
    network: "wifi",
    platform: "android",
  };
  const okErrors = reg.validate(
    "submit_order_click",
    { sku_id: "SKU-1", amount: 9900 },
    context,
  );
  assert(okErrors.length === 0, "合法事件应通过校验");
  console.log("submit_order_click 校验通过 ✅");

  console.log("\n===== 4. 上报前校验：三类典型错误被拦下 =====");
  const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["submit_order_click", { sku_id: "SKU-1" }, context], // 缺必填 amount
    ["submit_order_click", { sku_id: "SKU-1", amount: "99元" }, context], // amount 类型错
    [
      "submit_order_click",
      { sku_id: "SKU-1", amount: 9900 },
      { ...context, uid: "" }, // 公共参数 uid 缺失（未登录时序问题）
    ],
  ];
  for (const [name, props, ctx] of cases) {
    const errs = reg.validate(name, props, ctx);
    assert(errs.length > 0, "非法事件应被拦截");
    for (const e of errs) console.log(`  ✗ ${e}`);
  }
  const unknown = reg.validate("some_random_event", {}, context);
  assert(unknown[0].includes("未注册"), "未注册事件应被拦截");
  console.log(`  ✗ ${unknown[0]}`);

  console.log("\n✅ 事件 schema 注册表与装载期校验全部演示通过");
}

main();
