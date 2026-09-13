import type { AuthorRef } from '@/types'

/**
 * 作者头像。data/ 里没有存头像时回退到 GitHub 的公开头像服务
 * （https://github.com/<login>.png），因此无需任何 API 调用也总是有图。
 */
export function avatarOf(author?: AuthorRef | null, size = 64): string {
  if (!author) return ''
  if (author.avatarUrl) return author.avatarUrl
  if (!author.login) return ''
  return `https://github.com/${author.login}.png?size=${size}`
}

export function profileUrl(login: string): string {
  return `https://github.com/${login}`
}
