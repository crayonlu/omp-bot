/**
 * Bot Runner — wires OneBot gateway, message queue, and middleware pipeline.
 * v5: middleware architecture — ingress/enrich/format/stream/respond separated.
 */
import { $, type ServerWebSocket } from "bun";
import { logger } from "@oh-my-pi/pi-utils";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import type { Args } from "../cli/args";
import { OneBotGateway, type OneBotMessageEvent } from "./onebot-gateway";
import { MessageQueue } from "./message-queue";
import { qqSendMessage, sendAction, setWsSender, setEchoRegisterer } from "./qq-tools";
import { setEnrichSendAction } from "./middleware/enrich";
import { setRespondSendMsg } from "./middleware/respond";
import { MessagePipeline } from "./middleware/pipeline";
import { handleDashboardRequest, logActivity, getRecentActivity, getChannelConfigs, getSessionList } from "./dashboard-api";
import { listBotSessions, startCleanupTimer, onSessionChange, saveSessionFilePath } from "./session-manager";

export interface ChatMessageResponse {
	tool_calls: string[];
	error?: string;
}

// ---------------------------------------------------------------------------
// Bot Server
// ---------------------------------------------------------------------------

const gateway = new OneBotGateway();
const queue = new MessageQueue(500);
const pipeline = new MessagePipeline();
const PORT = parseInt(process.env.OMP_SERVE_PORT ?? "3099", 10);

// WebSocket clients for dashboard live updates
const wsClients = new Set<ServerWebSocket<undefined>>();

export function broadcast(data: object): void {
	const msg = JSON.stringify(data);
	for (const ws of wsClients) {
		if (ws.readyState === 1) {
			ws.send(msg);
		}
	}
}

function getLatestOverview() {
	const activity = getRecentActivity(200);
	const today = activity.filter(e => new Date(e.timestamp).toDateString() === new Date().toDateString());
	return {
		sessionCount: listBotSessions().length,
		channelCount: getChannelConfigs().length,
		messagesToday: today.length,
		repliedToday: today.filter(e => e.decision === "replied").length,
		skippedToday: today.filter(e => e.decision === "skipped").length,
		errorsToday: today.filter(e => e.decision === "error").length,
	};
}

export async function runBotServer(args: Args): Promise<never> {
	const port = args.port ?? PORT;

	// Intercept process.exit to prevent crashes
	(process as any).exit = function (code?: number) {
		logger.warn(`[bot] process.exit(${code}) called — stack: ${new Error().stack?.split("\n").slice(2, 6).join(" → ")}`);
	};

	const sigtermHandler = () => {
		logger.warn(`[bot] SIGTERM received — preventing OMP exit`);
	};
	process.removeAllListeners("SIGTERM");
	process.on("SIGTERM", sigtermHandler);

	process.on("uncaughtException", (err: Error) => {
		try { writeFileSync("/data/crash-marker.txt", `[${new Date().toISOString()}] UNCAUGHT: ${String(err).slice(0, 500)}`, "utf-8"); } catch {}
		logger.error(`[bot] Uncaught exception: ${err}`);
	});
	process.on("unhandledRejection", (reason: unknown) => {
		try { writeFileSync("/data/crash-marker.txt", `[${new Date().toISOString()}] REJECTION: ${String(reason).slice(0, 500)}`, "utf-8"); } catch {}
		logger.error(`[bot] Unhandled rejection: ${reason}`);
	});
	logger.setTransports({ console: true, file: true });
	setEnrichSendAction((action, params, echo) => sendAction(action, params, echo));
// Git marketplace mirror
// ---------------------------------------------------------------------------
try {
	await $`git config --global url."https://ghfast.top/https://github.com/".insteadOf https://github.com/`;
	logger.info(`[setup] git mirror configured: ghfast.top`);
} catch (err) {
	logger.warn(`[setup] git mirror config failed: ${err}`);
}

	// Start HTTP server
	const server = Bun.serve({
		port,
		fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/ws" && req.headers.get("upgrade") === "websocket") {
				if (server.upgrade(req)) return;
				return new Response("Upgrade failed", { status: 500 });
			}
			return handleHttpRequest(req);
		},
		websocket: {
			open(ws) {
				wsClients.add(ws);
				ws.send(JSON.stringify({ type: "status", connected: gateway.isConnected }));
				ws.send(JSON.stringify({ type: "stats", overview: getLatestOverview() }));
				logger.debug(`[ws] Client connected (${wsClients.size} total)`);
			},
			close(ws) {
				wsClients.delete(ws);
				logger.debug(`[ws] Client disconnected (${wsClients.size} total)`);
			},
			message(_ws, _msg) {
				// Inbound WS messages ignored
			},
		},
	});
	logger.info(`[bot] Bot server ready — health at port ${port}, dashboard at /`);

	// Start OneBot WebSocket server
	gateway.onMessage(handleOneBotMessage);
	gateway.start();

	// Wire WS sender
	setWsSender((data: string) => gateway.send(data));
	setEchoRegisterer((echo: string) => gateway.registerEcho(echo));

	// Wire enrich with sendAction
	setEnrichSendAction((action, params, echo) => sendAction(action, params, echo as string));

	// Wire respond with qqSendMessage
	setRespondSendMsg(async (params) => qqSendMessage(params));

	// OneBot connection status → WS broadcast
	gateway.onStatusChange((connected: boolean) => {
		broadcast({ type: "status", connected });
	});

	// Session create/destroy → WS broadcast
	onSessionChange((key: string, active: boolean) => {
		broadcast({ type: "session", key, active });
	});

	// Pipeline activity → activity log + WS broadcast
	pipeline.onActivity((entry) => {
		logActivity({
			timestamp: entry.timestamp,
			sessionKey: entry.sessionKey,
			userId: entry.userId,
			userName: entry.userName,
			message: entry.message,
			decision: entry.decision,
			reason: entry.reason,
			reply: entry.reply ?? "",
		});
		broadcast({ type: "activity", entry });

		const today = getRecentActivity(200).filter(e => {
			const d = new Date(e.timestamp);
			return d.toDateString() === new Date().toDateString();
		});
		broadcast({
			type: "stats",
			overview: {
				sessionCount: listBotSessions().length,
				messagesToday: today.length,
				repliedToday: today.filter(e => e.decision === "replied").length,
				skippedToday: today.filter(e => e.decision === "skipped").length,
				errorsToday: today.filter(e => e.decision === "error").length,
			},
		});
	});

	logger.info(`[bot] Bot server running. Waiting for QQ messages...`);
	startCleanupTimer();
	processMessageQueue();

	setInterval(() => {
		const today = getRecentActivity(200).filter(e => {
			const d = new Date(e.timestamp);
			return d.toDateString() === new Date().toDateString();
		});
		broadcast({ type: "stats", overview: {
			sessionCount: listBotSessions().length,
			messagesToday: today.length,
			repliedToday: today.filter(e => e.decision === "replied").length,
			skippedToday: today.filter(e => e.decision === "skipped").length,
			errorsToday: today.filter(e => e.decision === "error").length,
		}});
	}, 30_000).unref();

	await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// HTTP Handler
// ---------------------------------------------------------------------------
async function handleHttpRequest(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const path = url.pathname;

	if (path === "/favicon.ico" || path === "/favicon.svg") {
		return new Response("", { status: 204 });
	}

	const dashboardResp = await handleDashboardRequest(req);
	if (dashboardResp) return dashboardResp;

	switch (`${req.method} ${url.pathname}`) {
		case "GET /health":
			return Response.json({
				status: "ok",
				onebot_connected: gateway.isConnected,
				queue_depth: queue.depth,
				uptime: process.uptime(),
			});
		case "POST /chat/message":
			return handleManualMessage(req);
		default:
			return new Response("Not Found", { status: 404 });
	}
}

async function handleManualMessage(req: Request): Promise<Response> {
	try {
		const body = await req.json();
		const event = body as OneBotMessageEvent;
		const botSelfId = gateway.botSelfId ?? event.self_id;
		const { globalSession, ensureGlobalSession } = await import("./session-manager");
		let botSession = globalSession;
		if (!botSession) botSession = await ensureGlobalSession();
		const result = await pipeline.processEvent(event, botSession!, botSelfId);
		saveSessionFilePath();
		return Response.json(result);
	} catch (err) {
		return Response.json({ error: String(err) }, { status: 500 });
	}
}

// ── User Message Debounce ──
const userDebounceTimers = new Map<number, ReturnType<typeof setTimeout>>();
const userPendingEvents = new Map<number, OneBotMessageEvent[]>();
const USER_DEBOUNCE_MS = 600;

function flushUserMessages(uid: number): void {
	const events = userPendingEvents.get(uid);
	userPendingEvents.delete(uid);
	userDebounceTimers.delete(uid);
	if (!events || events.length === 0) return;

	const merged: OneBotMessageEvent = {
		...events[0],
		message_id: Date.now(),
		raw_message: events.map(e => e.raw_message).join("\n"),
		message: events.flatMap(e => mergeCqSegments(e.message)),
	};

	const pushed = queue.push(merged);
	logger.debug(`[debounce] flush ${events.length} msg(s) uid=${uid} queued=${pushed} depth=${queue.depth}`);
}

function mergeCqSegments(segments: import("./onebot-types").MessageSegment[]): import("./onebot-types").MessageSegment[] {
	const result: import("./onebot-types").MessageSegment[] = [];
	for (const seg of segments) {
		const last = result[result.length - 1];
		if (seg.type === "text" && last?.type === "text") {
			(last as any).data.text += (seg as any).data.text;
		} else {
			result.push(seg);
		}
	}
	return result;
}

function handleOneBotMessage(event: OneBotMessageEvent): void {
	const uid = event.user_id;
	const prev = userPendingEvents.get(uid) ?? [];
	prev.push(event);
	userPendingEvents.set(uid, prev);

	const existing = userDebounceTimers.get(uid);
	if (existing) clearTimeout(existing);
	userDebounceTimers.set(uid, setTimeout(() => flushUserMessages(uid), USER_DEBOUNCE_MS));

	logger.debug(`[ws] msg id=${event.message_id} accumulated ${prev.length} event(s)`);
}

// ---------------------------------------------------------------------------
// Message Processing Loop
// ---------------------------------------------------------------------------

async function processMessageQueue(): Promise<void> {
	while (true) {
		if (queue.hasMessages) {
			const msg = queue.dequeue();
			if (msg) {
				try {
					const botSelfId = gateway.botSelfId ?? msg.event.self_id;
					if (!botSelfId) continue;

					const { globalSession, ensureGlobalSession } = await import("./session-manager");
					let botSession = globalSession;
					if (!botSession) botSession = await ensureGlobalSession();

					const result = await pipeline.processEvent(msg.event, botSession!, botSelfId);
					saveSessionFilePath();
				} catch (err) {
					logger.error(`[bot] Error processing message: ${err}`);
					try { writeFileSync("/data/crash-marker.txt", `[${new Date().toISOString()}] ${String(err).slice(0, 500)}`, "utf-8"); } catch {}
				}
			}
		}
		await new Promise(r => setTimeout(r, 100));
	}
}