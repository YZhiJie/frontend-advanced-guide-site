/**
 * 第 101 部分 · Vue 2 → Vue 3 迁移实战
 * 迁移前体检工具：对源码做逐行静态扫描，量化 Vue 2 专属写法的使用量，
 * 并对每条命中给出修复建议。10 类规则覆盖高频 Breaking Changes：
 *   全局 API（use/prototype/filter/component/new Vue）、$set/$delete、
 *   EventBus（$on/$off/$once）、模板过滤器管道、.sync / .native 修饰符、
 *   生命周期改名、函数式组件选项。
 * 扫描规则可直接搬进 ESLint 自定义规则或 CI 脚本做防回退门禁。
 * 运行：npx tsx examples/101-02-breaking-changes-scanner.ts
 */
import assert from "node:assert";

interface Finding {
  rule: string;
  line: number;
  snippet: string;
  fix: string;
}

interface ScanRule {
  rule: string;
  re: RegExp;
  fix: string;
}

const RULES: ScanRule[] = [
  { rule: "global-use", re: /(?<![.\w])Vue\.use\(/g, fix: "改为 app.use()" },
  { rule: "global-component", re: /(?<![.\w])Vue\.component\(/g, fix: "改为 app.component()" },
  { rule: "new-vue", re: /(?<![.\w])new\s+Vue\(/g, fix: "改为 createApp(App).mount('#app')" },
  { rule: "vue-prototype", re: /Vue\.prototype\./g, fix: "改为 app.config.globalProperties 或 provide/inject" },
  { rule: "vue-filter", re: /(?<![.\w])Vue\.filter\(/g, fix: "过滤器整体移除：改计算属性/方法" },
  { rule: "this-set", re: /\$set\(|\$delete\(/g, fix: "Proxy 时代直接赋值/delete，移除调用" },
  { rule: "event-bus", re: /\$on\(|\$off\(|\$once\(/g, fix: "实例事件总线失效：换 mitt 独立实例" },
  // 管道过滤器：| 前不能是 | 或 &（排除逻辑或/按位与），| 后不能紧跟 |（排除 a || b）
  { rule: "pipe-filter", re: /\{\{[^}]*?(?<![|&])\|(?!\|)\s*[\w$]/g, fix: "模板过滤器管道：改计算属性" },
  { rule: "sync-modifier", re: /:[\w-]+\.sync=/g, fix: "改 v-model:prop" },
  { rule: "native-modifier", re: /@[\w.]+\.native/g, fix: "移除 .native 修饰符" },
  { rule: "before-destroy", re: /beforeDestroy|(?<![a-zA-Z])destroyed\b/g, fix: "改 onBeforeUnmount/onUnmounted" },
  { rule: "functional-comp", re: /functional\s*:\s*true/g, fix: "函数式组件选项移除：改纯函数组件" },
];

export function scanVue2(source: string): Finding[] {
  const findings: Finding[] = [];
  source.split("\n").forEach((line, i) => {
    for (const { rule, re, fix } of RULES) {
      const r = new RegExp(re.source, re.flags.replace("g", "")); // 每行只记一次同类命中
      if (r.test(line)) findings.push({ rule, line: i + 1, snippet: line.trim(), fix });
    }
  });
  return findings;
}

// ---------- 1. 阳性样例：一个典型 Vue 2 项目的"重灾区" ----------
const vue2Sample = `
import Vue from "vue";
import VueRouter from "vue-router";
Vue.use(VueRouter);
Vue.component("AppHeader", AppHeader);
Vue.prototype.$http = httpClient;
Vue.filter("money", formatMoney);
const app = new Vue({ render: (h) => h(App) }).$mount("#app");
this.$set(this.form, "email", "");
bus.$on("refresh", this.reload);
const cell = "{{ order.price | money }}";
<a :title.sync="title" @click.native="go">;
beforeDestroy() { this.timer = null; }
export default { functional: true };
`;

const findings = scanVue2(vue2Sample);
const byRule: Record<string, number> = {};
for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;

assert.equal(byRule["global-use"], 1, "Vue.use 应命中 1 处");
assert.equal(byRule["global-component"], 1);
assert.equal(byRule["new-vue"], 1);
assert.equal(byRule["vue-prototype"], 1);
assert.equal(byRule["vue-filter"], 1);
assert.equal(byRule["this-set"], 1);
assert.equal(byRule["event-bus"], 1);
assert.equal(byRule["pipe-filter"], 1, "管道过滤器应命中 {{ order.price | money }}");
assert.equal(byRule["sync-modifier"], 1);
assert.equal(byRule["native-modifier"], 1);
assert.equal(byRule["before-destroy"], 1);
assert.equal(byRule["functional-comp"], 1);
assert.equal(findings.length, 12, "阳性样例共 12 处命中");
console.log(`[1] 阳性样例扫描：${findings.length} 处命中，规则分布 =`, byRule);

// ---------- 2. 阴性样例：Vue 3 写法与易误伤场景必须零命中 ----------
const vue3Sample = `
import { createApp } from "vue";
const app = createApp(App);
app.use(router);
app.component("AppHeader", AppHeader);
app.config.globalProperties.$http = httpClient;
this.form.email = "";
emitter.on("refresh", this.reload); // mitt 事件总线
const cell = formatMoney(order.price); // 过滤器改计算属性/方法
<a :title="title" @click="go">;
onBeforeUnmount() { this.timer = null; }
const mask = x | y; // JS 按位或：不在 {{ }} 内，不应误报
const flag = "{{ a || b }}"; // 逻辑或：两个连续 |，不应误报
`;

const negativeFindings = scanVue2(vue3Sample);
assert.deepEqual(negativeFindings, [], "Vue3 写法与易误伤场景必须零命中");
console.log("[2] 阴性样例扫描：0 命中（app.* / mitt / 按位或 / a||b 均未误报）");

// ---------- 3. 体检报告：按规则聚合输出改造工作量 ----------
function report(source: string): string {
  const fs = scanVue2(source);
  if (fs.length === 0) return "✓ 未发现 Vue 2 专属写法";
  const grouped = new Map<string, Finding[]>();
  for (const f of fs) {
    if (!grouped.has(f.rule)) grouped.set(f.rule, []);
    grouped.get(f.rule)!.push(f);
  }
  return [...grouped.entries()]
    .map(([rule, list]) => `${rule} × ${list.length}（如 L${list[0].line} → ${list[0].fix}）`)
    .join("\n");
}
const sampleReport = report(vue2Sample);
assert.ok(sampleReport.includes("global-use × 1"), "报告按规则聚合");
console.log("[3] 体检报告示例：\n" + sampleReport);

console.log("✅ 101-02 全部断言通过");
