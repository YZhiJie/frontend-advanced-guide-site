/**
 * 03-monorepo-toolkit 的 node:* 模块浏览器 mock：
 * topo.ts 依赖 node:fs/promises + node:path，run-tasks.ts 依赖 node:child_process。
 * demo 用 esbuild alias 把这三个说明符替换到本目录，在浏览器里演示同一套算法。
 *
 * 虚拟文件树由 demo 通过 setVirtualWorkspace() 注入。
 */

let tree: Record<string, string> = {};

/** demo 侧注入虚拟 workspace：键为路径，值为文件内容 */
export function setVirtualWorkspace(files: Record<string, string>): void {
  tree = files;
}

export function resetVirtualWorkspace(): void {
  tree = {};
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

export function readFile(path: string, _enc?: string): Promise<string> {
  if (path in tree) return Promise.resolve(tree[path]!);
  return Promise.reject(new Error(`ENOENT: no such file, open '${path}'`));
}

export async function readdir(
  dir: string,
  opts?: { withFileTypes?: boolean },
): Promise<Array<{ name: string; isDirectory(): boolean } | string>> {
  const seen = new Set<string>();
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  for (const p of Object.keys(tree)) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (!rest) continue;
    const name = rest.split("/")[0]!;
    seen.add(name);
  }
  const names = [...seen].sort();
  if (opts?.withFileTypes)
    return names.map((name) => ({
      name,
      isDirectory: () =>
        Object.keys(tree).some((p) => p.startsWith(`${prefix}${name}/`)),
    }));
  return names;
}

// ---------- node:path（posix 语义的纯字符串实现） ----------

export function join(...parts: string[]): string {
  const segs: string[] = [];
  for (const part of parts) {
    for (const s of part.split("/")) {
      if (!s || s === ".") continue;
      if (s === "..") segs.pop();
      else segs.push(s);
    }
  }
  return "/" + segs.join("/");
}

export function resolve(...parts: string[]): string {
  const abs = parts.find((p) => p.startsWith("/"));
  return abs ? join(...parts.slice(parts.indexOf(abs))) : join(...parts);
}

export { dirname, basename };

// ---------- node:child_process（记录命令，不真执行） ----------

export interface MockChildProcess {
  killed: boolean;
  /** 与 node ChildProcess 对齐的最小事件面（demo 只记录不真执行） */
  on(_event: string, _cb: (...args: unknown[]) => void): this;
  kill(): void;
}

export interface SpawnRecord {
  cmd: string;
  args: string[];
  cwd?: string;
}

export const spawnLog: SpawnRecord[] = [];

export function spawn(
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
): MockChildProcess {
  spawnLog.push({ cmd, args, cwd: opts?.cwd });
  return {
    killed: false,
    on() {
      return this;
    },
    kill() {},
  };
}
