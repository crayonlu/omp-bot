/**
 * Dashboard API — HTTP route handlers for the Web dashboard.
 *
 * All routes under /api/. Channel config persisted to /data/channels.json.
 * Activity log is a simple JSONL file at /data/activity.jsonl.
 */
import { logger } from "@oh-my-pi/pi-utils";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchFriends, fetchGroups } from "./qq-tools";
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

const DATA_DIR = resolve(process.env.OMP_BOT_DATA_DIR ?? "/data");
const CHANNELS_FILE = resolve(DATA_DIR, "channels.json");
const ACTIVITY_FILE = resolve(DATA_DIR, "activity.jsonl");

function ensureDataDir(): void {
	if (!existsSync(DATA_DIR)) {
		mkdirSync(DATA_DIR, { recursive: true });
	}
}

// ---------------------------------------------------------------------------
// Channel Config CRUD
// ---------------------------------------------------------------------------

function loadChannels(): Map<string, ChannelConfig> {
	try {
		if (!existsSync(CHANNELS_FILE)) return new Map();
		const raw = readFileSync(CHANNELS_FILE, "utf-8");
		const entries: [string, ChannelConfig][] = JSON.parse(raw);
		return new Map(entries);
	} catch {
		return new Map();
	}
}

function saveChannels(channels: Map<string, ChannelConfig>): void {
	ensureDataDir();
	const entries = Array.from(channels.entries());
	writeFileSync(CHANNELS_FILE, JSON.stringify(entries, null, 2), "utf-8");
	logger.debug(`[dashboard] Saved ${entries.length} channel configs`);
}

let channelStore = loadChannels();

export function getChannelConfigs(): ChannelConfig[] {
	return Array.from(channelStore.values());
}

export function getChannelConfig(key: string): ChannelConfig | undefined {
	return channelStore.get(key);
}

export function setChannelConfig(key: string, config: ChannelConfig): void {
	channelStore.set(key, config);
	saveChannels(channelStore);
}

export function deleteChannelConfig(key: string): boolean {
	const deleted = channelStore.delete(key);
	if (deleted) saveChannels(channelStore);
	return deleted;
}

export function buildChannelKey(type: "private" | "group", id: number): string {
	return `${type}:${id}`;
}

// ---------------------------------------------------------------------------
// Activity Log
// ---------------------------------------------------------------------------

let activityBuffer: ActivityEntry[] = [];
const ACTIVITY_FLUSH_INTERVAL = 5000; // Flush every 5s

export function logActivity(entry: ActivityEntry): void {
	activityBuffer.push(entry);
}

function flushActivity(): void {
	if (activityBuffer.length === 0) return;
	ensureDataDir();
	const lines = activityBuffer.map(e => JSON.stringify(e)).join("\n") + "\n";
	appendFileSync(ACTIVITY_FILE, lines, "utf-8");
	activityBuffer = [];
}

// Periodic flush
setInterval(flushActivity, ACTIVITY_FLUSH_INTERVAL);

export function getRecentActivity(limit = 100): ActivityEntry[] {
	flushActivity(); // Flush pending before reading
	try {
		if (!existsSync(ACTIVITY_FILE)) return [];
		const raw = readFileSync(ACTIVITY_FILE, "utf-8");
		const lines = raw.trim().split("\n").filter(Boolean);
		return lines.slice(-limit).map(l => JSON.parse(l)) as ActivityEntry[];
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Prompt Config
// ---------------------------------------------------------------------------

const PROMPT_FILE = resolve(DATA_DIR, "prompt-override.txt");

export function getPromptOverride(): string | null {
	try {
		if (!existsSync(PROMPT_FILE)) return null;
		return readFileSync(PROMPT_FILE, "utf-8").trim();
	} catch {
		return null;
	}
}

export function setPromptOverride(prompt: string): void {
	ensureDataDir();
	writeFileSync(PROMPT_FILE, prompt, "utf-8");
	logger.info("[dashboard] Prompt override saved");
}

// ---------------------------------------------------------------------------
// Model Config
// ---------------------------------------------------------------------------

export function getAvailableModels(): Array<{ id: string; name: string }> {
	// Parse from OMP models config
	try {
		const modelsPath = resolve(process.env.HOME ?? "/root", ".omp/agent/models.yml");
		if (!existsSync(modelsPath)) return [];
		const raw = readFileSync(modelsPath, "utf-8");
		// Simple YAML line parsing (no external dep needed)
		const models: Array<{ id: string; name: string }> = [];
		let currentId = "";
		for (const line of raw.split("\n")) {
			const idMatch = line.match(/^\s*- id:\s*(.+)/);
			if (idMatch) {
				currentId = idMatch[1].trim();
				models.push({ id: currentId, name: currentId });
			}
			const nameMatch = line.match(/^\s*name:\s*(.+)/);
			if (nameMatch && models.length > 0) {
				models[models.length - 1].name = nameMatch[1].trim();
			}
		}
		return models;
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Session List
// ---------------------------------------------------------------------------

import { listBotSessions } from "./session-manager";

export function getSessionList(): Array<{
	key: string;
	userName: string;
	targetType: string;
	lastActivity: number;
}> {
	return listBotSessions().map(s => ({
		key: s.sessionKey,
		userName: s.config.userName,
		targetType: s.config.targetType,
		lastActivity: s.lastActivity,
	}));
}

// ---------------------------------------------------------------------------
// HTTP Request Handler
// ---------------------------------------------------------------------------

export async function handleDashboardRequest(req: Request): Promise<Response | null> {
	const url = new URL(req.url);
	const path = url.pathname;
	const method = req.method;

	// Dashboard HTML
	if (method === "GET" && (path === "/dashboard" || path === "/")) {
		return serveDashboard();
	}


	// Static assets (JS, CSS, images, etc.)
	if (method === "GET" && path.startsWith("/assets/")) {
		return serveStaticAsset(path);
	}


	// API routes
	if (!path.startsWith("/api/")) return null; // Not a dashboard route

	try {
		return await handleApiRoute(method, path, req, url);
	} catch (err) {
		logger.error(`[dashboard] API error: ${err}`);
		return Response.json({ error: String(err) }, { status: 500 });
	}
}

async function handleApiRoute(method: string, path: string, req: Request, url: URL): Promise<Response> {
	switch (`${method} ${path}`) {
		// Channels
		case "GET /api/channels":
			return Response.json(getChannelConfigs());

		case "POST /api/channels": {
			const cfg = await req.json() as ChannelConfig & { key?: string };
			const key = cfg.key ?? buildChannelKey(cfg.targetType, cfg.targetId);
			const { key: _, ...rest } = cfg;
			setChannelConfig(key, rest);
			return Response.json({ ok: true, key });
		}

		case "DELETE /api/channels": {
			const key = url.searchParams.get("key") ?? "";
			const deleted = deleteChannelConfig(key);
			return Response.json({ ok: deleted });
		}

		// Prompt
		case "GET /api/prompt":
			return Response.json({ prompt: getPromptOverride() });

		case "PUT /api/prompt": {
			const body = await req.json() as { prompt: string };
			setPromptOverride(body.prompt);
			return Response.json({ ok: true });
		}

		// Activity
		case "GET /api/activity": {
			const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
			return Response.json(getRecentActivity(limit));
		}

		// Sessions
		case "GET /api/sessions":
			return Response.json(getSessionList());

		// Models
		case "GET /api/models":
			return Response.json(getAvailableModels());
		// Friends list
		case "GET /api/friends": {
			const friends = await fetchFriends();
			return Response.json(friends);
		}

		// Groups list
		case "GET /api/groups": {
			const groups = await fetchGroups();
			return Response.json(groups);
		}

		// Overview (aggregated stats)
		case "GET /api/overview": {
			const activity = getRecentActivity(200);
			const today = activity.filter(e => {
				const d = new Date(e.timestamp);
				const now = new Date();
				return d.toDateString() === now.toDateString();
			});
			return Response.json({
				sessionCount: getSessionList().length,
				channelCount: getChannelConfigs().length,
				messagesToday: today.length,
				repliedToday: today.filter(e => e.decision === "replied").length,
				skippedToday: today.filter(e => e.decision === "skipped").length,
				errorsToday: today.filter(e => e.decision === "error").length,
			});
		}

		// Health (already exists but add here for completeness)
		case "GET /api/health":
			return Response.json({ status: "ok" });

		default:
			return Response.json({ error: "Not Found" }, { status: 404 });
	}
}

// ---------------------------------------------------------------------------
// Static file serving (dashboard HTML + assets)
// ---------------------------------------------------------------------------

const DASHBOARD_DIR = "/app/dashboard";

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript",
	".mjs": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

function getMimeType(filePath: string): string {
	const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
	return MIME_TYPES[ext] ?? "application/octet-stream";
}

function serveDashboard(): Response {
	try {
		const html = readFileSync(resolve(DASHBOARD_DIR, "index.html"), "utf-8");
		return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
	} catch {
		return new Response(
			`<!DOCTYPE html><html><body><h1>Dashboard not found</h1></body></html>`,
			{ status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
		);
	}
}

function serveStaticAsset(path: string): Response {
	try {
		// Strip leading "/assets/" and resolve under DASHBOARD_DIR/assets
		const relative = path.slice("/assets/".length);
		const filePath = resolve(DASHBOARD_DIR, "assets", relative);
		// Prevent directory traversal
		if (!filePath.startsWith(resolve(DASHBOARD_DIR, "assets"))) {
			return new Response("Forbidden", { status: 403 });
		}
		const data = readFileSync(filePath);
		return new Response(data, { headers: { "Content-Type": getMimeType(filePath) } });
	} catch {
		return new Response("Not Found", { status: 404 });
	}
}

