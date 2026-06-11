import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { get } from "../api";
import type { WSMessage } from "../hooks/useWebSocket";

interface OverviewData {
  messagesToday: number;
  replied: number;
  skipped: number;
  activeSessions: number;
}

const initial: OverviewData = {
  messagesToday: 0,
  replied: 0,
  skipped: 0,
  activeSessions: 0,
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
    <div className="grid grid-cols-2 gap-4">
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
          <p className="text-3xl font-bold text-green-600">{data.replied}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">已跳过</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-yellow-600">{data.skipped}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">活跃会话</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-blue-600">{data.activeSessions}</p>
        </CardContent>
      </Card>
    </div>
  );
}