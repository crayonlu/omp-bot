import { useEffect, useRef, useState } from "react";

export interface WSMessage {
  type: string;
  data: unknown;
}

export function useWebSocket(url: string) {
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(url);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (e) => {
      try {
        setLastMessage(JSON.parse(e.data));
      } catch {
        /* not JSON */
      }
    };
    wsRef.current = ws;
    return () => ws.close();
  }, [url]);

  return { lastMessage, connected };
}