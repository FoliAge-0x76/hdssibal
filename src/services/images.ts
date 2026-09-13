import { bytesToBase64 } from '@/utils/encoding'

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export interface PreparedImage {
  base64: string
  bytes: number
  width: number
  height: number
  /** 不含点号，例如 png */
  extension: string
  mimeType: string
}

const MAX_EDGE = 1600
const TARGET_BYTES = 600 * 1024

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return 'png'
  }
}

let webpSupport: boolean | null = null

function supportsWebp(): boolean {
  if (webpSupport === null) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    webpSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp')
  }
  return webpSupport
}

async function decode(file: File): Promise<{ width: number; height: number; source: CanvasImageSource; release: () => void }> {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file)
    return { width: bitmap.width, height: bitmap.height, source: bitmap, release: () => bitmap.close() }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('图片解码失败，请换一张图试试。'))
      element.src = url
    })
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      source: image,
      release: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

async function encode(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality))
  if (!blob) throw new Error('图片压缩失败，请换一张图试试。')
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * 压缩并编码封面图。
 * 浏览器端 canvas 处理，避免为了一次缩放引入 sharp 之类的原生依赖；
 * 目标是让提交进仓库的文件体积可控（Contents API 走 base64，越小越快）。
 */
export async function prepareCoverImage(file: File): Promise<PreparedImage> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    throw new Error('封面仅支持 PNG / JPEG / WebP / GIF。')
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('原图请控制在 20 MB 以内。')
  }

  const decoded = await decode(file)
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器不支持 Canvas 图片处理。')
    context.drawImage(decoded.source, 0, 0, width, height)

    const animated = file.type === 'image/gif'
    const mimeType = animated ? 'image/gif' : supportsWebp() ? 'image/webp' : 'image/jpeg'

    let quality = 0.9
    let bytes = await encode(canvas, mimeType, quality)
    while (!animated && bytes.length > TARGET_BYTES && quality > 0.5) {
      quality -= 0.1
      bytes = await encode(canvas, mimeType, quality)
    }
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new Error(
        `压缩后仍有 ${Math.round(bytes.length / 1024)} KB，超出 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB 上限，请换一张更小的图。`,
      )
    }

    return {
      base64: bytesToBase64(bytes),
      bytes: bytes.length,
      width,
      height,
      extension: extensionFor(mimeType),
      mimeType,
    }
  } finally {
    decoded.release()
  }
}
