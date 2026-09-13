import MarkdownIt from 'markdown-it'

/**
 * html: false 是有意为之 —— 作品简介由仓库写入者提供，
 * 关闭原始 HTML 可以避免在页面上直接注入脚本（也就不会有令牌被窃取的风险）。
 */
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
})

markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index]
  const href = String(token.attrGet('href') ?? '')
  if (/^https?:\/\//i.test(href)) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer nofollow')
  }
  return self.renderToken(tokens, index, options)
}

export function renderMarkdown(source?: string | null): string {
  if (!source) return ''
  return markdown.render(source)
}

export function markdownToPlainText(source?: string | null, length = 120): string {
  if (!source) return ''
  const text = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}
