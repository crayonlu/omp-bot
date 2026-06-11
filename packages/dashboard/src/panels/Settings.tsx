import { useCallback, useEffect, useState } from "react";
import { Button, Card, Loading, Select } from "animal-island-ui";
import { get, post } from "../api";
import type { ModelOption, PluginInfo } from "../types";

export default function Settings() {
	const [models, setModels] = useState<ModelOption[]>([]);
	const [selectedModel, setSelectedModel] = useState("");
	const [plugins, setPlugins] = useState<PluginInfo[]>([]);
	const [webSearch, setWebSearch] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [installing, setInstalling] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [modelData, pluginData] = await Promise.all([
				get<ModelOption[]>("/api/models").catch(() => [] as ModelOption[]),
				get<PluginInfo[]>("/api/plugins").catch(() => [] as PluginInfo[]),
			]);
			setModels(modelData);
			if (modelData.length > 0 && !selectedModel) {
				setSelectedModel(modelData[0].id);
			}
			setPlugins(pluginData);
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	const loadWebSearch = useCallback(async () => {
		try {
			const data = await get<{ enabled: boolean }>(
				"/api/web-search/status",
			);
			setWebSearch(data.enabled);
		} catch {
			// endpoint may not exist yet
		}
	}, []);

	useEffect(() => {
		load();
		loadWebSearch();
	}, [load, loadWebSearch]);

	const handleModelChange = useCallback(
		async (id: string) => {
			setSelectedModel(id);
			try {
				await post("/api/config", { model: id });
			} catch (err) {
				setError(String(err));
			}
		},
		[],
	);

	const handleInstall = useCallback(
		async (name: string) => {
			setInstalling(name);
			try {
				await post("/api/plugins/install", { name });
				await load();
			} catch (err) {
				setError(String(err));
			} finally {
				setInstalling(null);
			}
		},
		[load],
	);

	if (loading) return <Loading />;

	return (
		<Card>
			{error && (
				<div style={{ color: "#e53935", marginBottom: 12 }}>
					错误: {error}
				</div>
			)}

			{/* Model Selector */}
			<Card
				color="app-blue"
				style={{ marginBottom: 16, padding: 16 }}
			>
				<div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
					模型选择
				</div>
				{models.length > 0 ? (
					<Select
						options={models.map((m) => ({
							key: m.id,
							label: m.name,
						}))}
						value={selectedModel}
						onChange={handleModelChange}
						placeholder="选择模型"
					/>
				) : (
					<div style={{ opacity: 0.6 }}>暂无可用模型</div>
				)}
			</Card>

			{/* Plugin List */}
			<Card
				color="app-yellow"
				style={{ marginBottom: 16, padding: 16 }}
			>
				<div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
					插件管理
				</div>
				{plugins.length === 0 ? (
					<div style={{ opacity: 0.6 }}>暂无插件</div>
				) : (
					<div
						style={{
							display: "grid",
							gridTemplateColumns:
								"repeat(auto-fit, minmax(200px, 1fr))",
							gap: 12,
						}}
					>
						{plugins.map((p) => (
							<Card
								key={p.name}
								color={
									p.status === "installed"
										? "app-green"
										: "default"
								}
								style={{ padding: 12 }}
							>
								<div
									style={{
										fontWeight: 600,
										marginBottom: 4,
									}}
								>
									{p.name}
								</div>
								<div
									style={{
										fontSize: 12,
										opacity: 0.6,
										marginBottom: 8,
									}}
								>
									{p.status === "installed"
										? "已安装"
										: "可用"}
								</div>
								{p.description && (
									<div
										style={{
											fontSize: 13,
											marginBottom: 8,
										}}
									>
										{p.description}
									</div>
								)}
								{p.status !== "installed" && (
									<Button
										type="primary"
										size="small"
										loading={installing === p.name}
										onClick={() => handleInstall(p.name)}
									>
										安装
									</Button>
								)}
							</Card>
						))}
					</div>
				)}
			</Card>

			{/* Web Search Status */}
			<Card
				color="app-green"
				style={{ padding: 16 }}
			>
				<div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
					网络搜索
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
					}}
				>
					<span
						style={{
							display: "inline-block",
							width: 10,
							height: 10,
							borderRadius: "50%",
							background: webSearch ? "#4caf50" : "#ccc",
						}}
					/>
					<span>{webSearch ? "已启用" : "未启用"}</span>
				</div>
			</Card>
		</Card>
	);
}
