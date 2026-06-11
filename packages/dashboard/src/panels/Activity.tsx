import { useCallback, useEffect, useState } from "react";
import { Card, Loading, Select, Table } from "animal-island-ui";
import { get } from "../api";
import type { ActivityEntry, WsEvent } from "../types";

const DECISION_LABELS: Record<string, string> = {
	replied: "已回复",
	skipped: "已跳过",
	error: "错误",
};

const DECISION_COLORS: Record<string, string> = {
	replied: "#4caf50",
	skipped: "#ff9800",
	error: "#f44336",
};

const FILTER_OPTIONS = [
	{ key: "all", label: "全部" },
	{ key: "replied", label: "已回复" },
	{ key: "skipped", label: "已跳过" },
	{ key: "error", label: "错误" },
];

interface Props {
	lastEvent: WsEvent | null;
}

export default function Activity({ lastEvent }: Props) {
	const [entries, setEntries] = useState<ActivityEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState("all");

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await get<ActivityEntry[]>(
				"/api/activity?limit=100",
			);
			setEntries(data);
		} catch (err) {
			setError(String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	// Prepend new WS activity events
	useEffect(() => {
		if (lastEvent?.type === "activity") {
			setEntries((prev) => [lastEvent.entry, ...prev].slice(0, 100));
		}
	}, [lastEvent]);

	if (loading) return <Loading />;

	const filtered =
		filter === "all"
			? entries
			: entries.filter((e) => e.decision === filter);

	return (
		<Card>
			{error && (
				<div style={{ color: "#e53935", marginBottom: 12 }}>
					错误: {error}
				</div>
			)}

			<div style={{ marginBottom: 16 }}>
				<Select
					options={FILTER_OPTIONS}
					value={filter}
					onChange={setFilter}
					placeholder="筛选类型"
				/>
			</div>

			<Table
				columns={[
					{
						title: "时间",
						dataIndex:
							"timestamp" as keyof Record<string, unknown>,
						width: 160,
						render: (_val, record) => {
							const ts = record.timestamp as string;
							try {
								const d = new Date(ts);
								return d.toLocaleTimeString("zh-CN", {
									hour12: false,
								});
							} catch {
								return ts;
							}
						},
					},
					{
						title: "用户",
						dataIndex:
							"userName" as keyof Record<string, unknown>,
						width: 100,
						render: (_val, record) =>
							String(record.userName ?? ""),
					},
					{
						title: "消息",
						dataIndex:
							"message" as keyof Record<string, unknown>,
						render: (_val, record) => {
							const msg = String(record.message ?? "");
							return msg.length > 60
								? `${msg.slice(0, 60)}…`
								: msg;
						},
					},
					{
						title: "决策",
						dataIndex:
							"decision" as keyof Record<string, unknown>,
						width: 80,
						render: (_val, record) => {
							const dec = String(record.decision ?? "");
							return (
								<span
									style={{
										color:
											DECISION_COLORS[dec] ?? "#888",
										fontWeight: 600,
									}}
								>
									{DECISION_LABELS[dec] ?? dec}
								</span>
							);
						},
					},
					{
						title: "原因 / 回复",
						dataIndex:
							"reason" as keyof Record<string, unknown>,
						render: (_val, record) => {
							const dec = String(record.decision ?? "");
							const reply = record.reply as string | undefined;
							const reason = String(record.reason ?? "");
							if (dec === "replied" && reply) {
								const short =
									reply.length > 40
										? `${reply.slice(0, 40)}…`
										: reply;
								return short;
							}
							return reason;
						},
					},
				]}
				dataSource={filtered as unknown as Record<string, unknown>[]}
				rowKey={(record) => {
					const e = record as unknown as ActivityEntry;
					return `${e.timestamp}-${e.sessionKey}`;
				}}
				emptyText="暂无活动记录"
			/>
		</Card>
	);
}
