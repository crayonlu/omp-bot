import { useEffect, useState } from "react";
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

interface ActivityEntry {
  id: string;
  time: string;
  user: string;
  message: string;
  decision: "replied" | "skipped" | "deferred";
  reply: string;
}

const decisionLabel: Record<string, string> = {
  replied: "已回复",
  skipped: "已跳过",
  deferred: "推迟",
};

const decisionVariant: Record<string, "default" | "secondary" | "outline"> = {
  replied: "default",
  skipped: "secondary",
  deferred: "outline",
};

export default function Activity() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const path =
      filter === "all"
        ? "/api/activity"
        : `/api/activity?decision=${filter}`;
    get<ActivityEntry[]>(path).then(setEntries).catch(() => {});
  }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">筛选决策:</span>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="replied">已回复</SelectItem>
            <SelectItem value="skipped">已跳过</SelectItem>
            <SelectItem value="deferred">推迟</SelectItem>
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
          {entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="whitespace-nowrap text-xs">{e.time}</TableCell>
              <TableCell>{e.user}</TableCell>
              <TableCell className="max-w-xs truncate">{e.message}</TableCell>
              <TableCell>
                <Badge variant={decisionVariant[e.decision]}>
                  {decisionLabel[e.decision]}
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