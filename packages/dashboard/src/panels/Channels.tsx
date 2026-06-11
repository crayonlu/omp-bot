import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Loading, Modal, Select, Table } from "animal-island-ui";
import { get, post, del } from "../api";
import type { ChannelConfig } from "../types";

const TRIGGER_MODES = [
	{ key: "all", label: "全部消息" },
	{ key: "mention_only", label: "仅 @提及" },
	{ key: "smart", label: "智能判断" },
	{ key: "off", label: "关闭" },
];

const TARGET_TYPES = [
	{ key: "private", label: "私聊" },
	{ key: "group", label: "群聊" },
];

const defaults: ChannelConfig = {
	targetId: 0,
	targetType: "private",
	displayName: "",
	triggerMode: "all",
	keywords: [],
};

function buildKey(type: string, id: number): string {
	return `${type}:${id}`;
}

export default function Channels() {
	const [channels, setChannels] = useState<ChannelConfig[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [modalOpen, setModalOpen] = useState(false);
	const [form, setForm] = useState<ChannelConfig>({ ...defaults });
	const [saving, setSaving] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await get<ChannelConfig[]>("/api/channels");
			setChannels(data);
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const handleAdd = () => {
		setForm({ ...defaults });
		setModalOpen(true);
	};

	const handleSave = async () => {
		setSaving(true);
		try {
			await post("/api/channels", form);
			setModalOpen(false);
			await load();
		} catch (err) {
			setError(String(err));
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (cfg: ChannelConfig) => {
		const key = buildKey(cfg.targetType, cfg.targetId);
		try {
			await del(`/api/channels?key=${encodeURIComponent(key)}`);
			await load();
		} catch (err) {
			setError(String(err));
		}
	};

	if (loading) return <Loading />;

	return (
		<Card>
			{error && (
				<div style={{ color: "#e53935", marginBottom: 12 }}>
					错误: {error}
				</div>
			)}

			<div style={{ marginBottom: 16 }}>
				<Button onClick={handleAdd}>添加频道</Button>
			</div>

			<Table
				columns={[
					{
						title: "类型",
						dataIndex: "targetTypeLabel" as keyof Record<string, unknown>,
						render: (_val, record) => {
							const t = TARGET_TYPES.find(
								(t) => t.key === record.targetType,
							);
							return t?.label ?? String(record.targetType ?? "");
						},
					},
					{
						title: "ID",
						dataIndex: "targetId" as keyof Record<string, unknown>,
						render: (_val, record) => String(record.targetId ?? ""),
					},
					{
						title: "名称",
						dataIndex: "displayName" as keyof Record<string, unknown>,
						render: (_val, record) =>
							String(record.displayName ?? ""),
					},
					{
						title: "模式",
						dataIndex: "triggerMode" as keyof Record<string, unknown>,
						render: (_val, record) => {
							const m = TRIGGER_MODES.find(
								(m) => m.key === record.triggerMode,
							);
							return m?.label ?? String(record.triggerMode ?? "");
						},
					},
					{
						title: "关键词",
						dataIndex: "keywords" as keyof Record<string, unknown>,
						render: (_val, record) => {
							const kw = record.keywords as string[] | undefined;
							return (kw ?? []).join(", ");
						},
					},
					{
						title: "操作",
						dataIndex: "targetId" as keyof Record<string, unknown>,
						render: (_val, record) => (
							<Button
								danger
								onClick={() =>
									handleDelete(record as unknown as ChannelConfig)
								}
							>
								删除
							</Button>
						),
					},
				]}
				dataSource={channels as unknown as Record<string, unknown>[]}
				rowKey={(record) => {
					const c = record as unknown as ChannelConfig;
					return buildKey(c.targetType, c.targetId);
				}}
			/>

			<Modal
				open={modalOpen}
				onClose={() => setModalOpen(false)}
				title="添加频道"
				footer={
					<>
						<Button onClick={() => setModalOpen(false)}>取消</Button>
						<Button type="primary" onClick={handleSave} loading={saving}>
							保存
						</Button>
					</>
				}
			>
				<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
					<Select
						options={TARGET_TYPES}
						value={form.targetType}
						onChange={(v) =>
							setForm((f) => ({
								...f,
								targetType: v as "private" | "group",
							}))
						}
						placeholder="选择类型"
					/>
					<Input
						placeholder="目标 ID"
						type="number"
						value={String(form.targetId || "")}
						onChange={(e) =>
							setForm((f) => ({
								...f,
								targetId: Number(e.target.value) || 0,
							}))
						}
					/>
					<Input
						placeholder="显示名称"
						value={form.displayName}
						onChange={(e) =>
							setForm((f) => ({ ...f, displayName: e.target.value }))
						}
					/>
					<Select
						options={TRIGGER_MODES}
						value={form.triggerMode}
						onChange={(v) =>
							setForm((f) => ({
								...f,
								triggerMode: v as ChannelConfig["triggerMode"],
							}))
						}
						placeholder="选择触发模式"
					/>
					<Input
						placeholder="关键词（逗号分隔）"
						value={(form.keywords ?? []).join(", ")}
						onChange={(e) =>
							setForm((f) => ({
								...f,
								keywords: e.target.value
									.split(",")
									.map((k) => k.trim())
									.filter(Boolean),
							}))
						}
					/>
				</div>
			</Modal>
		</Card>
	);
}
