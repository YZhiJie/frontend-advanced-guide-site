// 文件: examples/06-02-cors-front.ts —— 前端侧:withCredentials 与替代方案
// ============ 跨域的三种工程解法 ============

// 1. 服务端 CORS(生产标准方案,见上)
async function demoFetch() {
    return fetch('https://api.example.com/api/data', {
        credentials: 'include', // 跨域携带 Cookie(服务端必须配合 Allow-Credentials + 精确 Origin)
    });
}
void demoFetch; // 仅作示意,避免示例被直接运行时发起真实请求

// 2. 开发环境代理(Vite):浏览器以为同源,服务器之间没有同源策略
// vite.config.ts → server.proxy → '/api': { target: 'http://localhost:3000', changeOrigin: true }

// 3. Nginx 反向代理(生产):前后端同域部署,跨域问题根本不会出现
// location /api/ { proxy_pass http://backend:3000/; }

// 附:JSONP / postMessage 等老方案仅存于遗留系统,新项目不要使用
export {};
