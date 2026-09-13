import { bytesToBase64 } from './encoding'

/**
 * OAuth 2.0 授权码流程所需的 PKCE 参数（RFC 7636）。
 *
 * 说明：GitHub 的 token 端点在 `client_secret` 之外**额外**支持 `code_verifier`，
 * 但 PKCE 不能替代 secret（官方文档把 client_secret 标为 Required）。
 * 这里两者同时使用，多一层保护。
 */

/** base64url（RFC 4648 §5）：去掉填充，并把 +/ 换成 -_。 */
function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function secureRandom(byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/** 生成 code_verifier：32 字节随机数编码后是 43 字符，正好是规范允许的下限。 */
export function createCodeVerifier(): string {
  return base64Url(secureRandom(32))
}

/** 生成防 CSRF 的 state，回跳时用它确认这次登录确实由本站发起。 */
export function createState(): string {
  return base64Url(secureRandom(16))
}

/**
 * 用 S256 计算 code_challenge。GitHub 只支持 S256，不支持 plain。
 * crypto.subtle 仅在安全上下文（https 或 localhost）可用，所以这里明确报错而不是静默降级。
 */
export async function createCodeChallenge(verifier: string): Promise<string> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle
  if (!subtle) {
    throw new Error('当前环境不支持 Web Crypto，无法安全登录。请改用 https 或 localhost 访问本站。')
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}
