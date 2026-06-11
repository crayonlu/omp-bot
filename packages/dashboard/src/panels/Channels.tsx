import { useEffect, useState, useCallback } from "react"
import { Plus, X, ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { get, post, del } from "../api"
import type { ChannelConfig } from "../types"

export default function Channels() {
  const [open, setOpen] = useState(false)
  const [channels, setChannels] = useState<ChannelConfig[]>([])
  const [newId, setNewId] = useState("")
  const [newName, setNewName] = useState("")
  const [newMode, setNewMode] = useState<ChannelConfig["triggerMode"]>("mention_only")

  const loadCh = useCallback(async () => {
    try {
      setChannels(await get<ChannelConfig[]>("/api/channels"))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadCh()
  }, [loadCh])

  const addCh = async () => {
    const id = parseInt(newId, 10)
    if (!id) return
    await post("/api/channels", {
      targetType: "private",
      targetId: id,
      displayName: newName || `u_${id}`,
      triggerMode: newMode,
    })
    setNewId("")
    setNewName("")
    loadCh()
  }

  const delCh = async (key: string) => {
    await del(`/api/channels?key=${encodeURIComponent(key)}`)
    loadCh()
  }

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        className="h-auto p-0 text-[11px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="mr-1 size-3" />
        ) : (
          <ChevronRight className="mr-1 size-3" />
        )}
        {channels.length} channel{channels.length !== 1 ? "s" : ""}
      </Button>
      {open && (
        <div className="mt-2 space-y-1.5 pl-1">
          {channels.map((ch) => (
            <div
              key={`${ch.targetType}:${ch.targetId}`}
              className="flex items-center gap-2 text-[11px]"
            >
              <span className="w-6 rounded-sm bg-muted/60 px-1 py-0.5 text-[10px] font-medium">
                {ch.targetType === "private" ? "DM" : "群"}
              </span>
              <code className="font-mono text-muted-foreground">
                {ch.targetId}
              </code>
              <span>{ch.displayName}</span>
              <span className="ml-auto text-muted-foreground">
                {ch.triggerMode}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-4"
                onClick={() => delCh(`${ch.targetType}:${ch.targetId}`)}
              >
                <X className="size-2.5" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-1.5 pt-1">
            <Input
              placeholder="ID"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              className="h-7 w-20 text-[11px]"
            />
            <Input
              placeholder="name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-7 w-24 text-[11px]"
            />
            <select
              value={newMode}
              onChange={(e) =>
                setNewMode(e.target.value as ChannelConfig["triggerMode"])
              }
              className="h-7 rounded-md border-0 bg-muted/50 px-2 text-[11px] outline-none"
            >
              <option value="all">all</option>
              <option value="mention_only">@</option>
              <option value="smart">smart</option>
              <option value="off">off</option>
            </select>
            <Button variant="ghost" size="icon" className="size-7" onClick={addCh}>
              <Plus className="size-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
