#!/usr/bin/env node
/**
 * frontend-advanced-guide-examples CLI
 *
 * 命令：
 *   fag-examples list          列出全部示例（编号 + 标题）
 *   fag-examples run <id>      运行指定示例（前缀匹配，如 01-03 或 01-03-closure-wallet）
 *   fag-examples pick          随机抽一个示例运行（学习模式）
 *
 * 示例为 TS/JS 文件，经 npx tsx 运行（首次自动安装，约数秒）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = readdirSync(pkgDir)
  .filter((f) => /^\d{2}-\d{2}-[\w-]+\.(?:ts|js|mjs|tsx)$/.test(f))
  .sort();

// 从文件第二行的 ============ 分隔注释提取标题（文件头规范见 CONTRIBUTING）
const titleOf = (f) =>
  readFileSync(join(pkgDir, f), "utf8")
    .split("\n")
    .find((l) => /^\/\/\s*=+/.test(l))
    ?.replace(/^\/\/\s*=+\s*/, "")
    .replace(/\s*=+\s*$/, "") ?? "";

const list = () => {
  console.log(
    `共 ${files.length} 个示例（frontend-advanced-guide-examples）\n`,
  );
  let cur = "";
  for (const f of files) {
    const part = f.slice(0, 2);
    if (part !== cur) {
      cur = part;
      console.log(`\n── 第 ${cur} 册 ──`);
    }
    console.log(
      `  ${f.replace(/\.(ts|js|mjs|tsx)$/, "").padEnd(28)} ${titleOf(f)}`,
    );
  }
  console.log("\n运行：npx frontend-advanced-guide-examples run <编号>");
};

function pick(id) {
  const hits = id ? files.filter((f) => f.startsWith(id)) : null;
  if (id && (!hits || hits.length === 0)) {
    console.error(`未找到匹配 "${id}" 的示例。用 list 查看全部编号。`);
    process.exit(1);
  }
  if (id && hits.length > 1) {
    console.error(
      `"${id}" 匹配到 ${hits.length} 个，请写全：\n  ${hits.join("\n  ")}`,
    );
    process.exit(1);
  }
  const file = id ? hits[0] : files[Math.floor(Math.random() * files.length)];
  console.log(`▶ ${file}  ${titleOf(file)}\n`);
  const r = spawnSync("npx", ["-y", "tsx", file], {
    cwd: pkgDir,
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "list" || !cmd) list();
else if (cmd === "run" && arg) pick(arg);
else if (cmd === "pick") pick();
else {
  console.error("用法：fag-examples list | run <编号> | pick");
  process.exit(1);
}
