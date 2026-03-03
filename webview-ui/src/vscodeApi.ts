export interface MessageTransport {
  postMessage(msg: unknown): void
  onMessage(handler: (msg: unknown) => void): () => void
}

// Detect VS Code environment
const isVsCode = typeof acquireVsCodeApi === 'function'

function createVsCodeTransport(): MessageTransport {
  const api = acquireVsCodeApi()
  return {
    postMessage(msg: unknown): void {
      api.postMessage(msg)
    },
    onMessage(handler: (msg: unknown) => void): () => void {
      const listener = (e: MessageEvent) => handler(e.data)
      window.addEventListener('message', listener)
      return () => window.removeEventListener('message', listener)
    },
  }
}

function createWebSocketTransport(): MessageTransport {
  const WS_RECONNECT_MIN_MS = 1000
  const WS_RECONNECT_MAX_MS = 30000

  let ws: WebSocket | null = null
  let handlers: Array<(msg: unknown) => void> = []
  let reconnectDelay = WS_RECONNECT_MIN_MS
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pendingMessages: unknown[] = []

  function connect(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${protocol}//${location.host}/ws`)

    ws.onopen = () => {
      console.log('[WS] Connected')
      reconnectDelay = WS_RECONNECT_MIN_MS
      // Flush pending messages
      const failed: unknown[] = []
      for (const msg of pendingMessages) {
        try {
          ws!.send(JSON.stringify(msg))
        } catch {
          failed.push(msg)
        }
      }
      pendingMessages = failed
      // Re-send webviewReady on reconnect for full state resync
      try {
        ws!.send(JSON.stringify({ type: 'webviewReady' }))
      } catch { /* will retry on next reconnect */ }
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string)
        for (const handler of handlers) {
          handler(msg)
        }
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      console.log(`[WS] Disconnected, reconnecting in ${reconnectDelay}ms`)
      ws = null
      scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose will fire after onerror
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      reconnectDelay = Math.min(reconnectDelay * 2, WS_RECONNECT_MAX_MS)
      connect()
    }, reconnectDelay)
  }

  connect()

  return {
    postMessage(msg: unknown): void {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg))
      } else {
        pendingMessages.push(msg)
      }
    },
    onMessage(handler: (msg: unknown) => void): () => void {
      handlers.push(handler)
      return () => {
        handlers = handlers.filter(h => h !== handler)
      }
    },
  }
}

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

export const transport: MessageTransport = isVsCode
  ? createVsCodeTransport()
  : createWebSocketTransport()

// Backward-compatible export
export const vscode: { postMessage(msg: unknown): void } = {
  postMessage(msg: unknown): void {
    transport.postMessage(msg)
  },
}
