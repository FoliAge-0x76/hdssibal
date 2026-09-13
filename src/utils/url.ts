/**
 * 站点内所有用户填写的链接都只允许 http/https。
 *
 * 这些链接会被写进仓库并渲染成 <a href>，若不白名单化，协作者可以直接在
 * data/*.json 里塞入 `javascript:` 之类的伪协议，形成存储型 XSS。
 */

/** 规范化链接，非法或非 http(s) 时返回 null。 */
export function normalizeHttpUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname) return null

  return parsed.toString()
}

/** 返回可直接展示给投稿人的错误说明，合法时返回 null。 */
export function describeUrlProblem(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!value) return '请填写链接地址。'

  if (/^(javascript|data|vbscript|file):/i.test(value)) {
    return '出于安全考虑，不支持 javascript: / data: 等协议，请使用 http:// 或 https:// 链接。'
  }
  if (!/^https?:\/\//i.test(value)) {
    return '链接必须以 http:// 或 https:// 开头。'
  }
  if (!normalizeHttpUrl(value)) {
    return '这不是一个有效的链接地址，请检查是否漏写域名。'
  }

  return null
}

/** 渲染 href 前调用：非法链接返回空字符串，避免渲染出危险地址。 */
export function safeHref(raw: string | null | undefined): string {
  return normalizeHttpUrl(raw) ?? ''
}
