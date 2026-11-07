/**
 * 11-15 Module Federation 配置 —— 远端(提供方)与本地(消费方)两端
 * 配置文件片段,需放入 Rspack/Webpack5 项目;本文件为示意代码,以阅读理解为主。
 *
 * 设计决策:
 * 1. 远端 exposes 声明"暴露什么",本地 remotes 声明"用谁的什么" —— 远端可独立发版;
 * 2. shared 必须两端同时声明且 singleton —— 否则运行时出现双份框架实例;
 * 3. 消费侧必须用动态 import() —— 构建时该模块并不存在,由运行时容器解析。
 *
 * 坑点:
 * - 双实例症状:React 报 Invalid hook call / Vue 响应式对象跨实例不识别 —— 不报配置错误,
 *   只在运行时灵异发作,是最难排查的一类;
 * - remoteEntry.js 发布顺序要先于 host;回滚时 host 可能仍引用旧路径,要有版本对齐策略;
 * - MF 没有沙箱:全局变量与 CSS 都是共享的,命名空间要提前约定。
 */

// ============ 远端(提供方):把组件库/工具库"暴露"出去 ============
// rspack.config.js of remote(共享组件方)
const remoteConfig = {
    plugins: [
        {
            name: 'ModuleFederationPlugin',
            options: {
                name: 'shared_ui',
                filename: 'remoteEntry.js', // 对外入口,host 按此加载
                exposes: {
                    './Button': './src/components/Button.vue', // 暴露的模块路径:import('shared_ui/Button')
                    './useAuth': './src/composables/useAuth.ts',
                },
                shared: {
                    vue: { singleton: true, requiredVersion: '^3.4' }, // ⚠️ singleton:全站只允许一份 Vue 实例
                }, //    否则两个 Vue 实例互不识别响应式对象
            },
        },
    ],
};

// ============ 本地(消费方):声明"我要用谁的什么" ============
const hostConfig = {
    plugins: [
        {
            name: 'ModuleFederationPlugin',
            options: {
                name: 'host_app',
                remotes: {
                    shared_ui: 'shared_ui@https://cdn.example.com/remoteEntry.js', // 远端可独立发版
                },
                shared: { vue: { singleton: true } },
            },
        },
    ],
};

// 消费代码:运行时异步加载(必须动态 import,构建时不存在)
// const Button = defineAsyncComponent(() => import('shared_ui/Button'));

module.exports = { remoteConfig, hostConfig };
