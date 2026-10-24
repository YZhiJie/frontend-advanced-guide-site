// 文件: examples/01-25-engine-pipeline.js
// ============ JS 引擎执行管线全景：源码 → token → AST → 字节码 → 执行上下文 ============
//
// 设计说明（这是一个"教学模拟器"，不是真实引擎实现）：
// 1) 真实 V8 的词法分析器/语法分析器是 C++ 编写、增量解析、容错恢复的复杂状态机；
//    这里用约 60 行极简代码复刻"字符流 → token 流 → AST"的主干，只为让抽象概念可见；
// 2) 真实 V8 流程：Parser 产出 AST → Ignition 生成字节码并解释执行 →
//    热点函数被 TurboFan JIT 优化为机器码；本模拟跳过字节码，直接"解释执行 AST"；
// 3) 重点观察"创建阶段"与"执行阶段"的分离——var/let 提升、TDZ 的所有行为都来自这里。
//
// 运行：node examples/01-25-engine-pipeline.js

// ---------- 第 1 阶段：词法分析（Lexical Analysis / Tokenize） ----------
// 把源代码字符流切成语法单元（token）：关键字、标识符、数字、运算符、分隔符。
function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    } // 空白（含换行）不产生 token
    if (/[A-Za-z_$]/.test(ch)) {
      // 标识符或关键字：连续的字母数字_$
      let word = "";
      while (i < source.length && /[\w$]/.test(source[i])) word += source[i++];
      tokens.push({
        type: /^(var|let|const)$/.test(word) ? "keyword" : "name",
        value: word,
      });
      continue;
    }
    if (/\d/.test(ch)) {
      // 数字字面量（仅支持整数）
      let num = "";
      while (i < source.length && /\d/.test(source[i])) num += source[i++];
      tokens.push({ type: "number", value: Number(num) });
      continue;
    }
    if ("=+;.()".includes(ch)) {
      tokens.push({ type: "punct", value: ch });
      i++;
      continue;
    }
    throw new SyntaxError(`词法分析失败：无法识别字符 "${ch}"`);
  }
  return tokens;
}

// ---------- 第 2 阶段：语法分析（Syntax Analysis / Parse → AST） ----------
// 按文法规则把 token 流组织成抽象语法树（AST）。
// 支持的极简文法：
//   程序       := 语句*
//   语句       := 声明语句 | 表达式语句
//   声明       := ('var'|'let'|'const') 标识符 '=' 数字 ';'
//   表达式语句 := 成员访问 '(' 参数 ')' ';'   参数 := 原子 ( '+' 原子 )*
function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (value) => {
    const t = next();
    if (!t || t.value !== value) {
      // 真实引擎在这里抛 SyntaxError：解析期错误，代码一行都不会执行
      throw new SyntaxError(
        `语法分析失败：期望 "${value}"，实际得到 "${t && t.value}"`,
      );
    }
  };

  const parseStatement = () => {
    if (peek().type === "keyword") {
      // 声明语句
      const kind = next().value;
      const idTok = next();
      if (!idTok || idTok.type !== "name")
        throw new SyntaxError("语法分析失败：缺少变量名");
      expect("=");
      const initTok = next();
      if (!initTok || initTok.type !== "number")
        throw new SyntaxError("语法分析失败：声明需要数字初始值");
      expect(";");
      return {
        type: "VariableDeclaration",
        kind,
        name: idTok.value,
        init: initTok.value,
      };
    }
    const obj = next().value; // 表达式语句：obj.method(args);
    expect(".");
    const method = next().value;
    expect("(");
    // 参数支持 "原子 ( '+' 原子 )*"，+ 被解析成 BinaryExpression 节点
    const parseAtom = () => {
      const t = next();
      return t.type === "number"
        ? { type: "NumericLiteral", value: t.value }
        : { type: "Identifier", name: t.value };
    };
    const args = [];
    while (peek() && peek().value !== ")") {
      let expr = parseAtom();
      while (peek() && peek().value === "+") {
        next();
        expr = {
          type: "BinaryExpression",
          op: "+",
          left: expr,
          right: parseAtom(),
        };
      }
      args.push(expr);
    }
    expect(")");
    expect(";");
    return {
      type: "ExpressionStatement",
      callee: { obj, method },
      arguments: args,
    };
  };

  const body = [];
  while (pos < tokens.length) body.push(parseStatement());
  return { type: "Program", body };
}

// ---------- 第 3 阶段：执行上下文的"创建阶段" ----------
// 逐行执行前，引擎先扫描整个作用域的声明，建立变量环境：
//   var        → 绑定并初始化为 undefined（所以声明前可访问，值为 undefined）
//   let/const  → 只绑定不初始化，标记为 TDZ（声明前访问抛 ReferenceError）
const TDZ = Symbol("TDZ");
function creationPhase(ast) {
  const env = {};
  for (const node of ast.body) {
    if (node.type !== "VariableDeclaration") continue;
    if (node.kind === "var")
      env[node.name] = undefined; // var：创建阶段就初始化
    else env[node.name] = TDZ; // let/const：处于暂时性死区
  }
  return env;
}

// ---------- 第 4 阶段：执行上下文的"执行阶段" ----------
// 按 AST 语句顺序逐行执行：遇到声明语句才完成 let/const 初始化与赋值。
function executionPhase(ast, env) {
  const evalExpr = (node) => {
    if (node.type === "NumericLiteral") return node.value;
    if (node.type === "BinaryExpression")
      return evalExpr(node.left) + evalExpr(node.right);
    if (env[node.name] === TDZ) {
      throw new ReferenceError(
        `Cannot access '${node.name}' before initialization（TDZ）`,
      );
    }
    return env[node.name];
  };
  for (const node of ast.body) {
    if (node.type === "VariableDeclaration") {
      env[node.name] = node.init; // 此刻 let/const 才离开 TDZ
    } else {
      const args = node.arguments.map(evalExpr);
      console[node.callee.method](...args);
    }
  }
}

// ============ 跑一遍，观察每个阶段的产物 ============
const source = `
var a = 1;
let b = 2;
console.log(a + b);
`;

console.log("── ① 词法分析产物（前 8 个 token）──");
const tokens = tokenize(source);
console.log(tokens.slice(0, 8));

console.log("\n── ② 语法分析产物（AST，已省略部分字段）──");
const ast = parse(tokens);
console.log(JSON.stringify(ast, null, 2));

console.log("── ③ 创建阶段刚结束（代码一行未执行）──");
const env = creationPhase(ast);
console.log("env.a =", env.a, "        ← var：已初始化为 undefined，可访问");
try {
  if (env.b === TDZ)
    throw new ReferenceError("Cannot access 'b' before initialization（TDZ）");
} catch (e) {
  console.log("读取 b →", e.message, "← let：已绑定但未初始化（TDZ）");
}

console.log("\n── ④ 执行阶段逐行执行 ──");
executionPhase(ast, env); // 3

// ============ 面试对照：解析期错误 vs 运行时错误 ============
try {
  parse(tokenize("let x = ;")); // 语法错误：在"语法分析阶段"就失败，整段代码不会执行
} catch (e) {
  console.log("\nSyntaxError（解析期抛出，整段脚本不执行）：", e.message);
}
try {
  const badEnv = creationPhase(parse(tokenize("let y = 1;")));
  badEnv.y = TDZ;
  if (badEnv.y === TDZ)
    throw new ReferenceError("Cannot access 'y' before initialization（TDZ）");
} catch (e) {
  console.log("ReferenceError（执行期抛出，前面的语句已执行）：", e.message);
}
