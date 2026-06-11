import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { get } from "../api";
import type { ActivityEntry as ActivityEntryType } from "../types";
import type { WSMessage } from "../hooks/useWebSocket";


const decisionLabel: Record<string, string> = {
  replied: "已回复",
  skipped: "已跳过",
  error: "错误",
};

const decisionVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  replied: "default",
  skipped: "secondary",
  error: "destructive",
};

export default function Activity({ wsMessage }: { wsMessage: WSMessage | null }) {
  const [entries, setEntries] = useState<ActivityEntryType[]>([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const path =
      filter === "all"
        ? "/api/activity?limit=100"
        : `/api/activity?limit=100&decision=${filter}`;
    get<ActivityEntryType[]>(path).then(setEntries).catch(() => {});
  }, [filter]);
  useEffect(() => {
    if (wsMessage?.type === "activity") {
      setEntries((prev) => [wsMessage.data as ActivityEntryType, ...prev]);
    }
  }, [wsMessage]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-7 w-24 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">全部</SelectItem>
            <SelectItem value="replied" className="text-xs">已回复</SelectItem>
            <SelectItem value="skipped" className="text-xs">已跳过</SelectItem>
            <SelectItem value="error" className="text-xs">错误</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>时间</TableHead>
            <TableHead>用户</TableHead>
            <TableHead>消息</TableHead>
            <TableHead>决策</TableHead>
            <TableHead>回复</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e, i) => (
            <TableRow key={`${e.sessionKey}-${e.timestamp}-${i}`}>
              <TableCell className="whitespace-nowrap text-xs">{e.timestamp}</TableCell>
              <TableCell>{e.userName}</TableCell>
              <TableCell className="max-w-xs truncate">{e.message}</TableCell>
              <TableCell>
                <Badge variant={decisionVariant[e.decision] || "outline"}>
                  {decisionLabel[e.decision] || e.decision}
                </Badge>
              </TableCell>
              <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                {e.reply || "—"}
              </TableCell>
            </TableRow>
          ))}
          {entries.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                暂无活动
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}