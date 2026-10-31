// 12-mini-browser-engine-lab 在线预览：CSS 解析 → 选择器匹配 → 层叠 → 盒模型 / flex 布局
import { parseStylesheet } from "../12-mini-browser-engine-lab/src/css-parser.ts";
import { resolveStyle } from "../12-mini-browser-engine-lab/src/cascade.ts";
import type { DomNode } from "../12-mini-browser-engine-lab/src/selector.ts";
import { computeBox } from "../12-mini-browser-engine-lab/src/box-model.ts";
import {
  getContainerProps,
  getItemProps,
  layoutFlex,
} from "../12-mini-browser-engine-lab/src/flex-layout.ts";
import {
  section,
  button,
  buttonRow,
  textarea,
  output,
  log,
  pre,
  table,
} from "./shared.ts";

const CSS = [
  "/* 全局 */",
  ".card { color: #333; padding: 12px; border-width: 1px; }",
  "#hero.card { color: #c00 !important; font-size: 18px; }",
  "div.card.a { color: #080; }",
  ".list { display: flex; flex-direction: row; gap: 8px; }",
  ".list > .item { flex-grow: 1; }",
].join("\n");

const TARGET: DomNode = {
  tag: "div",
  id: "hero",
  className: "card a",
  children: [],
};

const sec = section(
  "CSS 引擎流水线",
  "样式表可编辑。目标节点 div#hero.card.a：观察层叠仲裁（!important > specificity > 源码顺序）",
);
const out = output(sec);
const ta = textarea(sec, CSS, 8);

buttonRow(sec);
button(sec, "▶ 解析样式表（AST 统计）", () => {
  const sheet = parseStylesheet(ta.value);
  const rules = sheet.children.filter((n) => n.type === "rule");
  table(out, [
    ["顶层规则数", sheet.children.length],
    ["声明总数", rules.reduce((s, r) => s + r.declarations.length, 0)],
    ["各规则 selector", rules.map((r) => r.selectors.join(", "))],
  ]);
});

button(sec, "▶ resolveStyle：目标节点的最终样式", () => {
  const sheet = parseStylesheet(ta.value).children;
  const final = resolveStyle(TARGET, sheet);
  const rows: Array<[string, unknown]> = [];
  for (const [prop, decl] of final.properties) {
    rows.push([prop, `${decl.value}${decl.important ? " !important" : ""}`]);
  }
  table(out, rows.length ? rows : [["（无命中）", ""]]);
  log(
    out,
    "color 的仲裁：#c00(!important, #hero.card) 胜出，尽管 div.card.a 的 specificity 更低——important 一票否决",
    "info",
  );
});

button(sec, "▶ flex 布局：三个 item 平分 300px 容器", () => {
  const sheet = parseStylesheet(ta.value).children;
  const mkNode = (cls: string): DomNode => ({ tag: "div", className: cls });
  const containerStyle = resolveStyle(mkNode("list"), sheet);
  const itemStyle = resolveStyle(mkNode("item"), sheet);

  const mkBox = (width: number) => ({
    node: mkNode("item"),
    width,
    height: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    borderTop: 0,
    borderRight: 0,
    borderBottom: 0,
    borderLeft: 0,
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    boxSizing: "border-box" as const,
    x: 0,
    y: 0,
    borderWidth: 0,
    borderHeight: 0,
    marginBoxWidth: width,
    marginBoxHeight: 0,
    children: [],
    style: itemStyle,
  });

  const container = {
    node: mkNode("list"),
    width: 300,
    height: 100,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    borderTop: 0,
    borderRight: 0,
    borderBottom: 0,
    borderLeft: 0,
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    boxSizing: "border-box" as const,
    x: 0,
    y: 0,
    borderWidth: 300,
    borderHeight: 100,
    marginBoxWidth: 300,
    marginBoxHeight: 100,
    children: [mkBox(60), mkBox(60), mkBox(60)],
    style: containerStyle,
  };

  const cp = getContainerProps(container);
  log(
    out,
    `容器：direction=${cp.direction} wrap=${cp.wrap} gap=${cp.gapMain}`,
    "info",
  );
  for (const child of container.children) {
    const ip = getItemProps(child);
    log(out, `item 初始宽 ${child.width}，flex-grow=${ip.flexGrow}`);
  }
  layoutFlex(container);
  table(
    out,
    container.children.map((c, i) => [
      `item${i + 1} 布局后 x / 宽`,
      `${c.x} / ${c.width}`,
    ]),
  );
  log(
    out,
    "观察：3 个 flex-grow:1 的 item 平分剩余空间（(300 - 180 - 2×gap) / 3），x 依次排开含 gap",
    "ok",
  );
});

button(sec, "▶ 盒模型 computeBox：content-box vs border-box", () => {
  const ctx = {
    viewportWidth: 800,
    viewportHeight: 600,
    parentWidth: 800,
    parentHeight: 600,
  };
  const mkStyle = (sizing: "content-box" | "border-box") => {
    const sheet = parseStylesheet(
      `.b { width: 100px; padding: 10px; border-width: 2px; box-sizing: ${sizing}; }`,
    );
    return resolveStyle({ tag: "div", className: "b" }, sheet);
  };
  const a = computeBox(
    { tag: "div", className: "b" },
    mkStyle("content-box"),
    ctx,
  );
  const b = computeBox(
    { tag: "div", className: "b" },
    mkStyle("border-box"),
    ctx,
  );
  table(out, [
    [
      "content-box：width 语义",
      `内容宽 ${a.width}，border-box 总宽 ${a.borderWidth}`,
    ],
    [
      "border-box：width 语义",
      `内容宽 ${b.width}，border-box 总宽 ${b.borderWidth}`,
    ],
  ]);
  pre(
    out,
    "同样的 width:100px：content-box 撑到 124px，border-box 锁定 100px",
    "dim",
  );
});
