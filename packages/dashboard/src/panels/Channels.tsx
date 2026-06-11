import { useEffect, useState, useCallback } from "react"
import { Plus, X, ChevronDown, ChevronRight, User, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { get, post, del } from "../api"
import type { ChannelConfig } from "../types"

interface Friend { user_id: number; nickname: string }
interface Group { group_id: number; group_name: string }

export default function Channels() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<"friends" | "groups">("friends")
  const [channels, setChannels] = useState<ChannelConfig[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [groups, setGroups] = useState<Group[]>([])

  const isChannel = (type: string, id: number) =>
    channels.some(c => c.targetType === type && c.targetId === id)
  const getMode = (type: string, id: number) =>
    channels.find(c => c.targetType === type && c.targetId === id)?.triggerMode

  const loadCh = useCallback(async () => { try { setChannels(await get<ChannelConfig[]>("/api/channels")) } catch {} }, [])
  const loadFriends = useCallback(async () => { try { setFriends(await get<Friend[]>("/api/friends")) } catch {} }, [])
  const loadGroups = useCallback(async () => { try { setGroups(await get<Group[]>("/api/groups")) } catch {} }, [])

  useEffect(() => { loadCh() }, [loadCh])
  useEffect(() => { loadFriends() }, [loadFriends])
  useEffect(() => { loadGroups() }, [loadGroups])

  const openPanel = () => { setOpen(!open); if (!open) { loadFriends(); loadGroups() } }

  const toggle = async (type: "private" | "group", id: number, name: string) => {
    if (isChannel(type, id)) {
      await del(`/api/channels?key=${encodeURIComponent(`${type}:${id}`)}`)
    } else {
      await post("/api/channels", { targetType: type, targetId: id, displayName: name, triggerMode: type === "private" ? "all" : "mention_only" })
    }
    loadCh()
  }

  const setMode = async (type: string, id: number, triggerMode: ChannelConfig["triggerMode"]) => {
    const ch = channels.find(c => c.targetType === type && c.targetId === id)
    if (!ch) return
    await post("/api/channels", { ...ch, triggerMode, key: `${type}:${id}` })
    loadCh()
  }

  const items = tab === "friends" ? friends : groups
  const itemType = tab === "friends" ? "private" : "group"

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={openPanel} className="h-auto p-0 text-[11px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground">
        {open ? <ChevronDown className="mr-1 size-3" /> : <ChevronRight className="mr-1 size-3" />}
        {channels.length} channel{channels.length !== 1 ? "s" : ""}
      </Button>
      {open && (
        <div className="mt-2 space-y-2 pl-1">
          <div className="flex gap-2 text-[11px]">
            <button onClick={() => setTab("friends")} className={`rounded px-2 py-0.5 ${tab === "friends" ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}>Friends</button>
            <button onClick={() => setTab("groups")} className={`rounded px-2 py-0.5 ${tab === "groups" ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}>Groups</button>
          </div>
          <div className="max-h-48 space-y-0.5 overflow-y-auto text-[11px]">
            {items.map((item) => {
              const id = "user_id" in item ? (item as Friend).user_id : (item as Group).group_id
              const name = "nickname" in item ? (item as Friend).nickname : (item as Group).group_name
              const enabled = isChannel(itemType, id)
              const mode = getMode(itemType, id)
              return (
                <div key={id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/40">
                  {tab === "friends" ? <User className="size-3 shrink-0 text-muted-foreground" /> : <Users className="size-3 shrink-0 text-muted-foreground" />}
                  <span className="flex-1 truncate">{name}</span>
                  <code className="shrink-0 font-mono text-[10px] text-muted-foreground">{id}</code>
                  {enabled ? (
                    <select value={mode} onChange={(e) => setMode(itemType, id, e.target.value as ChannelConfig["triggerMode"])} className="h-5 rounded border-0 bg-muted/50 px-1 text-[10px] outline-none">
                      <option value="all">all</option>
                      <option value="mention_only">@</option>
                      <option value="smart">smart</option>
                      <option value="off">off</option>
                    </select>
                  ) : (
                    <Button variant="ghost" size="icon" className="size-5" onClick={() => toggle(itemType as "private" | "group", id, name)}>
                      <Plus className="size-2.5" />
                    </Button>
                  )}
                </div>
              )
            })}
            {items.length === 0 && <div className="py-2 text-center text-muted-foreground">No {tab} found.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
