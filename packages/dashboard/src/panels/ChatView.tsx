import { useEffect, useState, useRef } from "react"
import type { WSMessage } from "../hooks/useWebSocket"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  time: string
}

export default function ChatView({ wsMessage }: { wsMessage: WSMessage | null }) {
  const [msgs, setMsgs] = useState<Message[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  // Initial load
  useEffect(() => {
    fetch("/api/activity?limit=50")
      .then(r => r.json())
      .then((list: any[]) => {
        const flat: Message[] = []
        for (const m of list) {
          flat.push({
            id: `user-${m.timestamp}`,
            role: "user",
            content: m.message ? m.message.slice(0, 200) : "(image or other)",
            time: new Date(m.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
          })
          if (m.decision === "replied" && m.reply) {
            flat.push({
              id: `bot-${m.timestamp}`,
              role: "assistant",
              content: m.reply.slice(0, 200),
              time: new Date(m.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
            })
          }
        }
        setMsgs(flat)
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (wsMessage?.type === "activity" && wsMessage.data) {
      const entry = (wsMessage.data as any).entry as Record<string, string> | undefined
      if (!entry) return

      // User's message
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: entry.message || "(image or other)",
        time: new Date(entry.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      }
      // Bot's reply (if present)
      const botMsg: Message | null = entry.decision === "replied" && entry.reply ? {
        id: `bot-${Date.now()}`,
        role: "assistant",
        content: entry.reply.slice(0, 300),
        time: new Date(entry.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      } : null

      setMsgs(prev => botMsg ? [...prev, userMsg, botMsg] : [...prev, userMsg])
    }
  }, [wsMessage])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [msgs.length])

  return (
    <div className="flex-1 overflow-y-auto px-1">
      {msgs.length === 0 && (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          No messages yet. Say something to 先生.
        </div>
      )}
      <div className="space-y-3 pt-2 pb-2">
        {msgs.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-xl px-3.5 py-2 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-muted/70 text-foreground"
                  : "bg-secondary text-secondary-foreground"
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              <p className="mt-1 text-[10px] opacity-40">{msg.time}</p>
            </div>
          </div>
        ))}
      </div>
      <div ref={bottomRef} />
    </div>
  )
}