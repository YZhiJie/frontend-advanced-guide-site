// 文件: examples/55-03-postcss-pipeline.ts
// ============ PostCSS 插件管线:嵌套展开 → 自动前缀 → 压缩 ============
// 设计要点:
// 1) PostCSS 的核心是「字符串/AST 进来,变换后出去」的插件管线,插件顺序决定结果;
// 2) 嵌套必须在加前缀之前展开,否则 `&` 选择器无法确定真实选择器;
// 3) 自动前缀要按目标浏览器决定,不是「全都加」;压缩必须在最后一步。

type PostCSSPlugin = (css: string) => string;

/** 把 `& .title { ... }` 展开为 `.card .title { ... }`,支持一层嵌套 */
const flattenNesting: PostCSSPlugin = (css) =>
  css.replace(
    /([^{}]+)\{([^{}]*?)(&\s*[^{}]+)\{([^{}]*)\}\s*([^{}]*)\}/g,
    (
      _,
      selector: string,
      before: string,
      nestedSel: string,
      nestedBody: string,
    ) => {
      const parent = selector.trim();
      const child = nestedSel.replace(/&/g, parent).trim();
      return `${parent}{${before.trim()}}\n${child}{${nestedBody.trim()}}`;
    },
  );

/** 模拟 autoprefixer:只对需要前缀的属性补 -webkit-(可按 browserslist 开关) */
function autoprefix(targets: { webkit: boolean }): PostCSSPlugin {
  return (css) => {
    if (!targets.webkit) return css;
    return css.replace(
      /(?<!-webkit-)user-select:\s*([^;]+);/g,
      (_, value: string) =>
        `-webkit-user-select: ${value.trim()}; user-select: ${value.trim()};`,
    );
  };
}

/** 模拟 cssnano:去注释、压缩空白、缩短十六进制颜色 */
const minify: PostCSSPlugin = (css) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .replace(/#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3/gi, "#$1$2$3")
    .replace(/;}/g, "}")
    .trim();

function runPipeline(css: string, plugins: PostCSSPlugin[]): string {
  return plugins.reduce((out, plugin) => plugin(out), css);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const source = `
/* theme tokens */
.card {
  user-select: none;
  color: #ffffff;
  & .title { margin: 0 0 8px 0; }
}
`;

// ---------------- 场景 1:完整管线 ----------------
const plugins = [flattenNesting, autoprefix({ webkit: true }), minify];
const output = runPipeline(source, plugins);
console.log("输入:\n" + source.trim());
console.log("\n输出:\n" + output);

assert(!output.includes("/*"), "注释应被移除");
assert(output.includes(".card{"), "父规则应保留");
assert(
  output.includes("-webkit-user-select:none;user-select:none"),
  "应补 -webkit- 前缀",
);
assert(
  output.includes(".card .title{margin:0 0 8px 0}"),
  "嵌套应展开为后代选择器",
);
assert(output.includes("#fff"), "六位重复颜色应缩短为三位");
assert(!output.includes("&"), "输出不应残留 &");

// ---------------- 场景 2:关闭前缀时不应出现 -webkit- ----------------
const noPrefix = runPipeline(source, [
  flattenNesting,
  autoprefix({ webkit: false }),
  minify,
]);
console.log("\n无前缀输出:", noPrefix);
assert(!noPrefix.includes("-webkit-"), "目标浏览器不需要前缀时不应添加");

// ---------------- 场景 3:插件顺序错误会留下 & ----------------
const wrongOrder = runPipeline(source, [autoprefix({ webkit: true }), minify]);
console.log("\n顺序错误输出(节选):", wrongOrder.slice(0, 80));
assert(wrongOrder.includes("&"), "不先展开嵌套,压缩后仍会残留 &");

// ---------------- 场景 4:压缩可重复执行(幂等) ----------------
const twice = minify(minify(source));
assert(twice === minify(source), "cssnano 类压缩应幂等");

console.log(
  "\nPostCSS 管线通过:嵌套、前缀、压缩、顺序依赖、幂等均有确定行为。",
);

// 标记为模块,避免与其它示例的顶层变量重名
export {};
