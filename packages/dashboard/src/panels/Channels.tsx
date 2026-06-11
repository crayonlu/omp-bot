import { useEffect, useState } from "react";
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

interface Channel {
  id: string;
  type: string;
  name: string;
  mode: string;
}

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("qq");
  const [name, setName] = useState("");
  const [mode, setMode] = useState("listen");

  const fetchChannels = () => {
    get<Channel[]>("/api/channels").then(setChannels).catch(() => {});
  };

  useEffect(() => {
    fetchChannels();
  }, []);

  const handleAdd = async () => {
    await post<Channel>("/api/channels", { type, name, mode });
    setOpen(false);
    setName("");
    fetchChannels();
  };

  const handleDelete = async (id: string) => {
    await del(`/api/channels/${id}`);
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
                <label className="mb-1 block text-sm text-muted-foreground">类型</label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="qq">QQ</SelectItem>
                    <SelectItem value="discord">Discord</SelectItem>
                    <SelectItem value="telegram">Telegram</SelectItem>
                    <SelectItem value="wechat">微信</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">名称</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="频道名称" />
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">模式</label>
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="listen">监听</SelectItem>
                    <SelectItem value="chat">聊天</SelectItem>
                    <SelectItem value="broadcast">广播</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleAdd} className="w-full">确认添加</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>类型</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>名称</TableHead>
            <TableHead>模式</TableHead>
            <TableHead className="w-20">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {channels.map((ch) => (
            <TableRow key={ch.id}>
              <TableCell className="capitalize">{ch.type}</TableCell>
              <TableCell className="font-mono text-xs">{ch.id}</TableCell>
              <TableCell>{ch.name}</TableCell>
              <TableCell>{ch.mode}</TableCell>
              <TableCell>
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={() => handleDelete(ch.id)}
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