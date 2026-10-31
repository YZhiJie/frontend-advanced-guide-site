// 文件: examples/19-01-form-validation.ts
// ============ 声明式表单校验:规则工厂 + 全量校验 + 单字段校验 ============
// 设计要点:
// 1) 规则是数据不是 if-else —— 表单长什么样,schema 就长什么样,可后端下发/跨端复用;
// 2) 每条规则独立返回错误信息,单字段只报第一个错误(避免一屏红字),整表收集全部字段错误;
// 3) 纯函数、零 DOM 依赖,React/Vue/小程序任意框架都能接。

export type FormData = Record<string, unknown>;

/** 一条校验规则:validate 返回 true 表示通过 */
export interface FieldRule {
    message: string;
    validate: (value: unknown, form: FormData) => boolean;
}

/** 字段名 -> 规则数组(按数组顺序短路,第一条失败即其错误信息) */
export type FormSchema = Record<string, FieldRule[]>;

export type FormErrors = Record<string, string>;

// ---------------- 规则工厂(覆盖 90% 业务表单) ----------------

/** 必填:null/undefined/空串/空数组视为空,但 0 与 false 是合法值 */
export function required(message = '该项必填'): FieldRule {
    return {
        message,
        validate: (v) => {
            if (Array.isArray(v)) return v.length > 0;
            return v !== undefined && v !== null && v !== '';
        },
    };
}

/** 字符串长度闭区间(自动 trim,中文按字符数而非字节数) */
export function length(min: number, max: number, message?: string): FieldRule {
    return {
        message: message ?? `长度需在 ${min}~${max} 个字符之间`,
        validate: (v) => {
            const len = String(v ?? '').trim().length;
            return len >= min && len <= max;
        },
    };
}

/** 正则规则(手机号/邮箱/统一社会信用代码等都走它) */
export function pattern(re: RegExp, message: string): FieldRule {
    return { message, validate: (v) => re.test(String(v ?? '')) };
}

/** 数值范围 */
export function range(min: number, max: number, message?: string): FieldRule {
    return {
        message: message ?? `数值需在 ${min}~${max} 之间`,
        validate: (v) => {
            const n = Number(v);
            return Number.isFinite(n) && n >= min && n <= max;
        },
    };
}

/** 与另一字段相等(确认密码/确认邮箱场景) */
export function equalTo(otherKey: string, label: string, message?: string): FieldRule {
    return {
        message: message ?? `两次输入的${label}不一致`,
        validate: (v, form) => v === form[otherKey],
    };
}

/** 必须勾选(协议同意场景) */
export function mustBeTrue(message = '请先勾选同意'): FieldRule {
    return { message, validate: (v) => v === true };
}

/** 自定义规则逃生舱 */
export function custom(
    predicate: (value: unknown, form: FormData) => boolean,
    message: string,
): FieldRule {
    return { message, validate: predicate };
}

// ---------------- 校验引擎 ----------------

/** 校验单个字段:返回第一条失败规则的错误信息,全部通过返回空串 */
export function validateField(key: string, form: FormData, schema: FormSchema): string {
    const rules = schema[key] ?? [];
    for (const rule of rules) {
        if (!rule.validate(form[key], form)) return rule.message;
    }
    return '';
}

/**
 * 校验整张表单(提交时用):
 * 每个字段都会被校验(不短路),返回 { valid, errors },方便一次性渲染所有字段的红字。
 */
export function validateForm(form: FormData, schema: FormSchema): { valid: boolean; errors: FormErrors } {
    const errors: FormErrors = {};
    for (const key of Object.keys(schema)) {
        const msg = validateField(key, form, schema);
        if (msg) errors[key] = msg;
    }
    return { valid: Object.keys(errors).length === 0, errors };
}

// ---------------- 示例:注册表单 schema ----------------

const phoneRE = /^1[3-9]\d{9}$/;

const registerSchema: FormSchema = {
    phone: [required('请输入手机号'), pattern(phoneRE, '手机号格式不正确')],
    code: [required('请输入验证码'), length(6, 6, '验证码为 6 位数字')],
    password: [
        required('请输入密码'),
        length(8, 20, '密码长度需在 8~20 位之间'),
        pattern(/(?=.*[a-zA-Z])(?=.*\d)/, '密码需同时包含字母与数字'),
    ],
    confirmPassword: [required('请再次输入密码'), equalTo('password', '密码')],
    age: [required('请输入年龄'), range(18, 99, '仅接受 18~99 岁用户注册')],
    agreement: [mustBeTrue('请阅读并同意用户协议')],
};

// ---- 验证 1:一份"全错"的表单,每个字段都应给出对应错误 ----
const badForm: FormData = {
    phone: '12345',
    code: '12',
    password: 'short',
    confirmPassword: 'different',
    age: 15,
    agreement: false,
};
const badResult = validateForm(badForm, registerSchema);
console.log('valid =', badResult.valid); // false
console.log(badResult.errors);
// {
//   phone: '手机号格式不正确',
//   code: '验证码为 6 位数字',
//   password: '密码长度需在 8~20 位之间',
//   confirmPassword: '两次输入的密码不一致',
//   age: '仅接受 18~99 岁用户注册',
//   agreement: '请阅读并同意用户协议'
// }

// ---- 验证 2:合法表单应通过;注意 0/false 不被 required 误杀 ----
const goodForm: FormData = {
    phone: '13800138000',
    code: '654321',
    password: 'abc12345',
    confirmPassword: 'abc12345',
    age: 26,
    agreement: true,
};
console.log(validateForm(goodForm, registerSchema)); // { valid: true, errors: {} }

// ---- 验证 3:单字段校验(配合 blur 事件,只校验当前字段) ----
console.log(validateField('phone', { phone: '13800138000' }, registerSchema)); // ''
console.log(validateField('phone', { phone: '' }, registerSchema)); // '请输入手机号'
