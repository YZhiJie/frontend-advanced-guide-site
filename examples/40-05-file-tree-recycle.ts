// 文件: examples/40-05-file-tree-recycle.ts
// ============ 文件树与回收站：路径、冲突、软删除 ============
// 网盘的文件管理三个核心机制：
// 1) 树结构：节点挂 parentId，路径由祖先链拼接；防环（不能把自己移进自己的子孙）；
// 2) 冲突策略：同目录重名 → 重命名后缀（"file(1).txt"）或提示用户选择；
// 3) 回收站：软删除（标 deleted 保留数据），恢复时若原名被占 → 自动改名落地；
//    彻底删除（purge）才真正清数据。

export interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  parentId: string | null; // null = 根
  size: number;
  deleted?: boolean; // 软删除标记
}

export class DriveStore {
  private nodes = new Map<string, FileNode>();
  private seq = 0;

  add(
    name: string,
    type: "file" | "folder",
    parentId: string | null = null,
    size = 0,
  ): FileNode {
    const node: FileNode = { id: `n${++this.seq}`, name, type, parentId, size };
    this.nodes.set(node.id, node);
    return node;
  }

  /** 路径解析：/a/b/c.txt → 节点链；pathExists 判断冲突 */
  pathOf(id: string): string {
    const parts: string[] = [];
    let cur = this.nodes.get(id);
    while (cur) {
      parts.unshift(cur.name);
      cur = cur.parentId ? this.nodes.get(cur.parentId) : undefined;
    }
    return "/" + parts.join("/");
  }

  /** 同目录重名检测（只看未删除节点） */
  nameTaken(parentId: string | null, name: string): boolean {
    return [...this.nodes.values()].some(
      (n) => !n.deleted && n.parentId === parentId && n.name === name,
    );
  }

  /** 自动改名：file.txt → file(1).txt → file(2).txt */
  uniqueName(parentId: string | null, name: string): string {
    if (!this.nameTaken(parentId, name)) return name;
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let i = 1; ; i++) {
      const candidate = `${base}(${i})${ext}`;
      if (!this.nameTaken(parentId, candidate)) return candidate;
    }
  }

  /** 移动：防环——目标不能是自己或自己的子孙 */
  move(
    id: string,
    targetParentId: string | null,
  ): { ok: boolean; reason?: string } {
    const node = this.nodes.get(id)!;
    if (node.type !== "folder") return this.doMove(id, targetParentId);
    let cur: FileNode | undefined = targetParentId
      ? this.nodes.get(targetParentId)
      : undefined;
    while (cur) {
      if (cur.id === id)
        return {
          ok: false,
          reason: `不能把文件夹移动到自己的子目录（${node.name} → ${this.pathOf(targetParentId!)}）`,
        };
      cur = cur.parentId ? this.nodes.get(cur.parentId) : undefined;
    }
    return this.doMove(id, targetParentId);
  }

  private doMove(id: string, targetParentId: string | null): { ok: boolean } {
    const node = this.nodes.get(id)!;
    const finalName = this.uniqueName(targetParentId, node.name); // 移动也可能撞名
    node.parentId = targetParentId;
    node.name = finalName;
    return { ok: true };
  }

  /** 软删除：进回收站（子节点级联标记） */
  softDelete(id: string): number {
    let count = 0;
    const mark = (nid: string): void => {
      const n = this.nodes.get(nid)!;
      n.deleted = true;
      count++;
      for (const child of this.childrenOf(nid, true)) mark(child.id);
    };
    mark(id);
    return count;
  }

  /** 恢复：原名被占则自动改名 */
  restore(id: string): string {
    const node = this.nodes.get(id)!;
    node.deleted = false;
    node.name = this.uniqueName(node.parentId, node.name);
    // 子节点级联恢复（教学简化：全恢复）
    for (const child of this.childrenOf(id, true)) this.restore(child.id);
    return node.name;
  }

  /** 彻底删除：从 Map 清除 */
  purge(id: string): void {
    for (const child of this.childrenOf(id, true)) this.purge(child.id);
    this.nodes.delete(id);
  }

  private childrenOf(parentId: string, includeDeleted: boolean): FileNode[] {
    return [...this.nodes.values()].filter(
      (n) => n.parentId === parentId && (includeDeleted || !n.deleted),
    );
  }

  list(includeDeleted = false): string[] {
    return [...this.nodes.values()]
      .filter((n) => includeDeleted || !n.deleted)
      .map((n) => `${this.pathOf(n.id)}${n.deleted ? " [回收站]" : ""}`);
  }
}

// ---------------- 验证 ----------------

const drive = new DriveStore();
const projects = drive.add("项目", "folder");
const docs = drive.add("文档", "folder");
const a = drive.add("需求.pdf", "file", projects.id, 1024);

console.log("=== 建树与路径 ===");
console.log(drive.list());

console.log("\n=== 重名自动改名 ===");
const a2 = drive.add("需求.pdf", "file", projects.id, 2048);
console.log("第二个 需求.pdf 落地名:", a2.name);

console.log("\n=== 移动与防环 ===");
console.log("移动 文档 → 项目:", drive.move(docs.id, projects.id).ok);
console.log(
  "尝试把 项目 移进自己的子目录 文档:",
  drive.move(projects.id, docs.id),
);
console.log(drive.pathOf(docs.id));

console.log("\n=== 回收站：软删除 → 恢复改名 ===");
console.log("删除 需求.pdf(原版):", drive.softDelete(a.id), "个节点进回收站");
console.log(drive.list());
const restoredName = drive.restore(a.id);
console.log("恢复落地名:", restoredName, "（原名被 a2 占用 → 自动改名）");
