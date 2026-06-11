/** Shared types matching backend API responses. */

export interface ChannelConfig {
	targetId: number;
	targetType: "private" | "group";
	displayName: string;
	triggerMode: "all" | "mention_only" | "smart" | "off";
	keywords?: string[];
	ignoreUsers?: number[];
}

export interface ActivityEntry {
	timestamp: string;
	sessionKey: string;
	userId: number;
	userName: string;
	message: string;
	decision: "replied" | "skipped" | "error";
	reason: string;
	reply?: string;
}

export interface OverviewStats {
	sessionCount: number;
	channelCount: number;
	messagesToday: number;
	repliedToday: number;
	skippedToday: number;
	errorsToday: number;
}

export interface SessionSummary {
	key: string;
	userName: string;
	targetType: string;
	lastActivity: number;
}

export interface ModelOption {
	id: string;
	name: string;
}

export interface PluginInfo {
	name: string;
	status: "installed" | "available";
	description?: string;
}

// WebSocket event types
export interface WsActivityEvent {
	type: "activity";
	entry: ActivityEntry;
}

export interface WsStatsEvent {
	type: "stats";
	overview: OverviewStats;
}

export interface WsStatusEvent {
	type: "status";
	connected: boolean;
}

export interface WsSessionEvent {
	type: "session";
	key: string;
	active: boolean;
}

export type WsEvent = WsActivityEvent | WsStatsEvent | WsStatusEvent | WsSessionEvent;
