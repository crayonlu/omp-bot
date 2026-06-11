import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Loading, Modal, Select } from "animal-island-ui";
import { get, post, del } from "../api";
import type { ChannelConfig } from "../types";

const TRIGGER_MODES: Array<{ key: ChannelConfig["triggerMode"]; label: string }> = [
	{ key: "all", label: "所有消息" },
	{ key: "mention_only", label: "仅被@时" },
	{ key: "smart", label: "智能触发" },
	{ key: "off", label: "关闭" },
];

const TARGET_TYPES: Array<{ key: ChannelConfig["targetType"]; label: string }> = [
	{ key: "private", label: "私聊" },
	{ key: "group", label: "群聊" },
];

interface ChannelForm {
	targetType: ChannelConfig["targetType"];
	targetId: string;
	displayName: string;
	triggerMode: ChannelConfig["triggerMode"];
	keywords: string;
}

const emptyForm: ChannelForm = {
	targetType: "private",
	targetId: "",
	displayName: "",
	triggerMode: "all",
	keywords: "",
};

export default function Channels() {
	const [channels, setChannels] = useState<ChannelConfig[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showModal, setShowModal] = useState(false);
	const [form, setForm] = useState<ChannelForm>(emptyForm);

	const load = useCallback(async () => {
		try {
			setLoading(true);
			const data = await get<ChannelConfig[]>("/channels");
			setChannels(data);
			setError(null);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { load(); }, [load]);

	const handleRemove = useCallback(async (key: string) => {
		await del(`/channels?key=${encodeURIComponent(key)}`);
		load();
	}, [load]);

	const handleAdd = useCallback(async () => {
		const id = parseInt(form.targetId, 10);
		if (!id) return;
		await post("/channels", {
			targetType: form.targetType,
			targetId: id,
			displayName: form.displayName || `user_${id}`,
			triggerMode: form.triggerMode,
			keywords: form.keywords ? form.keywords.split(",").map((k: string) => k.trim()) : [],
		});
		setShowModal(false);
		setForm(emptyForm);
		load();
	}, [form, load]);

	const setField = <K extends keyof ChannelForm>(key: K) =>
		(e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

	return (
		<div>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
				<h3>频道管理</h3>
				<Button onClick={() => setShowModal(true)}>添加频道</Button>
			</div>

			{loading && <Loading />}
			{error && <div style={{ color: "#e74c3c", marginBottom: 12 }}>错误: {error}</div>}

			{!loading && channels.length === 0 && (
				<Card color="app-blue">
					<p>还没有配置任何频道。默认行为: 私聊指向所有消息触发, 群聊指向仅被@触发。</p>
				</Card>
			)}

			<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
				{channels.map((ch) => {
					const typeLabel = TARGET_TYPES.find((t) => t.key === ch.targetType)?.label ?? ch.targetType;
					const modeLabel = TRIGGER_MODES.find((m) => m.key === ch.triggerMode)?.label ?? ch.triggerMode;
					return (
						<Card key={`${ch.targetType}:${ch.targetId}`} color="app-green">
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr auto", gap: 12, alignItems: "center" }}>
								<div>
									<small style={{ opacity: 0.6 }}>类型</small>
									<div>{typeLabel}</div>
								</div>
								<div>
									<small style={{ opacity: 0.6 }}>QQ ID</small>
									<div>{ch.targetId}</div>
								</div>
								<div>
									<small style={{ opacity: 0.6 }}>{ch.displayName}</small>
									<div style={{ fontSize: 12, opacity: 0.7 }}>
										{modeLabel}
										{ch.keywords && ch.keywords.length > 0 && ` · ${ch.keywords.join(", ")}`}
									</div>
								</div>
								<Button onClick={() => handleRemove(`${ch.targetType}:${ch.targetId}`)}>删除</Button>
							</div>
						</Card>
					);
				})}
			</div>

			<Modal visible={showModal} onCancel={() => setShowModal(false)} title="添加频道" footer={null}>
				<div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
					<Select value={form.targetType} onChange={(v: string) => setForm({ ...form, targetType: v as ChannelConfig["targetType"] })}>
						{TARGET_TYPES.map((t) => (
							<Select.Option key={t.key} value={t.key}>{t.label}</Select.Option>
						))}
					</Select>
					<Input placeholder="QQ 号或群号" value={form.targetId} onChange={setField("targetId")} />
					<Input placeholder="显示名称 (可选)" value={form.displayName} onChange={setField("displayName")} />
					<Select value={form.triggerMode} onChange={(v: string) => setForm({ ...form, triggerMode: v as ChannelConfig["triggerMode"] })}>
						{TRIGGER_MODES.map((m) => (
							<Select.Option key={m.key} value={m.key}>{m.label}</Select.Option>
						))}
					</Select>
					<Input placeholder="关键词, 逗号分隔 (smart 模式)" value={form.keywords} onChange={setField("keywords")} />
					<Button onClick={handleAdd}>确认添加</Button>
				</div>
			</Modal>
		</div>
	);
}
