import { useCallback, useEffect, useState } from "react";
import { Button, Card, Loading, Modal } from "animal-island-ui";
import { get, put, del } from "../api";

const PREVIEW_LEN = 200;

export default function Persona() {
	const [prompt, setPrompt] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [modalOpen, setModalOpen] = useState(false);
	const [editText, setEditText] = useState("");
	const [saving, setSaving] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await get<{ prompt: string | null }>("/api/prompt");
			setPrompt(data.prompt);
			setEditText(data.prompt ?? "");
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const handleEdit = () => {
		setEditText(prompt ?? "");
		setModalOpen(true);
	};

	const handleSave = async () => {
		setSaving(true);
		try {
			await put("/api/prompt", { prompt: editText });
			setPrompt(editText);
			setModalOpen(false);
		} catch (err) {
			setError(String(err));
		} finally {
			setSaving(false);
		}
	};

	const handleReset = async () => {
		try {
			await del("/api/prompt");
			setPrompt(null);
			setEditText("");
		} catch (err) {
			setError(String(err));
		}
	};

	if (loading) return <Loading />;

	const preview =
		prompt && prompt.length > PREVIEW_LEN
			? `${prompt.slice(0, PREVIEW_LEN)}…`
			: prompt ?? "（未设置人格覆盖）";

	return (
		<Card>
			{error && (
				<div style={{ color: "#e53935", marginBottom: 12 }}>
					错误: {error}
				</div>
			)}

			<Card color="app-blue" style={{ marginBottom: 16, padding: 16 }}>
				<div style={{ fontSize: 14, opacity: 0.7, marginBottom: 8 }}>
					当前人格预览
				</div>
				<div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
					{preview}
				</div>
			</Card>

			<div style={{ display: "flex", gap: 8 }}>
				<Button type="primary" onClick={handleEdit}>
					编辑人格
				</Button>
				{prompt && (
					<Button danger onClick={handleReset}>
						重置为默认
					</Button>
				)}
			</div>

			<Modal
				open={modalOpen}
				onClose={() => setModalOpen(false)}
				title="编辑人格"
				footer={
					<>
						<Button onClick={() => setModalOpen(false)}>取消</Button>
						<Button type="primary" onClick={handleSave} loading={saving}>
							保存
						</Button>
					</>
				}
			>
				<textarea
					style={{
						width: "100%",
						minHeight: 200,
						padding: 12,
						border: "1px solid #d4c9b4",
						borderRadius: 12,
						fontSize: 14,
						fontFamily: "inherit",
						resize: "vertical",
						background: "#fefaf3",
						color: "#5c4a3a",
					}}
					placeholder="输入系统提示词…"
					value={editText}
					onChange={(e) => setEditText(e.target.value)}
				/>
			</Modal>
		</Card>
	);
}
