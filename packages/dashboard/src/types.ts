export interface OverviewStats {
  sessionCount: number
  channelCount: number
  messagesToday: number
  repliedToday: number
  skippedToday: number
  errorsToday: number
}

export interface ChannelConfig {
  targetType: "private" | "group"
  targetId: number
  displayName: string
  triggerMode: "all" | "mention_only" | "smart" | "off"
  keywords?: string[]
}

export interface ActivityEntry {
  timestamp: string
  sessionKey: string
  userId: number
  userName: string
  message: string
  decision: "replied" | "skipped" | "error"
  reason: string
  reply?: string
}

export interface WsEvent {
  type: "activity" | "status" | "session" | "stats"
  entry?: ActivityEntry
  connected?: boolean
  key?: string
  active?: boolean
  overview?: OverviewStats
}