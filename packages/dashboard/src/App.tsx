import { useEffect, useState } from "react"
import { useWebSocket } from "./hooks/useWebSocket"
import { get, post } from "./api"
import Overview from "./panels/Overview"
import Activity from "./panels/Activity"
import Channels from "./panels/Channels"
import Persona from "./panels/Persona"

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`

export default function App() {
  const { lastMessage, connected } = useWebSocket(wsUrl)
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [current, setCurrent] = useState("")

  useEffect(() => {
    get<{ id: string; name: string }[]>("/api/models")
      .then(list => { setModels(list); if (list.length > 0) setCurrent(list[0].id) })
      .catch(() => {})
    // Fetch currently selected model
    get<{ model: string }>("/api/model")
      .then(r => { if (r.model) setCurrent(r.model) })
      .catch(() => {})
  }, [])

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-5 py-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h1 className="text-sm font-semibold tracking-tight">omp-bot</h1>
          <span className={`size-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
          <span className="text-[11px] text-muted-foreground">{connected ? "Connected" : "Disconnected"}</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={current}
            onChange={(e) => { setCurrent(e.target.value); post("/api/model", { model: e.target.value }).catch(() => {}) }}
            className="h-6 rounded-md border-0 bg-muted/60 px-2 text-[11px] outline-none"
          >
            {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </header>

      {/* Overview Stats */}
      <section className="mt-5">
        <Overview wsMessage={lastMessage} />
      </section>

      {/* Activity Feed */}
      <main className="mt-5 flex-1">
        <Activity wsMessage={lastMessage} />
      </main>

      {/* Footer */}
      <footer className="mt-4 space-y-2.5 border-t border-border/30 pt-3.5">
        <Channels />
        <Persona />
      </footer>
    </div>
  )
}