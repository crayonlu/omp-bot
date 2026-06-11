import { useEffect, useState, useCallback } from "react"
import { PencilLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { get, post } from "../api"

export default function Persona() {
  const [prompt, setPrompt] = useState("")
  const [editOpen, setEditOpen] = useState(false)
  const [promptVal, setPromptVal] = useState("")

  const loadPrompt = useCallback(async () => {
    try {
      const d = await get<{ prompt: string }>("/api/prompt")
      setPrompt(d.prompt)
      setPromptVal(d.prompt)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadPrompt()
  }, [loadPrompt])

  const savePrompt = async () => {
    await post("/api/prompt", { prompt: promptVal })
    setPrompt(promptVal)
    setEditOpen(false)
  }

  return (
    <>
      <div className="flex items-start gap-2 text-[11px]">
        <span className="mt-0.5 shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Persona
        </span>
        <p className="line-clamp-1 flex-1 text-muted-foreground">
          {prompt ? `${prompt.slice(0, 120)}…` : "Default prompt"}
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 shrink-0"
          onClick={() => {
            setPromptVal(prompt)
            setEditOpen(true)
          }}
        >
          <PencilLine className="size-3" />
        </Button>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium">
              Edit Persona
            </DialogTitle>
          </DialogHeader>
          <textarea
            className="min-h-[200px] w-full rounded-md border-0 bg-muted/50 p-3 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={promptVal}
            onChange={(e) => setPromptVal(e.target.value)}
          />
          <Button size="sm" onClick={savePrompt}>
            Save
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
