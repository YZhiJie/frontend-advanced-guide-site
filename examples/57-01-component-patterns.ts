/**
 * 57-01-component-patterns.ts —— Vue 3 组件模式设计范式
 * 运行方式: npx tsx examples/57-01-component-patterns.ts
 */

interface UserListProps {
  users: { id: number; name: string; email: string }[];
  loading: boolean;
  error: string | null;
  onSelect: (id: number) => void;
}

function renderUserList(props: UserListProps): string {
  if (props.loading) return '<div class="loading">加载中...</div>';
  if (props.error) return `<div class="error">${props.error}</div>`;
  return `<ul>${props.users
    .map((u) => `<li data-id="${u.id}">${u.name} · ${u.email}</li>`)
    .join("")}</ul>`;
}

interface UserService {
  fetchUsers(): Promise<{ id: number; name: string; email: string }[]>;
}

function createUserListContainer(service: UserService) {
  return {
    async mount(containerEl: { innerHTML: string }) {
      containerEl.innerHTML = renderUserList({
        users: [],
        loading: true,
        error: null,
        onSelect: () => {},
      });
      try {
        const users = await service.fetchUsers();
        containerEl.innerHTML = renderUserList({
          users,
          loading: false,
          error: null,
          onSelect: () => {},
        });
      } catch (e) {
        containerEl.innerHTML = renderUserList({
          users: [],
          loading: false,
          error: (e as Error).message,
          onSelect: () => {},
        });
      }
    },
  };
}

type PermissionChecker = (userRole: string, required: string) => boolean;

function withPermission<P extends { role: string }>(
  Component: (props: P) => string,
  requiredPerm: string,
  checker: PermissionChecker,
) {
  return (props: P): string => {
    if (!checker(props.role, requiredPerm)) {
      return `<div class="no-permission">🚫 无权限访问（需要: ${requiredPerm}）</div>`;
    }
    return Component(props);
  };
}

export type ThemeMode = "light" | "dark";
interface ThemeContext {
  theme: ThemeMode;
  toggle: () => void;
}

export function createThemeProvider(
  initial: ThemeMode = "light",
): ThemeContext {
  const ctx: ThemeContext = {
    theme: initial,
    toggle() {
      this.theme = this.theme === "light" ? "dark" : "light";
    },
  };
  return ctx;
}

interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
}

function renderTree(node: TreeNode, depth = 0): string {
  const indent = "  ".repeat(depth);
  let html = `${indent}<li>${node.label}</li>`;
  if (node.children?.length) {
    html += `${indent}<ul>\n${node.children
      .map((c) => renderTree(c, depth + 1))
      .join("\n")}\n${indent}</ul>`;
  }
  return html;
}

type TabKey = "overview" | "users" | "settings";
const tabComponents: Record<
  TabKey,
  (props: Record<string, unknown>) => string
> = {
  overview: () => "<div>📊 概览面板</div>",
  users: () => "<div>👥 用户管理</div>",
  settings: () => "<div>⚙️ 系统设置</div>",
};

function runTests() {
  // 模式 1:容器/展示
  const mockService: UserService = {
    fetchUsers: () =>
      Promise.resolve([
        { id: 1, name: "Alice", email: "alice@test.com" },
        { id: 2, name: "Bob", email: "bob@test.com" },
      ]),
  };
  const container = { innerHTML: "" };
  createUserListContainer(mockService)
    .mount(container)
    .then(() => {
      console.assert(
        container.innerHTML.includes("Alice"),
        "模式 1 应渲染用户列表",
      );
    });

  // 模式 2:HOC
  const UserBtn = (p: { role: string; label: string }) =>
    `<button>${p.label}</button>`;
  const AdminBtn = withPermission(
    UserBtn,
    "admin",
    (role, req) => role === req,
  );
  console.assert(
    AdminBtn({ role: "guest", label: "x" }).includes("无权限"),
    "模式 2:guest 被拦截",
  );
  console.assert(
    !AdminBtn({ role: "admin", label: "x" }).includes("无权限"),
    "模式 2:admin 通过",
  );

  // 模式 3:Provider
  const theme = createThemeProvider("light");
  theme.toggle();
  console.assert(theme.theme === "dark", "模式 3:主题切换");

  // 模式 4:递归
  const tree: TreeNode = {
    id: "1",
    label: "根目录",
    children: [
      { id: "2", label: "src", children: [{ id: "3", label: "main.ts" }] },
      { id: "4", label: "package.json" },
    ],
  };
  const treeHtml = renderTree(tree);
  console.assert(treeHtml.split("<ul>").length >= 2, "模式 4:递归多层 ul");

  // 模式 5:动态组件
  console.assert(
    tabComponents["overview"]({}).includes("📊"),
    "模式 5:动态组件渲染概览",
  );

  console.log("✅ 组件模式断言通过");
}

runTests();
