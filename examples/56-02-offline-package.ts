// 文件: examples/56-02-offline-package.ts
// ============ 内嵌 H5 离线包:清单 diff、差量下载、请求拦截与校验回滚 ============
// 设计要点:
// 1) 离线包 = Native 提前把 H5 静态资源下载到本地,请求拦截命中后直接返回本地文件;
// 2) 差量更新按文件哈希算 diff,只下载新增/变化的文件——省流量是硬指标;
// 3) 校验失败必须回滚,半个包上线比网络慢更致命。

/** 简易内容哈希(djb2):真实项目用 md5/sha256,由 Native 端计算 */
function hash(body: string): string {
  let h = 5381;
  for (let i = 0; i < body.length; i++)
    h = ((h << 5) + h + body.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

interface FileEntry {
  url: string;
  body: string;
}
interface Manifest {
  name: string;
  version: string;
  files: Record<string, string>; // url -> 内容哈希
}

function buildManifest(
  name: string,
  version: string,
  files: FileEntry[],
): Manifest {
  const map: Record<string, string> = {};
  for (const f of files) map[f.url] = hash(f.body);
  return { name, version, files: map };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

/** 服务端包仓库:提供清单与按需取文件 */
class PackageRepo {
  constructor(
    private name: string,
    private version: string,
    private files: FileEntry[],
  ) {}

  manifest(): Manifest {
    return buildManifest(this.name, this.version, this.files);
  }

  fetchFiles(urls: string[]): FileEntry[] {
    return this.files.filter((f) => urls.includes(f.url));
  }
}

/** Native 侧离线包管理器:install/update/intercept 三件事 */
class OfflinePackageManager {
  private files = new Map<string, FileEntry>();
  private manifest: Manifest | null = null;
  downloadCount = 0;

  /** 原子安装:按 url 去重(后写覆盖)后全部校验,任何一个失败都整体回滚 */
  install(entries: FileEntry[], manifest: Manifest) {
    const merged = new Map(entries.map((f) => [f.url, f]));
    for (const f of merged.values()) {
      if (manifest.files[f.url] !== hash(f.body)) {
        throw new Error(`校验失败:${f.url} 哈希不匹配,回滚安装`);
      }
    }
    this.files = merged;
    this.manifest = manifest;
  }

  /** 请求拦截:命中返回本地内容,未命中返回 null 放行走网络 */
  intercept(url: string): string | null {
    return this.files.get(url)?.body ?? null;
  }

  /** 差量更新:按清单 diff 只拉取 added/changed,清理 removed */
  update(repo: PackageRepo): {
    added: number;
    changed: number;
    removed: number;
  } {
    const next = repo.manifest();
    const old = this.manifest;
    if (!old) throw new Error("请先 install 基线版本");
    const toFetch: string[] = [];
    let added = 0;
    let changed = 0;
    let removed = 0;
    for (const [url, h] of Object.entries(next.files)) {
      if (!(url in old.files)) {
        added++;
        toFetch.push(url);
      } else if (old.files[url] !== h) {
        changed++;
        toFetch.push(url);
      }
    }
    const removedUrls = Object.keys(old.files).filter(
      (url) => !(url in next.files),
    );
    removed = removedUrls.length;

    this.downloadCount += toFetch.length;
    const fetched = repo.fetchFiles(toFetch);
    // 在临时表完成校验后一次性提交:校验失败直接抛错,旧包不受影响
    const staged = [
      ...[...this.files.values()].filter((f) => !removedUrls.includes(f.url)),
      ...fetched,
    ];
    this.install(staged, next);
    return { added, changed, removed };
  }

  get version() {
    return this.manifest?.version ?? "none";
  }
}

// ---------------- 场景 1:首次全量安装与请求拦截 ----------------
const v1Files: FileEntry[] = [
  { url: "/h5/index.html", body: "<html>v1</html>" },
  { url: "/h5/app.js", body: "console.log('v1')" },
  { url: "/h5/style.css", body: ".a{color:red}" },
];
const repo1 = new PackageRepo("mall", "1.0.0", v1Files);
const mgr = new OfflinePackageManager();
mgr.install(
  repo1.fetchFiles(["/h5/index.html", "/h5/app.js", "/h5/style.css"]),
  repo1.manifest(),
);

console.log("已安装版本:", mgr.version);
assert(mgr.version === "1.0.0", "首装应为 1.0.0");
assert(
  mgr.intercept("/h5/app.js") === "console.log('v1')",
  "命中本地包应返回本地内容",
);
assert(mgr.intercept("/h5/other.js") === null, "未命中应返回 null 放行走网络");

// ---------------- 场景 2:v2 差量更新——只下载变化文件 ----------------
const v2Files: FileEntry[] = [
  { url: "/h5/index.html", body: "<html>v2</html>" }, // changed
  { url: "/h5/app.js", body: "console.log('v1')" }, // unchanged
  { url: "/h5/tracking.js", body: "// new" }, // added
  // style.css removed
];
const repo2 = new PackageRepo("mall", "1.1.0", v2Files);
const diff = mgr.update(repo2);
console.log("差量结果:", diff, "| 本次下载:", mgr.downloadCount, "个文件");
assert(
  diff.added === 1 && diff.changed === 1 && diff.removed === 1,
  "diff 应识别 1 增 1 改 1 删",
);
assert(mgr.downloadCount === 2, "unchanged 文件不应重复下载");
assert(mgr.version === "1.1.0", "更新后版本应前进");
assert(
  mgr.intercept("/h5/index.html") === "<html>v2</html>",
  "更新后应命中新内容",
);
assert(mgr.intercept("/h5/style.css") === null, "被移除的文件不应再命中本地");

// ---------------- 场景 3:损坏包——校验失败回滚,旧包保持可用 ----------------
// 服务端审核时算好的清单 v1.2.0:
const expected = buildManifest("mall", "1.2.0", [
  { url: "/h5/index.html", body: "<html>v2 审核版</html>" },
  { url: "/h5/app.js", body: "console.log('v1')" },
  { url: "/h5/tracking.js", body: "// new" },
]);
// CDN 下发的文件在传输中被篡改,与清单对不上:
const tampered: FileEntry[] = [
  {
    url: "/h5/index.html",
    body: "<html>该文件在传输中被篡改,哈希对不上</html>",
  },
  { url: "/h5/app.js", body: "console.log('v1')" },
  { url: "/h5/tracking.js", body: "// new" },
];
const beforeVersion = mgr.version;
const beforeBody = mgr.intercept("/h5/index.html");
let threw = false;
try {
  mgr.install(tampered, expected);
} catch {
  threw = true;
}
console.log("损坏包安装:", threw ? "被拒绝并回滚" : "意外通过");
assert(threw, "哈希不匹配必须抛错");
assert(mgr.version === beforeVersion, "回滚后版本应保持不变");
assert(
  mgr.intercept("/h5/index.html") === beforeBody,
  "回滚后旧包内容仍可正常服务",
);

console.log(
  "\n离线包管理通过:清单 diff、差量下载、拦截命中、校验回滚均有确定行为。",
);

// 标记为模块,避免与其它示例的顶层变量重名
export {};
