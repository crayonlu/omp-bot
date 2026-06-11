import { useEffect, useState } from "react"
import { Settings as SettingsIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { get } from "../api"
import type { WSMessage } from "../hooks/useWebSocket"

interface ModelInfo {
  id: string
  name: string
}

export default function Settings({ wsMessage }: { wsMessage: WSMessage | null }) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [status, setStatus] = useState<{
    connected: boolean
  }>({ connected: false })

  useEffect(() => {
    get<ModelInfo[]>("/api/models")
      .then(setModels)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (wsMessage?.type === "status" && wsMessage.data) {
      setStatus(wsMessage.data as { connected: boolean })
    }
  }, [wsMessage])

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={() => setOpen(true)}
      >
        <SettingsIcon className="size-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium">
              Settings
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">
                Model
              </label>
              <Select>
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue
                    placeholder={models[0]?.name ?? "loading…"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">
                Status
              </label>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className={`inline-block size-2 rounded-full ${
                    status.connected ? "bg-emerald-500" : "bg-red-500"
                  }`}
                />
                {status.connected ? "Connected" : "Disconnected"}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
