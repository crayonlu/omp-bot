import { useEffect, useRef, useState } from "react"

export interface WSMessage {
  type: string
  data: unknown
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
const RECONNECT_JITTER = 0.3

export function useWebSocket(url: string) {
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const retryCountRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    const connect = () => {
      if (!mountedRef.current) return

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close()
          return
        }
        retryCountRef.current = 0
        setConnected(true)
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setConnected(false)
        scheduleReconnect()
      }

      ws.onerror = () => {
        // onclose fires after onerror, so reconnect is scheduled there
      }

      ws.onmessage = (e) => {
        try {
          setLastMessage(JSON.parse(e.data))
        } catch {
          /* not JSON */
        }
      }
    }

    const scheduleReconnect = () => {
      if (!mountedRef.current) return
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, retryCountRef.current) *
          (1 + RECONNECT_JITTER * (Math.random() * 2 - 1)),
        RECONNECT_MAX_MS
      )
      retryCountRef.current++
      timerRef.current = setTimeout(connect, delay)
    }

    connect()

    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.onerror = null
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [url])

  return { lastMessage, connected }
}
