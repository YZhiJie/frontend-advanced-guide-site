// 文件: examples/01-37-regex-advanced.ts
// ============ 正则高级用法:贪婪惰性 / 分组 / 反向引用 / 四种零宽断言 / 组合实战 ============
// 运行:npx tsx examples/01-37-regex-advanced.ts
// 设计决策:全部用字面量正则 + 真实业务语料;唯一用 new RegExp 的是 ES2025 重复命名组(旧引擎会 SyntaxError,需特性检测)。
// 坑点提示:示例刻意保留"负向先行被回溯截尾"的输出来揭示机制,不要当成 bug。

export {};

const log = (title: string) => console.log(`\n---- ${title} ----`);

// ============ 1. 贪婪 vs 惰性:同一个量词,两种"吃到几口"策略 ============
log('1. 贪婪(先吃满再回吐) vs 惰性(满足即停)');

// 贪婪量词 * + ? {m,n}:先尽量多吃,匹配不下去再逐字符回吐(回溯)
// 惰性量词 *? +? ?? {m,n}?:刚好满足就停,多一个字符都不吃
const html = '<div><span>hi</span></div>';
console.log(html.match(/<.+>/)); // 贪婪:从 < 一路吃到整串最后一个 > → ['<div><span>hi</span></div>']
console.log(html.match(/<.+?>/)); // 惰性:见到第一个 > 就停 → ['<div>']

// 坑:贪婪 + 嵌套结构会"跨标签吞并";解析 HTML 请用 DOM API,正则只做行内简单切分。
// 性能坑:嵌套量词如 (a+)+b 遇到 "aaaa...c" 会指数级回溯(ReDoS),生产环境改写模式或限制长度。

// ============ 2. 分组三兄弟:捕获 () / 非捕获 (?:) / 命名 (?<name>) ============
log('2. 分组:捕获、非捕获、命名');

// 捕获组:把子表达式的结果存起来,match 结果按下标排(第 0 项是整体)
const dateM = '2026-10-18'.match(/^(\d{4})-(\d{2})-(\d{2})$/);
console.log('年:', dateM?.[1], '月:', dateM?.[2], '日:', dateM?.[3]);

// 非捕获组 (?:...):只分组不保存,不占 match 下标,语义也更清晰
console.log('不需要引用时优先非捕获:', 'jpg png gif'.match(/(?:jpg|png|gif)/g));

// 命名组 (?<name>...):结果挂在 m.groups,可读性远好于魔法下标
const rowM = '阿黄,28,杭州'.match(/^(?<name>[^,]+),(?<age>\d+),(?<city>[^,]+)$/);
console.log('命名组:', rowM?.groups); // { name: '阿黄', age: '28', city: '杭州' }

// matchAll + /g:遍历全部匹配,每项都带完整分组信息(exec 循环的现代替代品)
const attrRe = /(?<key>\w+)="(?<value>[^"]*)"/g;
for (const m of 'color="red" size="12"'.matchAll(attrRe)) {
    console.log(`属性 ${m.groups?.key} = ${m.groups?.value}`);
}

// ============ 3. 反向引用:\1 数字版 / \k<name> 命名版 / replace 里的 $1 ============
log('3. 反向引用:匹配"前面已经出现过的内容"');

// \1 引用的是第 1 组"实际匹配到的文本",不是把分组里的模式再匹配一遍
console.log('重复词:', 'ab-ab xyz-xyz'.match(/(\w+)-\1/g)); // ['ab-ab', 'xyz-xyz']

// 连续重复字符去重:aabbcc → abc
console.log('去重:', 'aabbcc'.replace(/(\w)\1+/g, '$1'));

// 经典场景:成对标签,要求开合标签名一致(错配的 <h2>…</b> 会被拒绝)
const paired = '<h2>标题</h2> <b>粗体</b> <h2>错配</b>'.match(/<(h[1-6]|b|i)>(.*?)<\/\1>/g);
console.log('成对标签:', paired); // ['<h2>标题</h2>', '<b>粗体</b>']

// \k<name>:命名组反向引用,长正则里比数字可读;引号必须前后配对
const quoteRe = /(?<q>["'])(?<text>[^"']+)\k<q>/g;
console.log('配对引号:', '"单引号" 和 \'双引号\''.match(quoteRe));

// replace 侧:$1/$<name> 引用捕获组重排文本
console.log('日期重排:', '2026-10-18'.replace(/(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1'));

// ============ 4. 零宽断言:只"看一眼",不"吃"任何字符 ============
log('4. 四种断言:?= ?! ?<= ?<!');

// (?=X) 正向先行:右侧必须是 X;(?!) 负向先行:右侧不能是 X
console.log('正向先行:', '100元 200$ 300元'.match(/\d+(?=元)/g)); // ['100', '300']
// 负向先行的坑:贪婪回溯会"截尾"——100 想躲开元,退到 10 就满足了
console.log('负向先行:', '100元 200$ 300元'.match(/\d+(?!元)/g)); // ['10', '200', '30']
// 千分位 = \B(非单词边界) + 先行断言的组合:位置右侧必须是完整的 3 位组
console.log('千分位:', '12345678'.replace(/\B(?=(\d{3})+(?!\d))/g, ',')); // 12,345,678

// (?<=X) 正向后行:左侧必须是 X;(?<!X) 负向后行:左侧不能是 X
console.log('正向后行:', 'USD$100 CNY¥88 EUR$30'.match(/(?<=\$)\d+/g)); // ['100', '30']
console.log('负向后行:', 'USD$100 CNY¥88'.match(/(?<!\$)\b\d+/g)); // ['88']

// JS 后行断言支持变长(多数语言只支持定长),可以写 ¥|RMB 这种多长度分支
console.log('变长后行:', '¥88 RMB88 $8'.match(/(?<=¥|RMB)\d+/g)); // ['88', '88']

// ============ 5. 组合实战:多个先行断言当"并列条件" ============
log('5. 组合:密码强度校验');

// 每个 (?=...) 都从同一个起点检查,等价于"同时满足"的多道关卡;(?!\S) 排除空格
const strongPwd = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?!.*\s)\S{8,}$/;
console.log('Abc12345:', strongPwd.test('Abc12345')); // true
console.log('abc12345(缺大写):', strongPwd.test('abc12345')); // false
console.log('Abc 1234(含空格):', strongPwd.test('Abc 1234')); // false

// 禁词场景:负向先行拦截"包含 password 字样"的组合(配合 i 标志连大小写变体一起拦)
const noBanned = /^(?=.*[a-z])(?=.*\d)(?!.*password)\w{8,}$/i;
console.log('abc12345xyz:', noBanned.test('abc12345xyz')); // true
console.log('myPassword1(含禁词):', noBanned.test('myPassword1')); // false

// ============ 6. 综合实战:迷你模板引擎(惰性 + 分组 + replace) ============
log('6. 综合:{{ 变量 }} 模板渲染');

// 惰性不是必须的,但 [\s\S]*? 这类写法是"跨行匹配 + 不越界"的标准姿势;\s* 兼容 {{ x }} 两种空格
const tpl = '你好,{{ user }}!今天是 {{ day }},余额 {{money}} 元。';
const render = (source: string, data: Record<string, string | number>) =>
    source.replace(/\{\{\s*(\w+)\s*\}\}/g, (_all: string, key: string) =>
        key in data ? String(data[key]) : `<缺失:${key}>`);
console.log(render(tpl, { user: '阿黄', day: '周六', money: 42 }));

// 反向引用进阶:markdown 粗/斜体,用命名组 + \k 要求开合符号一致(** 归 **,* 归 *)
const emRe = /(?<mark>\*\*|[*])(?<text>[^*]+)\k<mark>/g;
console.log('富文本:', '**加粗** 和 *斜体* 混排'.replace(emRe, '<em>$<text></em>'));

// ============ 7. ES2025 重复命名捕获组:同分支复用组名 ============
log('7. ES2025 重复命名捕获组(特性检测)');

// 同一分支内出现同名捕获组是 ES2025 新语法;实测 Node v24 仍抛 SyntaxError(Duplicate capture group name),必须探测后降级
try {
    const m = new RegExp('(?<year>\\d{4})-(?<year>\\d{2})|(?<year>[a-z]+)').exec('2026-10');
    console.log('重复命名组可用,year =', m?.groups); // 支持的引擎输出 { year: "10" }(后捕获覆盖先捕获)
} catch {
    console.log('当前引擎不支持重复命名捕获组(ES2025 前语法),走降级:用不同组名');
}
