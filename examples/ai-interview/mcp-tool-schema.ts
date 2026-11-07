// @ts-nocheck
// 文件: examples/ai-interview/mcp-tool-schema.ts —— MCP 工具 JSON Schema 契约与调用前校验
// 运行方式: 需先 npm i ajv（本示例仓库未安装，故加 @ts-nocheck）
// 关联文档: 21-frontend-ai-interview.md 21.4.3
import Ajv from 'ajv';

/**
 * 这是 MCP tools/list 返回的一个工具描述（节选）：
 * - inputSchema 是模型生成参数、前端表单、服务端执行三方共同的契约
 * - additionalProperties:false 防止模型幻觉出多余字段
 */
export const queryOrderTool = {
    name: 'query_order',
    description: '按订单号查询物流状态。仅可查询当前登录用户名下订单。',
    inputSchema: {
        type: 'object',
        properties: {
            orderId: { type: 'string', pattern: '^[A-Z]\\d{8,16}$' },
        },
        required: ['orderId'],
        additionalProperties: false,
    },
} as const;

const ajv = new Ajv({ strict: false });
const validate = ajv.compile(queryOrderTool.inputSchema);

/** 调用前的双重校验中的本地一环：非法参数不发往 Server，回喂模型自我修正或直接提示 */
export function safeCall(args: unknown): { orderId: string } {
    if (!validate(args)) {
        throw new Error(`工具参数非法: ${ajv.errorsText(validate.errors)}`);
    }
    return args as { orderId: string };
}

// ---- 配合 JSON-RPC 调用（节选）----
// const rpc = {
//     jsonrpc: '2.0',
//     id: 1,
//     method: 'tools/call',
//     params: { name: queryOrderTool.name, arguments: safeCall({ orderId: 'A1024' }) },
// };
//
// 工具清单维护：tools/list 结果本地缓存，收到 notifications/tools/list_changed 再增量更新。
