import { Card } from "animal-island-ui";
import type { OverviewStats } from "../types";

const statCards: Array<{
	key: keyof OverviewStats;
	label: string;
	color: string;
}> = [
	{ key: "messagesToday", label: "今日消息", color: "app-blue" },
	{ key: "repliedToday", label: "已回复", color: "app-green" },
	{ key: "skippedToday", label: "已跳过", color: "app-yellow" },
	{ key: "sessionCount", label: "活跃会话", color: "app-blue" },
];

export default function Overview({ stats }: { stats: OverviewStats }) {
	return (
		<Card>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
					gap: 16,
				}}
			>
				{statCards.map(({ key, label, color }) => (
					<Card
						key={key}
						color={color as "app-blue" | "app-green" | "app-yellow"}
						style={{ textAlign: "center", padding: "24px 16px" }}
					>
						<div style={{ fontSize: 36, fontWeight: 700 }}>
							{stats[key] ?? 0}
						</div>
						<div style={{ fontSize: 14, marginTop: 8, opacity: 0.85 }}>
							{label}
						</div>
					</Card>
				))}
			</div>
		</Card>
	);
}
