import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { get, put } from "../api";

const defaultPrompt = "你是一个有用的 AI 助手。";

export default function Persona() {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    get<{ prompt: string }>("/api/prompt")
      .then((d) => {
        setPrompt(d.prompt);
        setEditValue(d.prompt);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    await put("/api/prompt", { prompt: editValue });
    setPrompt(editValue);
    setEditOpen(false);
  };

  const handleReset = async () => {
    await put("/api/prompt", { prompt: defaultPrompt });
    setPrompt(defaultPrompt);
    setEditValue(defaultPrompt);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>当前人格提示词</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 whitespace-pre-wrap rounded border bg-muted p-3 text-sm">
            {prompt}
          </p>
          <div className="flex gap-2">
            <Button onClick={() => { setEditValue(prompt); setEditOpen(true); }}>
              编辑
            </Button>
            <Button variant="outline" onClick={handleReset}>
              重置默认
            </Button>
          </div>
        </CardContent>
      </Card>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑人格提示词</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <textarea
              className="h-48 w-full rounded border border-input bg-transparent p-3 text-sm"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
            />
            <Button onClick={handleSave} className="w-full">
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}