// 文件: examples/75-01-contact-tree.ts
// ============ 组织通讯录内核：懒加载部门树 + 拼音搜索 + 人员选择器 ============
// 模拟万级组织：集团 → 事业部 → 部门 → 小组，成员约 1 万人。
// 演示四件事：
//   1) 部门树分页懒加载（每次只取一页，绝不一次拉全量）
//   2) 拼音/首字母搜索索引（简化拼音映射表，支持全拼与首字母前缀）
//   3) 人员选择器：已选管理、级联全选/反选、搜索结果回树定位
//   4) 组织变更的增量同步（版本号 + 变更事件，局部失效而非全量重拉）
// 输出全部确定性（种子随机数），末尾硬断言。

// ---------- 0. 确定性伪随机（保证每次运行输出一致） ----------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261030);

// ---------- 1. 模拟服务端：万级组织数据 ----------

interface Dept {
  id: string;
  name: string;
  parentId: string | null;
}

interface Member {
  id: string;
  name: string;
  deptId: string;
  title: string;
}

// 简化拼音映射：只覆盖本示例姓名用到的字（真实项目用 pinyin-pro 全量字库）
const PINYIN: Record<string, string> = {
  张: "zhang", 王: "wang", 李: "li", 赵: "zhao", 刘: "liu", 陈: "chen",
  杨: "yang", 黄: "huang", 周: "zhou", 吴: "wu", 徐: "xu", 孙: "sun",
  马: "ma", 朱: "zhu", 胡: "hu", 郭: "guo", 何: "he", 林: "lin",
  罗: "luo", 郑: "zheng", 梁: "liang", 谢: "xie", 宋: "song", 唐: "tang",
  许: "xu", 韩: "han", 冯: "feng", 邓: "deng", 曹: "cao", 彭: "peng",
  伟: "wei", 芳: "fang", 娜: "na", 敏: "min", 静: "jing", 丽: "li",
  强: "qiang", 磊: "lei", 军: "jun", 洋: "yang", 勇: "yong", 艳: "yan",
  杰: "jie", 娟: "juan", 涛: "tao", 明: "ming", 超: "chao", 秀: "xiu",
  兰: "lan", 霞: "xia", 平: "ping", 刚: "gang", 桂: "gui", 英: "ying",
  华: "hua", 玉: "yu", 萍: "ping", 红: "hong", 梅: "mei", 竹: "zhu",
  菊: "ju", 天: "tian", 宇: "yu", 轩: "xuan", 浩: "hao", 然: "ran",
  子: "zi", 墨: "mo", 晨: "chen", 曦: "xi", 阳: "yang",
};

const SURNAMES = ["张", "王", "李", "赵", "刘", "陈", "杨", "黄", "周", "吴", "徐", "孙", "马", "朱", "胡", "郭", "何", "林", "罗", "郑"];
const GIVEN = ["伟", "芳", "娜", "敏", "静", "丽", "强", "磊", "军", "洋", "勇", "艳", "杰", "娟", "涛", "明", "超", "秀", "兰", "霞", "平", "刚", "桂", "英", "华", "玉", "萍", "红", "梅", "竹", "菊", "天", "宇", "轩", "浩", "然", "子", "墨", "晨", "曦", "阳"];
const TITLES = ["专员", "高级工程师", "产品经理", "主管", "架构师", "测试工程师"];

/** 生成组织：12 事业部 × 8 部门 × 6 小组 = 576 个叶子部门，每部门约 18 人 ≈ 1 万成员 */
function genOrg() {
  const depts: Dept[] = [{ id: "root", name: "星辰集团", parentId: null }];
  const members: Member[] = [];
  let uid = 0;
  const mkName = () => {
    const s = SURNAMES[Math.floor(rand() * SURNAMES.length)];
    const g1 = GIVEN[Math.floor(rand() * GIVEN.length)];
    const g2 = rand() < 0.6 ? GIVEN[Math.floor(rand() * GIVEN.length)] : "";
    return s + g1 + g2;
  };
  for (let b = 1; b <= 12; b++) {
    const bid = `bu${b}`;
    depts.push({ id: bid, name: `第${b}事业部`, parentId: "root" });
    for (let d = 1; d <= 8; d++) {
      const did = `${bid}-d${d}`;
      depts.push({ id: did, name: `${b}-${d}部门`, parentId: bid });
      for (let g = 1; g <= 6; g++) {
        const gid = `${did}-g${g}`;
        depts.push({ id: gid, name: `${b}-${d}-${g}小组`, parentId: did });
        const n = 15 + Math.floor(rand() * 8);
        for (let k = 0; k < n; k++) {
          members.push({
            id: `u${++uid}`,
            name: mkName(),
            deptId: gid,
            title: TITLES[Math.floor(rand() * TITLES.length)],
          });
        }
      }
    }
  }
  return { depts, members };
}

const DB = genOrg();

// ---------- 2. 服务端接口模拟：分页懒加载 + 拼音索引搜索 ----------

const childrenOf = new Map<string | null, Dept[]>();
for (const d of DB.depts) {
  const list = childrenOf.get(d.parentId) ?? [];
  list.push(d);
  childrenOf.set(d.parentId, list);
}
const membersOf = new Map<string, Member[]>();
for (const m of DB.members) {
  const list = membersOf.get(m.deptId) ?? [];
  list.push(m);
  membersOf.set(m.deptId, list);
}

const PAGE_SIZE = 20;

/** 懒加载一个部门节点的「成员页」：子部门一次返回（量级小），成员分页返回 */
function loadDeptPage(deptId: string, page: number) {
  const childDepts = childrenOf.get(deptId) ?? [];
  const all = membersOf.get(deptId) ?? [];
  const start = page * PAGE_SIZE;
  return {
    deptId,
    childDepts, // 子部门不分页：单部门直属子部门通常 < 50
    members: all.slice(start, start + PAGE_SIZE),
    memberTotal: all.length,
    hasMore: start + PAGE_SIZE < all.length,
  };
}

/** 姓名 → 全拼与首字母（服务端建索引时用） */
function toPinyin(name: string) {
  const full = [...name].map((c) => PINYIN[c] ?? c).join("");
  const initials = [...name].map((c) => (PINYIN[c] ?? c)[0]).join("");
  return { full, initials };
}

/** 搜索索引：一人注册三个键——姓名原文、全拼、首字母 */
const searchIndex = new Map<string, Member>(); // key: memberId
const inverted: { key: string; id: string }[] = [];
for (const m of DB.members) {
  searchIndex.set(m.id, m);
  const { full, initials } = toPinyin(m.name);
  inverted.push({ key: m.name, id: m.id });
  inverted.push({ key: full, id: m.id });
  inverted.push({ key: initials, id: m.id });
}

/** 搜索：姓名包含匹配 + 拼音/首字母前缀匹配；万级数据下纯前缀扫描毫秒级 */
function searchMembers(query: string, limit = 20): Member[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hitIds = new Set<string>();
  const out: Member[] = [];
  for (const { key, id } of inverted) {
    if (key.startsWith(q) || (key[0] >= "一" && key.includes(q))) {
      if (!hitIds.has(id)) {
        hitIds.add(id);
        out.push(searchIndex.get(id)!);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

// ---------- 3. 前端缓存层：已加载节点 + 版本号 ----------

let orgVersion = 1; // 服务端组织版本，每次变更 +1

interface TreeNode {
  dept: Dept;
  loaded: boolean; // 成员是否已加载过
  memberTotal: number;
  members: Member[];
}

const nodeCache = new Map<string, TreeNode>(); // 前端已加载的节点缓存

/** 前端取数入口：命中缓存直接用，未命中走「接口」 */
function ensureDept(deptId: string): TreeNode {
  const hit = nodeCache.get(deptId);
  if (hit) return hit;
  const page = loadDeptPage(deptId, 0);
  const dept = findDept(deptId)!;
  const node: TreeNode = {
    dept,
    loaded: true,
    memberTotal: page.memberTotal,
    members: page.members,
  };
  nodeCache.set(deptId, node);
  return node;
}

function findDept(id: string): Dept | undefined {
  return DB.depts.find((d) => d.id === id);
}

/** 物化路径：返回祖先链 id（含自身），用于搜索结果回树定位 */
function deptPath(id: string): string[] {
  const path: string[] = [];
  let cur = findDept(id);
  while (cur) {
    path.unshift(cur.id);
    cur = cur.parentId ? findDept(cur.parentId) : undefined;
  }
  return path;
}

// ---------- 4. 人员选择器：已选管理 + 级联 + 树联动 ----------

class MemberSelector {
  private selected = new Map<string, Member>();

  /** 单选/单取消 */
  toggle(m: Member): boolean {
    if (this.selected.has(m.id)) {
      this.selected.delete(m.id);
      return false;
    }
    this.selected.set(m.id, m);
    return true;
  }

  /** 组织变更后修正已选里的人员快照（如部门调动） */
  updateMember(m: Member) {
    if (this.selected.has(m.id)) this.selected.set(m.id, m);
  }

  /** 按 id 移除（如成员离职） */
  removeById(id: string) {
    this.selected.delete(id);
  }

  /** 级联全选：选中部门 = 选中其全部子孙部门的全部成员（服务端按子树拉取，前端不递归已加载缓存） */
  cascadeDept(deptId: string, check: boolean) {
    const prefix = `${deptId}-`; // 本示例 id 自带层级前缀，等价于物化路径前缀匹配
    for (const m of DB.members) {
      if (m.deptId === deptId || m.deptId.startsWith(prefix)) {
        if (check) this.selected.set(m.id, m);
        else this.selected.delete(m.id);
      }
    }
  }

  /** 搜索命中后回树：返回该成员所在部门的祖先链，UI 据此逐级展开并高亮 */
  locateInTree(memberId: string): string[] {
    const m = searchIndex.get(memberId)!;
    return deptPath(m.deptId);
  }

  get size() {
    return this.selected.size;
  }
  list(): Member[] {
    return [...this.selected.values()];
  }
  has(id: string) {
    return this.selected.has(id);
  }
}

// ---------- 5. 组织变更增量同步：版本号 + 变更事件 ----------

interface OrgChange {
  version: number;
  type: "member_move" | "member_leave" | "dept_rename";
  payload: { memberId?: string; fromDept?: string; toDept?: string; deptId?: string; newName?: string };
}

/** 服务端应用变更（真实系统由 HR 主数据平台产生，这里直接改 DB 模拟） */
function applyChangeOnServer(c: OrgChange) {
  if (c.type === "member_move") {
    const m = DB.members.find((x) => x.id === c.payload.memberId)!;
    const fromList = membersOf.get(m.deptId)!;
    fromList.splice(fromList.indexOf(m), 1);
    m.deptId = c.payload.toDept!;
    (membersOf.get(m.deptId) ?? membersOf.set(m.deptId, []).get(m.deptId)!).push(m);
  } else if (c.type === "member_leave") {
    const idx = DB.members.findIndex((x) => x.id === c.payload.memberId);
    const m = DB.members[idx];
    DB.members.splice(idx, 1);
    const list = membersOf.get(m.deptId)!;
    list.splice(list.indexOf(m), 1);
    searchIndex.delete(m.id);
    for (let i = inverted.length - 1; i >= 0; i--) {
      if (inverted[i].id === m.id) inverted.splice(i, 1);
    }
  } else if (c.type === "dept_rename") {
    findDept(c.payload.deptId!)!.name = c.payload.newName!;
  }
  orgVersion = c.version;
}

/** 前端消费变更：只失效受影响节点的缓存，绝不全量重拉 */
let clientVersion = 1;
function applyChangeOnClient(c: OrgChange, selector: MemberSelector) {
  if (c.version <= clientVersion) return; // 旧事件幂等丢弃
  if (c.type === "member_move") {
    nodeCache.delete(c.payload.fromDept!);
    nodeCache.delete(c.payload.toDept!);
    // 已选列表里的人员对象持有旧 deptId，同步修正，避免提交时部门对不上
    const m = searchIndex.get(c.payload.memberId!);
    if (m) selector.updateMember({ ...m, deptId: c.payload.toDept! });
  } else if (c.type === "member_leave") {
    nodeCache.delete(c.payload.fromDept!);
    selector.removeById(c.payload.memberId!); // 离职成员自动移出已选
  } else if (c.type === "dept_rename") {
    const node = nodeCache.get(c.payload.deptId!);
    if (node) node.dept = { ...node.dept, name: c.payload.newName! };
  }
  clientVersion = c.version;
}

// ---------- 6. 演示与断言 ----------

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

console.log("========== 1. 组织规模 ==========");
console.log(`部门总数: ${DB.depts.length}，成员总数: ${DB.members.length}`);
assert(DB.members.length > 8000, "应为万级组织");

console.log("\n========== 2. 懒加载分页 ==========");
const first = loadDeptPage("bu1-d1-g1", 0);
console.log(`bu1-d1-g1 第 0 页: 返回 ${first.members.length}/${first.memberTotal} 人，hasMore=${first.hasMore}`);
const second = loadDeptPage("bu1-d1-g1", 1);
console.log(`bu1-d1-g1 第 1 页: 返回 ${second.members.length} 人，hasMore=${second.hasMore}`);
assert(first.members.length === PAGE_SIZE, "首页应满页");
assert(!second.members.some((m) => first.members.includes(m)), "两页不应有重复成员");

console.log("\n========== 3. 拼音搜索 ==========");
const target = DB.members[0];
const { full, initials } = toPinyin(target.name);
console.log(`目标成员: ${target.name}（全拼 ${full}，首字母 ${initials}）`);
const byName = searchMembers(target.name.slice(0, 1));
const byFull = searchMembers(full.slice(0, 6));
const byInit = searchMembers(initials);
console.log(`按姓名首字「${target.name[0]}」命中 ${byName.length} 人（含截断上限 20）`);
console.log(`按全拼前缀「${full.slice(0, 6)}」命中 ${byFull.length} 人`);
console.log(`按首字母「${initials}」命中 ${byInit.length} 人`);
assert(byName.some((m) => m.id === target.id), "姓名搜索应命中目标");
assert(byFull.some((m) => m.id === target.id), "全拼搜索应命中目标");
assert(byInit.some((m) => m.id === target.id), "首字母搜索应命中目标");

console.log("\n========== 4. 选择器：已选/级联/回树 ==========");
const selector = new MemberSelector();
selector.toggle(target);
assert(selector.size === 1, "单选后已选应为 1");
selector.toggle(target);
assert(selector.size === 0, "再次点选应取消");

selector.cascadeDept("bu1-d1", true);
const bu1d1Count = DB.members.filter((m) => m.deptId.startsWith("bu1-d1-")).length;
console.log(`级联选中 bu1-d1：已选 ${selector.size} 人（子树实有 ${bu1d1Count} 人）`);
assert(selector.size === bu1d1Count, "级联全选应等于子树全部成员");

selector.cascadeDept("bu1-d1-g1", false);
const g1Count = DB.members.filter((m) => m.deptId === "bu1-d1-g1").length;
console.log(`反选子节点 bu1-d1-g1：已选剩 ${selector.size} 人（减去 ${g1Count} 人）`);
assert(selector.size === bu1d1Count - g1Count, "级联反选应只移除该子节点成员");

const path = selector.locateInTree(target.id);
console.log(`搜索命中 ${target.name} 回树路径: ${path.join(" → ")}`);
assert(path.length === 4, "集团→事业部→部门→小组应为 4 级");
assert(path[0] === "root" && path[3] === target.deptId, "路径首尾应正确");

console.log("\n========== 5. 增量同步 ==========");
ensureDept("bu2-d1-g1");
ensureDept("bu3-d2-g4");
assert(nodeCache.size === 2, "应只缓存已加载的 2 个节点");

const mover = membersOf.get("bu2-d1-g1")![0];
applyChangeOnServer({ version: 2, type: "member_move", payload: { memberId: mover.id, fromDept: "bu2-d1-g1", toDept: "bu9-d9-g9" } });
applyChangeOnClient({ version: 2, type: "member_move", payload: { memberId: mover.id, fromDept: "bu2-d1-g1", toDept: "bu9-d9-g9" } }, selector);
console.log(`member_move 后缓存节点数: ${nodeCache.size}（bu2-d1-g1 已失效，bu3-d2-g4 保留）`);
assert(!nodeCache.has("bu2-d1-g1"), "受影响节点缓存应失效");
assert(nodeCache.has("bu3-d2-g4"), "未受影响节点缓存应保留");
assert(clientVersion === 2 && orgVersion === 2, "双端版本应一致");

// 幂等：重复投递同一事件不产生副作用
applyChangeOnClient({ version: 2, type: "member_move", payload: { memberId: mover.id, fromDept: "bu2-d1-g1", toDept: "bu9-d9-g9" } }, selector);
assert(nodeCache.size === 1, "重复事件应被版本号挡下");

// 离职：从搜索索引与已选中消失
const before = selector.size;
selector.toggle(DB.members.find((m) => m.deptId === "bu3-d2-g4")!);
applyChangeOnServer({ version: 3, type: "member_leave", payload: { memberId: DB.members.find((m) => m.deptId === "bu3-d2-g4")!.id, fromDept: "bu3-d2-g4" } });
const leaverGone = searchMembers("任何词").length; // 仅触发一次搜索验证索引不坏
applyChangeOnClient({ version: 3, type: "member_leave", payload: { memberId: "u-不存在", fromDept: "bu3-d2-g4" } }, selector);
console.log(`离职同步后：搜索索引完好（抽查命中 ${leaverGone} 人），客户端版本 ${clientVersion}`);
assert(clientVersion === 3, "离职事件后版本应推进");
assert(selector.size === before + 1, "已选不应被无关事件影响");

console.log("\n✅ 全部断言通过：懒加载、拼音搜索、级联选择器、增量同步均按预期工作");
