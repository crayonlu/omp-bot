import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { get, post, del } from "../api";
import type { ChannelConfig } from "../types";


export default function Channels() {
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [open, setOpen] = useState(false);
  const [targetType, setTargetType] = useState<"private" | "group">("private");
  const [targetId, setTargetId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [triggerMode, setTriggerMode] = useState<"all" | "mention_only" | "smart" | "off">("smart");
  const [keywords, setKeywords] = useState("");

  const fetchChannels = useCallback(() => {
    get<ChannelConfig[]>("/api/channels").then(setChannels).catch(() => {});
  }, []);

  useEffect(() => {
    fetchChannels();
  }, []);

  const handleAdd = async () => {
    await post("/api/channels", {
      targetType,
      targetId: Number(targetId),
      displayName,
      triggerMode,
      keywords: keywords ? keywords.split(",").map((k) => k.trim()).filter(Boolean) : [],
    });
    setOpen(false);
    setDisplayName("");
    setTargetId("");
    setKeywords("");
    fetchChannels();
  };

  const handleDelete = async (ch: ChannelConfig) => {
    await del(`/api/channels?targetType=${ch.targetType}&targetId=${ch.targetId}`);
    fetchChannels();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">频道列表</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="default">添加频道</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>添加频道</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">目标类型</label>
                <Select value={targetType} onValueChange={(v) => setTargetType(v as "private" | "group")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="group">Group</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">目标 ID</label>
                <Input value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="数字 ID" type="number" />
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">显示名称</label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="频道名称" />
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">触发模式</label>
                <Select value={triggerMode} onValueChange={(v) => setTriggerMode(v as "all" | "mention_only" | "smart" | "off")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="mention_only">仅提及</SelectItem>
                    <SelectItem value="smart">智能</SelectItem>
                    <SelectItem value="off">关闭</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">关键词 (逗号分隔)</label>
                <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="关键词1,关键词2" />
              </div>
              <Button onClick={handleAdd} className="w-full">确认添加</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>目标类型</TableHead>
            <TableHead>目标 ID</TableHead>
            <TableHead>显示名称</TableHead>
            <TableHead>触发模式</TableHead>
            <TableHead className="w-20">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {channels.map((ch, i) => (
              <TableRow key={`${ch.targetType}-${ch.targetId}-${i}`}>
                <TableCell className="capitalize">{ch.targetType}</TableCell>
                <TableCell className="font-mono text-xs">{ch.targetId}</TableCell>
                <TableCell>{ch.displayName}</TableCell>
                <TableCell>{ch.triggerMode}</TableCell>
                <TableCell>
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={() => handleDelete(ch)}
                  >
                    删除
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {channels.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  暂无频道
                </TableCell>
              </TableRow>
            )}
        </TableBody>
      </Table>
    </div>
  );
}