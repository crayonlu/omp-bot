import { useCallback, useEffect, useState } from "react";
import { Card, Loading, Select } from "animal-island-ui";
import { get } from "../api";
import type { ActivityEntry } from "../types";

const DECISION: Record<string, { label: string; color: string }> = {
	replied: { label: "已回复", color: "#27ae60" },
	skipped: { label: "已跳过", color: "#95a5a6" },
	error: { label: "错误", color: "#e74c3c" },
};

export default function Activity() {
	const [entries, setEntries] = useState<ActivityEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [filter, setFilter] = useState("all");

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await get<ActivityEntry[]>("/activity?limit=100");
			setEntries(data.reverse());
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { load(); }, [load]);

	const filtered = filter === "all" ? entries : entries.filter((e) => e.decision === filter);

	return (
		<div>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
				<h3>活动日志</h3>
				<Select value={filter} onChange={(v: string) => setFilter(v)} style={{ width: 120 }}>
					<Select.Option value="all">全部</Select.Option>
					<Select.Option value="replied">已回复</Select.Option>
					<Select.Option value="skipped">已跳过</Select.Option>
					<Select.Option value="error">错误</Select.Option>
				</Select>
			</div>

			{loading && <Loading />}

			{!loading && filtered.length === 0 && (
				<Card color="app-blue">
					<p>还没有活动记录。开始对话后这里会显示。</p>
				</Card>
			)}

			<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
				{filtered.map((entry, i) => {
					const d = DECISION[entry.decision] ?? { label: entry.decision, color: "#95a5a6" };
					return (
						<Card key={`${entry.timestamp}-${i}`} color="app-green">
							<div style={{ display: "grid", gridTemplateColumns: "80px 1fr 60px", gap: 10, alignItems: "start", fontSize: 13 }}>
								<div style={{ opacity: 0.6, fontSize: 12 }}>
									{new Date(entry.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
								</div>
								<div>
									<strong>{entry.userName}</strong>
									<div style={{ opacity: 0.8, marginTop: 2 }}>{entry.message.slice(0, 80)}</div>
									{entry.reply && (
										<div style={{ opacity: 0.6, fontSize: 12, marginTop: 4, borderLeft: `2px solid ${d.color}`, paddingLeft: 8 }}>
											{entry.reply.slice(0, 100)}
										</div>
									)}
								</div>
								<div style={{ color: d.color, fontWeight: 600, textAlign: "center", fontSize: 12 }}>
									{d.label}
								</div>
							</div>
						</Card>
					);
				})}
			</div>
		</div>
	);
}
