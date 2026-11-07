// 文件: examples/19-06-file-utils.ts
// ============ 文件三件套:大小/类型校验、浏览器下载、复制到剪贴板 ============

/** File 的最小结构形状(不依赖 DOM 也能在校验函数里复用与单测) */
export interface FileLike {
    name: string;
    size: number;
    type: string;
}

/** 人类可读的文件大小:1536 -> '1.50 KB',5*1024*1024 -> '5 MB' */
export function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** exponent;
    // B 与整数不带小数;非整数保留 2 位,避免 1.5 KB 显示成 1.5000...
    const digits = exponent === 0 || Number.isInteger(value) ? 0 : 2;
    return `${value.toFixed(digits)} ${units[exponent]}`;
}

export interface FileRule {
    /**
     * 允许的类型,同时支持:
     * - 扩展名:'.png,.jpg'
     * - MIME 精确值:'application/pdf'
     * - MIME 通配:'image/*'
     */
    accept?: string[];
    /** 最大字节数 */
    maxSize?: number;
}

/**
 * 校验文件,通过返回 null,不通过返回面向用户的错误信息。
 * ⚠️ 扩展名与 type 都不可信(用户可改后缀),真正的安全校验必须在服务端做,
 * 前端这层只是体验优化与流量拦截。
 */
export function validateFile(file: FileLike, rule: FileRule): string | null {
    if (rule.maxSize !== undefined && file.size > rule.maxSize) {
        return `文件大小不能超过 ${formatBytes(rule.maxSize)}`;
    }
    const accept = rule.accept?.map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (accept && accept.length > 0) {
        const ext = '.' + file.name.split('.').pop()!.toLowerCase();
        const mime = file.type.toLowerCase();
        const matched = accept.some((item) => {
            if (item.startsWith('.')) return ext === item; // 扩展名匹配
            if (item.endsWith('/*')) return mime.startsWith(item.slice(0, -1)); // image/* 类前缀匹配
            return mime === item; // 精确 MIME 匹配
        });
        if (!matched) return `仅支持 ${accept.join('、')} 格式`;
    }
    return null;
}

/**
 * 浏览器下载:Blob/File 走对象 URL,字符串直接当 URL 用。
 * ⚠️ revokeObjectURL 必须延迟一轮事件循环:同步撤销会导致刚触发的下载拿到空内容。
 */
export function download(source: Blob | string, filename: string): void {
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor); // Firefox 要求挂载后才可点击
    anchor.click();
    anchor.remove();
    if (typeof source !== 'string') {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}

/**
 * 复制文本到剪贴板:优先 Clipboard API(需要 HTTPS 或 localhost),
 * 失败/非安全上下文降级到 textarea + execCommand(已废弃但仍是最可靠的兜底)。
 */
export async function copyText(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // 权限被拒或非安全上下文,走降级方案
        }
    }
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        textarea.remove();
        return ok;
    } catch {
        return false;
    }
}

// ---------------- 验证(只跑纯逻辑部分,DOM 函数在页面里调用) ----------------

// ---- 大小格式化 ----
console.log(formatBytes(0)); // '0 B'
console.log(formatBytes(1536)); // '1.50 KB'
console.log(formatBytes(5 * 1024 * 1024)); // '5 MB'
console.log(formatBytes(2_500_000_000)); // '2.33 GB'

// ---- 类型与大小校验 ----
const rule: FileRule = { accept: ['.png', '.jpg', 'image/*', 'application/pdf'], maxSize: 5 * 1024 * 1024 };
console.log(validateFile({ name: '头像.PNG', size: 1024, type: 'image/png' }, rule)); // null(扩展名大小写不敏感)
console.log(validateFile({ name: '照片.jpg', size: 1024, type: 'image/jpeg' }, rule)); // null(MIME 走 image/*)
console.log(validateFile({ name: '合同.pdf', size: 1024, type: 'application/pdf' }, rule)); // null
console.log(validateFile({ name: '病毒.exe', size: 1024, type: 'application/x-msdownload' }, rule));
// '仅支持 .png、.jpg、image/*、application/pdf 格式'
console.log(validateFile({ name: '超大.zip', size: 99 * 1024 * 1024, type: 'application/zip' }, rule));
// '文件大小不能超过 5 MB'

// 浏览器里这样用:
// const err = validateFile(input.files[0], rule);
// if (err) toast(err); else await upload(input.files[0]);
// const blob = await (await fetch('/api/export')).blob();
// download(blob, `报表_${Date.now()}.xlsx`);
// await copyText('INV-20261001-001'); // 复制订单号
