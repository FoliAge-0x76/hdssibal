import { bytesToBase64 } from './encoding.ts'

/**
 * 生成随机串（base64url，无填充）。
 *
 * 一键登录用它做 state/nonce：中转层会把它封进加密的 state 里，GitHub 原样回传，
 * 站点再拿它确认这次登录确实由自己发起（防 CSRF）。
 */
export function randomToken(byteLength = 16): string {
  if (!Number.isInteger(byteLength) || byteLength < 1) {
    throw new Error('randomToken 需要正整数长度。')
  }
  const bytes = new Uint8Array(byteLength)
  globalThis.crypto.getRandomValues(bytes)
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
