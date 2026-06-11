import { useEffect, useState } from "react"
import { useWebSocket } from "./hooks/useWebSocket"
import Overview from "./panels/Overview"
import Activity from "./panels/Activity"
import Channels from "./panels/Channels"
import Persona from "./panels/Persona"
import Settings from "./panels/Settings"

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`

export default function App() {
  const { lastMessage, connected } = useWebSocket(wsUrl)

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-5 py-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h1 className="text-sm font-semibold tracking-tight">omp-bot</h1>
          <span
            className={`size-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}
          />
          <span className="text-[11px] text-muted-foreground">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <Settings wsMessage={lastMessage} />
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
