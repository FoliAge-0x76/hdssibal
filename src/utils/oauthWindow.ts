/**
 * 授权弹窗的打开与结果等待。
 *
 * 一键登录不再整页跳走：`/oauth/callback.html` 在授权完成后会把结果
 * postMessage 回本页，所以用户在授权期间不会丢失当前浏览位置。
 * 弹窗被浏览器拦截时，调用方退化成整页跳转（见 stores/auth.ts）。
 */

/** 回跳页与本页约定的消息标记，避免把页面里其他 postMessage 误当成登录结果。 */
export const OAUTH_MESSAGE_TYPE = 'hdssibal:oauth'

/**
 * 回跳页写的 localStorage 键。
 *
 * postMessage 需要 opener 关系还在，而一旦授权页带上 `Cross-Origin-Opener-Policy`，
 * 浏览器就会切断这条关系（`window.opener` 变 null，本页看到的 `popup.closed` 也会是 true）。
 * storage 事件按来源而不是按窗口组派发，不受该策略影响，所以把它作为备用通道：
 * 回跳页先写这个键，再尝试 postMessage，两条路任一到达即可。
 */
const OAUTH_STORAGE_KEY = 'hdssibal:oauth:result'

/** 弹窗关闭后多等一小会儿再判定为「用户放弃」：close() 可能先于 postMessage 到达。 */
const CLOSE_POLL_MS = 500
const CLOSE_GRACE_MS = 600
/** 用户可能去创建一个新账号，给足时间。 */
const TIMEOUT_MS = 10 * 60 * 1000

export interface OAuthResult {
  /** 中转层签发的凭据，用来换真正的访问令牌。 */
  session?: string
  /** 中转层原样回传的 state，站点据此确认这就是自己发起的登录。 */
  state?: string
  error?: string
  errorDescription?: string
}

/**
 * 打开授权弹窗。返回 null 表示浏览器拦截了弹窗，调用方应改为整页跳转。
 *
 * 显式指定窗口尺寸：让 GitHub 授权页保持桌面版布局，而不是按窄窗口退化成移动端。
 */
export function openOAuthPopup(url: string): Window | null {
  return window.open(
    url,
    'hdssibal-oauth',
    'width=600,height=760,menubar=no,toolbar=no,location=yes,status=no',
  )
}

/**
 * 等待弹窗里的回跳页回传结果：
 * - 收到 postMessage 或 storage 事件 → 立刻返回；
 * - 用户关掉弹窗 → 短暂宽限后返回 null；
 * - 超时 → 返回 null。
 */
export function waitForOAuthResult(
  popup: Window,
  timeoutMs: number = TIMEOUT_MS,
): Promise<OAuthResult | null> {
  // 上一次登录若留下了残留结果，会让本次误判，先清掉
  clearStoredResult()

  return new Promise((resolve) => {
    let settled = false
    let closedSince = 0

    function cleanup(): void {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('storage', onStorage)
      window.clearInterval(poll)
      window.clearTimeout(timer)
      clearStoredResult()
    }

    function finish(result: OAuthResult | null): void {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    function accept(data: unknown): void {
      if (!data || typeof data !== 'object') return
      const message = data as OAuthResult & { type?: string }
      if (message.type !== OAUTH_MESSAGE_TYPE) return
      finish(message)
    }

    function onMessage(event: MessageEvent): void {
      // 只认本站来源的消息：回跳页与本站同源
      if (event.origin !== window.location.origin) return
      accept(event.data)
    }

    function onStorage(event: StorageEvent): void {
      if (event.key !== OAUTH_STORAGE_KEY || !event.newValue) return
      try {
        accept(JSON.parse(event.newValue))
      } catch {
        // 不是我们写的格式，忽略
      }
    }

    const poll = window.setInterval(() => {
      if (!popup.closed) return
      if (!closedSince) {
        closedSince = Date.now()
        return
      }
      if (Date.now() - closedSince >= CLOSE_GRACE_MS) finish(null)
    }, CLOSE_POLL_MS)

    const timer = window.setTimeout(() => finish(null), timeoutMs)
    window.addEventListener('message', onMessage)
    window.addEventListener('storage', onStorage)
  })
}

function clearStoredResult(): void {
  try {
    localStorage.removeItem(OAUTH_STORAGE_KEY)
  } catch {
    // 隐私模式下可能不可用，忽略
  }
}
