import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { get, put } from "../api";

interface SettingsData {
  model: string;
  status: string;
}

export default function Settings() {
  const [settings, setSettings] = useState<SettingsData>({
    model: "gpt-4",
    status: "unknown",
  });
  const [models] = useState([
    "gpt-4",
    "gpt-4o",
    "gpt-4o-mini",
    "claude-3-opus",
    "claude-3-sonnet",
    "claude-3-haiku",
  ]);

  useEffect(() => {
    get<SettingsData>("/api/settings").then(setSettings).catch(() => {});
  }, []);

  const handleModelChange = async (model: string) => {
    setSettings((s) => ({ ...s, model }));
    try {
      await put("/api/settings", { model });
    } catch {
      // revert on failure
      get<SettingsData>("/api/settings").then(setSettings).catch(() => {});
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>模型选择</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={settings.model} onValueChange={handleModelChange}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>运行状态</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {settings.status === "running"
              ? "运行中"
              : settings.status === "stopped"
                ? "已停止"
                : settings.status}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}