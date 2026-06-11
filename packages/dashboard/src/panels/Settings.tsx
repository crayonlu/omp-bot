import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { get } from "../api";


export default function Settings() {
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      get<Array<{ id: string; name: string }>>("/api/models"),
      get<{ onebot_connected?: boolean }>("/health"),
    ])
      .then(([modelList, health]) => {
        setModels(modelList);
        if (modelList.length > 0) setSelectedModel(modelList[0].id);
        setConnected(health.onebot_connected ?? null);
      })
      .catch(() => setError("无法加载设置"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground p-4">加载中...</div>;
  }

  if (error) {
    return <div className="text-sm text-red-500 p-4">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>模型选择</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>连接状态</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {connected === true && "已连接"}
            {connected === false && "未连接"}
            {connected === null && "未知"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}