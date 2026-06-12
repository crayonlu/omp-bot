import { useWebSocket } from "./hooks/useWebSocket"
import ChatView from "./panels/ChatView"

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`

export default function App() {
  const { lastMessage, connected } = useWebSocket(wsUrl)
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