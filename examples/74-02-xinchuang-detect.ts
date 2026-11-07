// 文件: examples/74-02-xinchuang-detect.ts
// ============ 信创环境探测与能力报告模拟 ============
// 设计要点:
// 1. UA 只负责「画像初判」(OS/浏览器/内核版本),能力结论必须落到特性检测与版本阈值规则库
// 2. 兼容清单按「内核版本 < 阈值 → 命中风险 → 降级策略」组织,区分语法层/API 层/CSS 层
// 3. 输出可直接贴进政企交付工单的环境报告:画像 → 命中项 → 降级建议 → 就绪度评级
//
// 注意:真实项目的 UA 特征字串以厂商实测为准(信创浏览器版本迭代快),
// 本示例的 UA 为教学构造样本,规则库阈值取自 caniuse 公开数据。

/** 断言工具:校验不通过直接抛错,让示例在门禁里「红得响亮」 */
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------- 1. UA 解析:环境画像 ----------

interface EnvProfile {
  os: "麒麟" | "统信UOS" | "Windows" | "Android" | "未知OS";
  browser: "奇安信可信" | "红莲花" | "360信创版" | "Chrome" | "系统WebView" | "未知浏览器";
  kernel: number; // Chromium 内核主版本号,识别不出为 0
  isXinchuang: boolean; // 是否信创栈(国产 OS 或信创定制浏览器)
  ua: string;
}

function parseUA(ua: string): EnvProfile {
  const os: EnvProfile["os"] = /Kylin|kylin/.test(ua)
    ? "麒麟"
    : /\bUOS\b/.test(ua)
      ? "统信UOS"
      : /Windows NT/.test(ua)
        ? "Windows"
        : /Android/.test(ua)
          ? "Android"
          : "未知OS";
  const browser: EnvProfile["browser"] = /QAXBrowser/i.test(ua)
    ? "奇安信可信"
    : /HLHBrowser/i.test(ua)
      ? "红莲花"
      : /360XC/i.test(ua)
        ? "360信创版"
        : /; wv\)/.test(ua)
          ? "系统WebView"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : "未知浏览器";
  const m = ua.match(/Chrome\/(\d+)/);
  const kernel = m ? Number(m[1]) : 0;
  const isXinchuang =
    os === "麒麟" || os === "统信UOS" || ["奇安信可信", "红莲花", "360信创版"].includes(browser);
  return { os, browser, kernel, isXinchuang, ua };
}

// ---------- 2. 兼容规则库:内核版本阈值 → 风险与降级策略 ----------

interface CompatRule {
  belowKernel: number; // 内核版本低于该值即命中
  feature: string;
  layer: "语法" | "API" | "CSS";
  degrade: string;
}

const RULES: CompatRule[] = [
  { belowKernel: 85, feature: "可选链 ?. 与空值合并 ??", layer: "语法", degrade: "构建期降级:esbuild/babel target 钉到 chrome 84,语法层转译" },
  { belowKernel: 88, feature: "CSS aspect-ratio 属性", layer: "CSS", degrade: "降级:padding-top 百分比占位法维持宽高比" },
  { belowKernel: 91, feature: "String.prototype.replaceAll", layer: "API", degrade: "core-js 按需 polyfill,或手写 split/join" },
  { belowKernel: 92, feature: "Array.prototype.at", layer: "API", degrade: "core-js polyfill;或 arr[arr.length - 1] 改写" },
  { belowKernel: 94, feature: "structuredClone 深拷贝", layer: "API", degrade: "core-js polyfill;注意其不拷贝函数与 DOM 节点的语义边界" },
  { belowKernel: 97, feature: "Array.prototype.findLast", layer: "API", degrade: "core-js polyfill;或 reverse().find() 改写" },
  { belowKernel: 105, feature: "CSS 容器查询 @container", layer: "CSS", degrade: "降级:媒体查询 + ResizeObserver 模拟,或直接放弃按容器自适应" },
  { belowKernel: 111, feature: "CSS :has() 父选择器", layer: "CSS", degrade: "降级:JS 给父元素加 class 的旁路方案" },
];

/** WebView 专属规则:系统 WebView 内核随 ROM 冻结,不可控 */
function extraRisks(p: EnvProfile): string[] {
  const risks: string[] = [];
  if (p.browser === "系统WebView")
    risks.push("系统 WebView 内核随 ROM 冻结,用户无法自行升级 → 关键页准备极简降级版");
  if (p.isXinchuang && p.kernel > 0 && p.kernel < 100)
    risks.push("信创浏览器内核普遍滞后主流 3~5 年,且因国密改造重新认证周期长,升级慢 → 验收矩阵按厂商公告内核版本钉死");
  if (p.kernel === 0) risks.push("未识别出 Chromium 内核版本(可能为深度定制壳) → 必须上特性检测探针,勿信 UA");
  return risks;
}

// ---------- 3. 评估与报告 ----------

function evaluate(p: EnvProfile): { hits: CompatRule[]; risks: string[]; grade: string } {
  const hits = p.kernel > 0 ? RULES.filter((r) => p.kernel < r.belowKernel) : [];
  const risks = extraRisks(p);
  const grade =
    hits.length === 0 && risks.length === 0
      ? "A(全量功能可上)"
      : hits.length <= 3
        ? "B(按需 polyfill + 构建目标钉死)"
        : "C(需专项适配:语法转译 + 多项 API polyfill + 降级设计)";
  return { hits, risks, grade };
}

function report(p: EnvProfile): string {
  const { hits, risks, grade } = evaluate(p);
  const lines = [
    `环境画像: ${p.os} + ${p.browser} | Chromium 内核 ${p.kernel || "未识别"} | 信创栈=${p.isXinchuang ? "是" : "否"}`,
  ];
  if (hits.length > 0) {
    lines.push("命中兼容清单:");
    for (const h of hits) lines.push(`  - [${h.layer}] ${h.feature}(内核 <${h.belowKernel}) → ${h.degrade}`);
  } else {
    lines.push("命中兼容清单: 无");
  }
  for (const r of risks) lines.push(`风险提示: ${r}`);
  lines.push(`就绪度评级: ${grade}`);
  return lines.join("\n");
}

/** ============ 三个典型环境演示 ============ */
export function runDetectDemo() {
  // 环境一:银河麒麟 V10 + 奇安信可信浏览器(Chromium 93,信创交付常见组合)
  const kylinQax = parseUA(
    "Mozilla/5.0 (X11; Linux aarch64; Kylin V10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.82 Safari/537.36 QAXBrowser/1.0",
  );
  // 环境二:Windows + 主流 Chrome 126
  const winChrome = parseUA(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  );
  // 环境三:老旧 Android 系统 WebView(Chromium 66,政企 App 内嵌)
  const oldWebView = parseUA(
    "Mozilla/5.0 (Linux; Android 8.1.0; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/66.0.3359.126 Mobile Safari/537.36",
  );

  for (const [label, env] of [
    ["麒麟V10+奇安信", kylinQax],
    ["Windows+Chrome126", winChrome],
    ["老旧WebView", oldWebView],
  ] as const) {
    console.log(`\n===== ${label} =====`);
    console.log(report(env));
  }

  // ---- 硬断言 ----
  assert(kylinQax.isXinchuang && kylinQax.kernel === 93, "麒麟+奇安信应识别为信创栈、内核 93");
  const qaxEval = evaluate(kylinQax);
  assert(qaxEval.hits.length === 4, `内核 93 应命中 4 条规则(94/97/105/111 以下项),实际 ${qaxEval.hits.length}`);
  assert(
    qaxEval.hits.some((h) => h.feature.includes("structuredClone")),
    "内核 93 应命中 structuredClone 缺失",
  );

  const chromeEval = evaluate(winChrome);
  assert(!winChrome.isXinchuang && chromeEval.hits.length === 0, "Chrome 126 不应命中任何规则");
  assert(chromeEval.grade.startsWith("A"), "Chrome 126 应为 A 级就绪");

  const wvEval = evaluate(oldWebView);
  assert(oldWebView.browser === "系统WebView", "; wv) 标记应识别为系统 WebView");
  assert(wvEval.hits.length === RULES.length, "内核 66 应命中全部规则");
  assert(wvEval.risks.some((r) => r.includes("ROM 冻结")), "WebView 应提示 ROM 冻结风险");

  console.log("\n✅ 信创环境探测与能力报告全部断言通过");
}

runDetectDemo();
