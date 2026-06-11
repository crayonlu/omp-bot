import { useEffect, useState, useCallback } from "react"
import { Settings, Plus, X, ChevronDown, ChevronRight, PencilLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useWebSocket } from "./hooks/useWebSocket"
import Activity from "./panels/Activity"
import { get, post, del } from "./api"
import type { ChannelConfig } from "./types"

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`

export default function App() {
  const { lastMessage } = useWebSocket(wsUrl)

  // Stats
  const [stats, setStats] = useState({ messagesToday: 0, repliedToday: 0, sessionCount: 0 })
  useEffect(() => {
    if (lastMessage?.type === "stats") setStats(lastMessage.data as typeof stats)
  }, [lastMessage])

  // Channels
  const [channels, setChannels] = useState<ChannelConfig[]>([])
  const [chOpen, setChOpen] = useState(false)
  const [newId, setNewId] = useState("")
  const [newName, setNewName] = useState("")
  const [newMode, setNewMode] = useState<ChannelConfig["triggerMode"]>("mention_only")
  const loadCh = useCallback(async () => { try { setChannels(await get<ChannelConfig[]>("/api/channels")) } catch {} }, [])
  useEffect(() => { loadCh() }, [loadCh])
  const addCh = async () => {
    const id = parseInt(newId, 10); if (!id) return
    await post("/api/channels", { targetType: "private", targetId: id, displayName: newName || `u_${id}`, triggerMode: newMode })
    setNewId(""); setNewName(""); loadCh()
  }
  const delCh = async (key: string) => { await del(`/api/channels?key=${encodeURIComponent(key)}`); loadCh() }

  // Prompt
  const [prompt, setPrompt] = useState("")
  const [editPrompt, setEditPrompt] = useState(false)
  const [promptVal, setPromptVal] = useState("")
  const loadPrompt = useCallback(async () => {
    try { const d = await get<{ prompt: string }>("/api/prompt"); setPrompt(d.prompt); setPromptVal(d.prompt) } catch {}
  }, [])
  useEffect(() => { loadPrompt() }, [loadPrompt])
  const savePrompt = async () => { await post("/api/prompt", { prompt: promptVal }); setPrompt(promptVal); setEditPrompt(false) }

  // Settings
  const [sOpen, setSOpen] = useState(false)
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { get<{ id: string; name: string }[]>("/api/models").then(setModels).catch(() => {}) }, [])

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-5 py-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h1 className="text-sm font-semibold tracking-tight">omp-bot</h1>
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span className="text-[11px] text-muted-foreground">Connected</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>{stats.messagesToday} msgs</span>
          <span className="text-emerald-600 dark:text-emerald-400">{stats.repliedToday} →</span>
          <span>{stats.sessionCount} sess</span>
          <Button variant="ghost" size="icon" className="size-6" onClick={() => setSOpen(true)}>
            <Settings className="size-3.5" />
          </Button>
        </div>
      </header>

      {/* Activity Feed */}
      <main className="mt-4 flex-1">
        <Activity wsMessage={lastMessage} />
      </main>

      {/* Footer */}
      <footer className="mt-4 space-y-2.5 border-t border-border/30 pt-3.5">
        {/* Channels */}
        <div>
          <Button variant="ghost" size="sm" onClick={() => setChOpen(!chOpen)} className="h-auto p-0 text-[11px] font-normal text-muted-foreground hover:text-foreground">
            {chOpen ? <ChevronDown className="mr-1 size-3" /> : <ChevronRight className="mr-1 size-3" />}
            {channels.length} channel{channels.length !== 1 ? "s" : ""}
          </Button>
          {chOpen && (
            <div className="mt-2 space-y-1.5 pl-1">
              {channels.map((ch) => (
                <div key={`${ch.targetType}:${ch.targetId}`} className="flex items-center gap-2 text-[11px]">
                  <span className="w-6 rounded-sm bg-muted/60 px-1 py-0.5 text-[10px] font-medium">{ch.targetType === "private" ? "DM" : "群"}</span>
                  <code className="font-mono text-muted-foreground">{ch.targetId}</code>
                  <span>{ch.displayName}</span>
                  <span className="ml-auto text-muted-foreground">{ch.triggerMode}</span>
                  <Button variant="ghost" size="icon" className="size-4" onClick={() => delCh(`${ch.targetType}:${ch.targetId}`)}>
                    <X className="size-2.5" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-1.5 pt-1">
                <Input placeholder="ID" value={newId} onChange={(e) => setNewId(e.target.value)} className="h-7 w-20 text-[11px]" />
                <Input placeholder="name" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-7 w-24 text-[11px]" />
                <select value={newMode} onChange={(e) => setNewMode(e.target.value as typeof newMode)} className="h-7 rounded-md border-0 bg-muted/50 px-2 text-[11px] outline-none">
                  <option value="all">all</option><option value="mention_only">@</option><option value="smart">smart</option><option value="off">off</option>
                </select>
                <Button variant="ghost" size="icon" className="size-7" onClick={addCh}><Plus className="size-3" /></Button>
              </div>
            </div>
          )}
        </div>

        {/* Persona */}
        <div className="flex items-start gap-2 text-[11px]">
          <span className="mt-0.5 shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Persona</span>
          <p className="line-clamp-1 flex-1 text-muted-foreground">{prompt ? `${prompt.slice(0, 120)}…` : "Default prompt"}</p>
          <Button variant="ghost" size="icon" className="size-5 shrink-0" onClick={() => { setPromptVal(prompt); setEditPrompt(true) }}>
            <PencilLine className="size-3" />
          </Button>
        </div>
      </footer>

      {/* Prompt Dialog */}
      <Dialog open={editPrompt} onOpenChange={setEditPrompt}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="text-sm font-medium">Edit Persona</DialogTitle></DialogHeader>
          <textarea className="min-h-[200px] w-full rounded-md border-0 bg-muted/50 p-3 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring" value={promptVal} onChange={(e) => setPromptVal(e.target.value)} />
          <Button size="sm" onClick={savePrompt}>Save</Button>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={sOpen} onOpenChange={setSOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="text-sm font-medium">Settings</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Model</label>
              <Select>
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue placeholder={models[0]?.name ?? "loading…"} />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
