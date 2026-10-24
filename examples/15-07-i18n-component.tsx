// 文件: examples/15-07-i18n-component.tsx —— i18n 组件层:插值、复数、语言包懒加载
import { useTranslation } from 'react-i18next';

export function OrderCard({ count, date }: { count: number; date: Date }) {
    const { t, i18n } = useTranslation('orders'); // 命名空间:语言包按需加载

    return (
        <div dir={i18n.dir()}> {/* rtl 语言返回 'rtl',配合 12.1 的逻辑属性自动镜像布局 */}
            {/* 插值:语言包 "{{count}} 件商品" */}
            <p>{t('summary', { count })}</p>
            {/* 复数:语言包用 _one/_other 后缀,交给 Intl.PluralRules 选择 */}
            <p>{t('itemCount', { count })}</p>
            {/* 格式化委托给 Intl:t 里声明 {{date, datetime}} 即可 */}
            <time>{t('createdAt', { date, formatParams: { date: { dateStyle: 'medium' } } })}</time>
        </div>
    );
}
// 语言包(en.json): { "itemCount_one": "{{count}} item", "itemCount_other": "{{count}} items" }
// 💡 工程要点:语言包按命名空间 code-split;切语言只下载当前命名空间,不是全量语言包
