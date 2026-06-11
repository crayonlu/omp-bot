import { useCallback, useEffect, useState } from "react";
import { Card, Tabs } from "animal-island-ui";
import type { OverviewStats, WsEvent } from "./types";
import { useWebSocket } from "./hooks/useWebSocket";
import Overview from "./panels/Overview";
import Channels from "./panels/Channels";
import Persona from "./panels/Persona";
import Activity from "./panels/Activity";
import Settings from "./panels/Settings";

function formatClock(): string {
	const now = new Date();
	return now.toLocaleTimeString("zh-CN", { hour12: false });
}

export default function App() {
	const [onebotOnline, setOnebotOnline] = useState(false);
	const [stats, setStats] = useState<OverviewStats>({
		sessionCount: 0,
		channelCount: 0,
		messagesToday: 0,
		repliedToday: 0,
		skippedToday: 0,
		errorsToday: 0,
	});
	const [clock, setClock] = useState(formatClock);
	const [activeTab, setActiveTab] = useState("overview");

	useEffect(() => {
		const id = setInterval(() => setClock(formatClock()), 1000);
		return () => clearInterval(id);
	}, []);

	const handleStats = useCallback((event: WsEvent & { type: "stats" }) => {
		setStats(event.overview);
	}, []);

	const handleStatus = useCallback((event: WsEvent & { type: "status" }) => {
		setOnebotOnline(event.connected);
	}, []);

	const { lastEvent, status: wsStatus, send } = useWebSocket({
		onStats: handleStats,
		onStatus: handleStatus,
	});

	const isOnline = wsStatus === "connected" && onebotOnline;

	const tabItems = [
		{ key: "overview", label: "概览", children: <Overview stats={stats} /> },
		{ key: "channels", label: "频道", children: <Channels /> },
		{ key: "persona", label: "人格", children: <Persona /> },
		{
			key: "activity",
			label: "动态",
			children: <Activity lastEvent={lastEvent} />,
		},
		{ key: "settings", label: "设置", children: <Settings /> },
	];

	return (
		<div style={{ maxWidth: 960, margin: "0 auto", padding: "16px 12px" }}>
			{/* Header */}
			<Card
				style={{
					marginBottom: 16,
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "12px 20px",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
					<h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
						omp-bot
					</h1>
					<span
						style={{
							display: "inline-block",
							width: 12,
							height: 12,
							borderRadius: "50%",
							background: isOnline ? "#4caf50" : "#f44336",
							boxShadow: isOnline
								? "0 0 6px rgba(76,175,80,0.5)"
								: "0 0 6px rgba(244,67,54,0.5)",
						}}
						title={isOnline ? "QQ 在线" : "QQ 离线"}
					/>
				</div>
				<span style={{ fontFamily: "monospace", fontSize: 16 }}>
					{clock}
				</span>
			</Card>

			<Tabs
				items={tabItems}
				activeKey={activeTab}
				onChange={setActiveTab}
			/>
		</div>
	);
}
