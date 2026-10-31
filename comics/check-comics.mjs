#!/usr/bin/env node
// 漫画剧场校验脚本：manifest 一致性 + SVG 良构性 + 文本溢出启发式 + MD 完整性
// 用法：node comics/check-comics.mjs
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));

let errorCount = 0;
let warnCount = 0;
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

// —— SVG 良构性：标签配对 + 未转义 '<' 检查 ——
function checkWellFormed(src) {
  const errs = [];
  const stack = [];
  const re = /<(\/?)([A-Za-z][-A-Za-z0-9_.]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    const text = src.slice(last, m.index);
    if (text.includes("<"))
      errs.push(`存在未转义的 '<'（行 ${lineOf(src, m.index)}）`);
    last = re.lastIndex;
    const [, close, name, , self] = m;
    if (close) {
      const top = stack.pop();
      if (!top || top.name !== name) {
        errs.push(
          `标签不配对：</${name}>（行 ${lineOf(src, m.index)}，栈顶 ${top ? top.name : "空"}）`,
        );
        if (!top) break;
      }
    } else if (!self) {
      stack.push({ name, idx: m.index });
    }
  }
  const tail = src.slice(last);
  if (tail.includes("<"))
    errs.push(`存在未转义的 '<'（行 ${lineOf(src, last)}）`);
  if (stack.length)
    errs.push(`未闭合标签：${stack.map((t) => t.name).join(", ")}`);
  if (/<\?xml|<!DOCTYPE/i.test(src)) errs.push("不允许 XML 声明或 DOCTYPE");
  return errs;
}

// —— 文本溢出启发式：估算每个 text/tspan 的行宽 ——
function estWidth(s, fs) {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c > 0x2e7f)
      w += fs; // CJK 及全角
    else if (ch === " ") w += fs * 0.35;
    else if (/[iIl1.,:;'|(){}[\]]/.test(ch)) w += fs * 0.34;
    else if (/[A-Z0-9@#%&WWM]/.test(ch)) w += fs * 0.72;
    else w += fs * 0.58;
  }
  return w;
}

function checkTexts(src) {
  const warns = [];
  const re = /<(text|tspan)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(src))) {
    const [, tag, attrs, content] = m;
    const raw = content.replace(/<[^>]*>/g, "").trim();
    if (!raw) continue;
    const get = (k) => {
      const r = attrs.match(new RegExp(`${k}\\s*=\\s*["']([^"']+)["']`));
      return r ? r[1] : null;
    };
    const fs = parseFloat(get("font-size") || "");
    if (!fs) {
      warns.push(
        `${tag} 缺少显式 font-size："${raw.slice(0, 12)}…"（行 ${lineOf(src, m.index)}）`,
      );
      continue;
    }
    const w = estWidth(raw, fs);
    const anchor = get("text-anchor") || "start";
    const x = parseFloat(get("x") || "");
    if (Number.isFinite(x)) {
      const left =
        anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
      const right =
        anchor === "middle" ? x + w / 2 : anchor === "end" ? x : x + w;
      if (left < 10 || right > 1190) {
        warns.push(
          `文本可能超出画布（估宽 ${Math.round(w)}px）："${raw.slice(0, 16)}…"（行 ${lineOf(src, m.index)}）`,
        );
      }
    }
    if (w > 545) {
      warns.push(
        `单行文本过长（估宽 ${Math.round(w)}px > 545）："${raw.slice(0, 16)}…"（行 ${lineOf(src, m.index)}）`,
      );
    }
  }
  if (/<(image|script|foreignObject)\b/.test(src))
    warns.push("禁止使用 image/script/foreignObject 元素");
  if (!/viewBox="0 0 1200 840"/.test(src))
    warns.push('viewBox 必须为 "0 0 1200 840"');
  const ids = [...src.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(
    (r) => r[1],
  );
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) warns.push(`重复 id：${[...new Set(dup)].join(", ")}`);
  return warns;
}

// —— 主流程 ——
console.log("== 漫画剧场校验 ==");
console.log(
  `manifest：${manifest.episodes.length} 话，画布 ${manifest.canvas.width}x${manifest.canvas.height}`,
);

const seenSlugs = new Set();
for (const ep of manifest.episodes) {
  const label = `[EP.${String(ep.ep).padStart(2, "0")} ${ep.title}]`;
  const problems = [];
  if (seenSlugs.has(ep.slug)) problems.push("slug 重复");
  seenSlugs.add(ep.slug);
  const svgPath = join(here, `${ep.slug}.svg`);
  const mdPath = join(here, `${ep.slug}.md`);
  if (!existsSync(svgPath)) {
    problems.push(`缺少 ${ep.slug}.svg`);
  } else {
    const src = readFileSync(svgPath, "utf8");
    problems.push(...checkWellFormed(src));
    problems.push(...checkTexts(src));
  }
  if (!existsSync(mdPath)) {
    problems.push(`缺少 ${ep.slug}.md`);
  } else {
    const md = readFileSync(mdPath, "utf8");
    if (!md.includes(`# EP.${String(ep.ep).padStart(2, "0")}`))
      problems.push('MD 标题不符合 "# EP.NN" 约定');
    if (!md.includes(ep.part)) problems.push(`MD 未引用对应正文 ${ep.part}`);
    if (!/(自测|Quiz)/.test(md)) problems.push("MD 缺少自测题");
  }
  const errs = problems.filter(
    (p) => !/^文本|^单行|^缺少显式|禁止使用/.test(p),
  );
  const warns = problems.filter((p) =>
    /^文本|^单行|^缺少显式|禁止使用/.test(p),
  );
  errorCount += errs.length;
  warnCount += warns.length;
  const status = errs.length ? "✗" : warns.length ? "△" : "✓";
  console.log(
    `${status} ${label} ${errs.length || warns.length ? [...errs, ...warns].join("；") : "svg ✓ md ✓ 良构 ✓ 文本 ✓"}`,
  );
}

// parts 与 episodes.part 双向一致：防止「按分册筛选」下拉与话目映射漂移
const partFiles = new Set((manifest.parts || []).map((p) => p.file));
const usedParts = new Set(manifest.episodes.map((e) => e.part));
for (const f of usedParts) {
  if (!partFiles.has(f)) {
    console.log(`✗ parts 缺少映射：${f}`);
    errorCount++;
  }
}
for (const f of partFiles) {
  if (!usedParts.has(f)) {
    console.log(`△ parts 含未被引用映射：${f}`);
    warnCount++;
  }
}

// style-guide 与 character-sheet 存在性
if (!existsSync(join(here, "style-guide.md"))) {
  console.log("✗ 缺少 style-guide.md");
  errorCount++;
}
if (!existsSync(join(here, "samples/character-sheet.svg"))) {
  console.log("✗ 缺少 samples/character-sheet.svg");
  errorCount++;
}

console.log(
  `结果：${errorCount ? "✗" : "✓"} ${manifest.episodes.length} 话，${errorCount} 错误，${warnCount} 警告`,
);
process.exit(errorCount ? 1 : 0);
