import { useEffect, useState } from "react"
import { useWebSocket } from "./hooks/useWebSocket"
import { get, post } from "./api"
import ChatView from "./panels/ChatView"

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`

export default function App() {
  const { lastMessage, connected } = useWebSocket(wsUrl)
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [current, setCurrent] = useState("")

  useEffect(() => {
    get<{ id: string; name: string }[]>("/api/models")
      .then(list => { setModels(list); if (list.length > 0) setCurrent(list[0].id) })
      .catch(() => {})
    get<{ model: string }>("/api/model")
      .then(r => { if (r.model) setCurrent(r.model) })
      .catch(() => {})
  }, [])

  const [usage, setUsage] = useState<{ cost: string; reqs: number } | null>(null)
  useEffect(() => {
    fetch("/api/usage").then(r => r.json()).then(d => {
      const o = d.overall || {}
      setUsage({ cost: (o.totalCost || 0).toFixed(3), reqs: o.totalRequests || 0 })
    }).catch(() => {})
  }, [])

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col px-4 py-3">
      <header className="flex shrink-0 items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold tracking-tight">omp-bot</h1>
          <span className={`size-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
          {usage && (
            <span className="ml-2 text-[11px] text-muted-foreground">
              ${usage.cost} / {usage.reqs} reqs
            </span>
          )}
        </div>
        <select
          value={current}
          onChange={(e) => { setCurrent(e.target.value); post("/api/model", { model: e.target.value }).catch(() => {}) }}
          className="h-6 rounded-md border-0 bg-muted/60 px-2 text-[11px] outline-none"
        >
          {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </header>

      {/* Chat */}
      <ChatView wsMessage={lastMessage} />

      {/* Footer */}
      <footer className="flex shrink-0 items-center justify-center gap-3 border-t border-border/30 pt-2 text-[10px] text-muted-foreground">
        <span>{connected ? "Connected" : "Disconnected"}</span>
      </footer>
    </div>
  )
}