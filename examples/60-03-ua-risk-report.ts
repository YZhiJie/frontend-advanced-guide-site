/** 60-03-ua-risk-report.ts —— UA 解析 → 引擎/环境识别 → 兼容性风险清单
 *
 * 原则:UA 只用于「环境与风险评估」,绝不用于功能开关(功能开关用特性检测,
 * 见 60-01)。但排查问题、定兼容矩阵、给监控分桶时,UA 仍是一手信息。
 */

export interface UaProfile {
  engine: "blink" | "webkit" | "gecko" | "unknown";
  os: "ios" | "android" | "windows" | "mac" | "other";
  client: string;
}

export function parseUA(ua: string): UaProfile {
  const s = ua.toLowerCase();
  const os: UaProfile["os"] = /iphone|ipad|ipod/.test(s)
    ? "ios"
    : s.includes("android")
      ? "android"
      : s.includes("windows")
        ? "windows"
        : s.includes("mac os")
          ? "mac"
          : "other";
  // 客户端判断讲究顺序:国产壳与 Edge 都带 chrome 标记,必须先匹配特征 token;
  // 「like Gecko」是 WebKit 的历史兼容串,绝不能据此判 gecko
  const client = s.includes("micromessenger")
    ? "wechat"
    : s.includes("qihoobrowser") || s.includes("360se") || s.includes("360ee")
      ? "360"
      : s.includes("maxthon")
        ? "maxthon"
        : s.includes("edg/")
          ? "edge"
          : s.includes("firefox")
            ? "firefox"
            : s.includes("chrome") || s.includes("crios")
              ? "chrome"
              : s.includes("safari")
                ? "safari"
                : "unknown";
  // 引擎:iOS 上一切浏览器(含 Chrome/微信)都是 WebKit;Firefox 是 gecko;
  // 其余带 chrome 标记的是 blink;裸 safari 是 webkit
  const engine: UaProfile["engine"] =
    client === "firefox"
      ? "gecko"
      : os === "ios"
        ? "webkit"
        : s.includes("chrome") || s.includes("crios") || client === "edge"
          ? "blink"
          : s.includes("safari")
            ? "webkit"
            : "unknown";
  return { engine, os, client };
}

// 风险规则库:命中即提示「这个环境有哪些已验证过的坑」
export function risksOf(p: UaProfile): string[] {
  const risks: string[] = [];
  if (p.os === "ios") {
    risks.push(
      "100vh 随地址栏伸缩抖动 → 用 dvh 或 visualViewport(见 08 册)",
      "音视频自动播放需静音或用户手势",
      "fixed 定位 + 键盘弹起会错位 → 监听 visualViewport.resize",
      "unload/beforeunload 不可靠 → 用 pagehide(见 19 册)",
    );
  }
  if (p.client === "wechat") {
    risks.push(
      "iOS 微信调大字体后页面字号被强制放大 → -webkit-text-size-adjust:100%",
      "JSSDK 签名在 iOS 上必须用「首跳 URL」,SPA 路由切换后不可复用",
    );
  }
  if (p.client === "360" || p.client === "maxthon") {
    risks.push(
      "双核浏览器可能被切到 IE 兼容模式 → 用 meta renderer=webkit 锁定极速内核",
    );
  }
  if (p.os === "android" && p.client === "unknown") {
    risks.push("厂商 ROM 定制 WebView 内核碎片化 → 不信 UA 版本号,做特性检测");
  }
  if (p.engine === "webkit" && p.client === "safari") {
    risks.push("日期字符串只认 ISO/斜杠格式 → new Date 前过 safeParseDate(见 60-02)");
  }
  return risks;
}

// ---- 硬断言:四条真实 UA 的画像与风险命中 ----
const IPHONE_WECHAT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47";
const WIN_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const WIN_360 =
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.125 Safari/537.36 QihooBrowser/15.1.0";

const p1 = parseUA(IPHONE_WECHAT);
console.assert(
  p1.engine === "webkit" && p1.client === "wechat" && p1.os === "ios",
  "iOS 微信:WebKit 内核(不是 gecko,别被 like Gecko 骗)",
);
console.assert(
  risksOf(p1).some((r) => r.includes("100vh")) &&
    risksOf(p1).some((r) => r.includes("text-size-adjust")),
  "iOS 微信风险命中",
);
const p2 = parseUA(WIN_CHROME);
console.assert(
  p2.engine === "blink" && p2.client === "chrome" && p2.os === "windows",
  "Win Chrome:blink",
);
const p3 = parseUA(MAC_SAFARI);
console.assert(
  p3.engine === "webkit" && p3.client === "safari" && p3.os === "mac",
  "Mac Safari:webkit",
);
console.assert(
  risksOf(p3).some((r) => r.includes("safeParseDate")),
  "Safari 日期风险命中",
);
const p4 = parseUA(WIN_360);
console.assert(
  p4.client === "360" && p4.engine === "blink",
  "360 当前是 blink,但可能切核",
);
console.assert(
  risksOf(p4).some((r) => r.includes("renderer")),
  "双核风险命中",
);

// 打印一份可贴进 issue 的环境风险报告
for (const ua of [IPHONE_WECHAT, WIN_CHROME, MAC_SAFARI, WIN_360]) {
  const p = parseUA(ua);
  console.log(`\n[${p.os}/${p.client}/${p.engine}]`);
  for (const r of risksOf(p)) console.log(`  ⚠ ${r}`);
}
console.log("\n✅ UA 解析与风险清单通过");
