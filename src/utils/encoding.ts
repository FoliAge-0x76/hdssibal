/**
 * base64 与字符串/字节之间的互转。
 * 必须走 TextEncoder/TextDecoder，否则中文标题写进仓库会乱码。
 */

function bytesToBinary(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return binary
}

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes))
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

export function base64ToUtf8(base64: string): string {
  return new TextDecoder().decode(base64ToBytes(base64))
}

export function formatBytes(size?: number | null): string {
  if (!size || size < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`
}
