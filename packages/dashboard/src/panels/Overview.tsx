import { useEffect, useState } from "react"
import { get } from "../api"
import type { OverviewStats } from "../types"
import type { WSMessage } from "../hooks/useWebSocket"
import { Card, CardContent } from "@/components/ui/card"

interface StatCardProps {
  label: string
  value: number
  highlight?: boolean
}

function StatCard({ label, value, highlight }: StatCardProps) {
  return (
    <Card className="p-4">
      <CardContent className="flex flex-col gap-1 p-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          className={`text-2xl font-semibold tabular-nums ${
            highlight ? "text-emerald-600 dark:text-emerald-400" : ""
          }`}
        >
          {value}
        </span>
      </CardContent>
    </Card>
  )
}

export default function Overview({ wsMessage }: { wsMessage: WSMessage | null }) {
  const [overview, setOverview] = useState<OverviewStats>({
    sessionCount: 0,
    channelCount: 0,
    messagesToday: 0,
    repliedToday: 0,
    skippedToday: 0,
    errorsToday: 0,
  })

  useEffect(() => {
    get<OverviewStats>("/api/overview")
      .then(setOverview)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (wsMessage?.type === "stats") {
      setOverview(wsMessage.data as OverviewStats)
    }
  }, [wsMessage])

  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard label="Sessions" value={overview.sessionCount} />
      <StatCard label="Channels" value={overview.channelCount} />
      <StatCard label="Messages today" value={overview.messagesToday} />
      <StatCard label="Replied today" value={overview.repliedToday} highlight />
    </div>
  )
}
