import { useEffect, useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { get } from "../api";
import type { WSMessage } from "../hooks/useWebSocket";
interface OverviewData {
  sessionCount: number
  channelCount: number
  messagesToday: number
  repliedToday: number
  skippedToday: number
  errorsToday: number
}

const initial: OverviewData = {
  sessionCount: 0,
  channelCount: 0,
  messagesToday: 0,
  repliedToday: 0,
  skippedToday: 0,
  errorsToday: 0,
};

export default function Overview({ wsMessage }: { wsMessage: WSMessage | null }) {
  const [data, setData] = useState<OverviewData>(initial);

  useEffect(() => {
    get<OverviewData>("/api/overview").then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    if (wsMessage?.type === "stats") {
      setData(wsMessage.data as OverviewData);
    }
  }, [wsMessage]);

  return (
    <div className="grid grid-cols-3 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">今日消息</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{data.messagesToday}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">已回复</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-green-600">{data.repliedToday}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">已跳过</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-yellow-600">{data.skippedToday}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">活跃会话</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-blue-600">{data.sessionCount}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">频道数</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-purple-600">{data.channelCount}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">错误</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-red-600">{data.errorsToday}</p>
        </CardContent>
      </Card>
    </div>
  );
}