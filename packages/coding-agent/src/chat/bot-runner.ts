/**
 * Bot Runner — wires OneBot gateway, CQ parser, trigger decider,
 * message queue, and session dispatch into one pipeline.
 * v4: explicit model bypasses OMP resolution hang.
 */
import { $, type ServerWebSocket } from "bun";
import { logger } from "@oh-my-pi/pi-utils";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import type { Args } from "../cli/args";
import { OneBotGateway, type OneBotMessageEvent } from "./onebot-gateway";
import { parseMessageSegments, buildMessageContext } from "./cq-parser";
import { shouldTrigger } from "./trigger-decider";
import { MessageQueue } from "./message-queue";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { qqSendMessage, setWsSender, setEchoRegisterer } from "./qq-tools";
import { handleDashboardRequest, logActivity, getRecentActivity, getChannelConfigs, getSessionList, setModelChangeHandler } from "./dashboard-api";
import { getBotSession, createBotSession, destroyBotSession, startCleanupTimer, onSessionChange, listBotSessions, type BotSessionConfig } from "./session-manager";

export interface ChatMessageResponse {
	tool_calls: string[];
	error?: string;
	trigger_reason?: string;
}

// ---------------------------------------------------------------------------
// Bot Server
// ---------------------------------------------------------------------------

const gateway = new OneBotGateway();
const queue = new MessageQueue(500);
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

	// Intercept process.exit to prevent crashes and log the caller
	(process as any).exit = function (code?: number) {
		logger.warn(`[bot] process.exit(${code}) called — stack: ${new Error().stack?.split("\n").slice(2, 6).join(" → ")}`);
	};

	// Override OMP's SIGTERM handler — log instead of exiting
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
	// Enable console transport so 'docker logs' shows output
	logger.setTransports({ console: true, file: true });

// ---------------------------------------------------------------------------
// Git marketplace mirror
// ---------------------------------------------------------------------------
try {
	await $`git config --global url."https://ghfast.top/https://github.com/".insteadOf https://github.com/`;
	logger.info(`[setup] git mirror configured: ghfast.top`);
} catch (err) {
	logger.warn(`[setup] git mirror config failed: ${err}`);
}


	// Start HTTP server for health checks + dashboard + WebSocket
	const server = Bun.serve({
		port,
		fetch(req) {
			// WebSocket upgrade for dashboard real-time
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
				// Inbound WS messages ignored — dashboards are read-only
			},
		},
	});
	logger.info(`[bot] Bot server ready — health at port ${port}, dashboard at /`);

	// Start OneBot WebSocket server (NapCat connects to us)
	gateway.onMessage(handleOneBotMessage);
	gateway.start();

	// Wire WS sender so qq-tools can send API actions through the WS
	setWsSender((data: string) => gateway.send(data));
	setEchoRegisterer((echo: string) => gateway.registerEcho(echo));

	// Wire OneBot connection status → WS broadcast
	gateway.onStatusChange((connected: boolean) => {
		broadcast({ type: "status", connected });
	});

	// Wire session create/destroy → WS broadcast
	onSessionChange((key: string, active: boolean) => {
		broadcast({ type: "session", key, active });
	});

	// Wire model change → apply to all running sessions
	setModelChangeHandler(async (modelId: string) => {
		const sessions = listBotSessions();
		for (const bs of sessions) {
			try {
				// The session stores model as "provider/modelId" format
				await bs.session.setModelTemporary({ id: modelId, provider: "ppio", api: "openai-completions", baseUrl: "https://api.ppio.com/openai" } as any);
				logger.info(`[api] Applied model ${modelId} to session ${bs.sessionKey}`);
			} catch (err) {
				logger.warn(`[api] Failed to apply model ${modelId} to session ${bs.sessionKey}: ${err}`);
			}
		}
	});

	logger.info(`[bot] Bot server running. Waiting for QQ messages...`);
	startCleanupTimer();

	// Start processing loop
	processMessageQueue();



	// Periodic stats snapshot every 30s
	const statsInterval = setInterval(() => {
		const activity = getRecentActivity(200);
		const today = new Date().toDateString();
		const todayEntries = activity.filter(e => {
			const d = new Date(e.timestamp);
			return d.toDateString() === today;
		});
		const overview = {
			sessionCount: getSessionList().length,
			messagesToday: todayEntries.length,
			repliedToday: todayEntries.filter(e => e.decision === "replied").length,
			skippedToday: todayEntries.filter(e => e.decision === "skipped").length,
			errorsToday: todayEntries.filter(e => e.decision === "error").length,
		};
		broadcast({ type: "stats", overview });
	}, 30_000).unref();

	// Keep alive
	await new Promise(() => {});
}
// ---------------------------------------------------------------------------
// New API Routes
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT = process.env.OMP_BOT_WORKSPACE ??
	pathResolve(process.cwd(), "..", "omp-bot-workspace");

function getSessionWorkspaceDir(key: string): string {
	return pathResolve(WORKSPACE_ROOT, key.replace(":", "/"));
}

async function handleNewApiRoutes(
	method: string,
	path: string,
	url: URL,
	req: Request,
): Promise<Response | null> {
	switch (`${method} ${path}`) {
		// === Settings ===
		case "GET /api/settings":
			return Response.json({
				model: "deepseek-v4-flash",
				status: gateway.isConnected ? "running" : "stopped",
			});

		// === Activity History ===
		case "GET /api/history": {
			const key = url.searchParams.get("key") ?? "";
			const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
			const before = url.searchParams.get("before") ?? undefined;

			let entries = getRecentActivity(1000);
			if (key) {
				entries = entries.filter(e => e.sessionKey === key);
			}
			if (before) {
				entries = entries.filter(e => e.timestamp < before);
			}
			entries = entries.slice(-limit);
			return Response.json(entries);
		}

		// === Plugin Management ===
		case "GET /api/plugins": {
			try {
				const result = await $`/usr/local/bin/omp plugin list`.quiet();
				return Response.json({ plugins: JSON.parse(result.stdout.toString()) });
			} catch (err: any) {
				const msg =
					err.stderr?.toString().trim() ?? err.stdout?.toString().trim() ?? String(err);
				return Response.json({ error: msg, plugins: [] }, { status: 500 });
			}
		}

		case "POST /api/plugins/install": {
			try {
				const body = await req.json() as { name: string };
				if (!body.name) {
					return Response.json({ error: "missing name" }, { status: 400 });
				}
				const result = await $`/usr/local/bin/omp plugin install ${body.name}`.quiet();
				return Response.json({
					ok: true,
					name: body.name,
					output: result.stdout.toString().trim(),
				});
			} catch (err: any) {
				const msg =
					err.stderr?.toString().trim() ?? err.stdout?.toString().trim() ?? String(err);
				return Response.json({ ok: false, error: msg }, { status: 500 });
			}
		}

		// === Self-Improvement ===
		case "GET /api/self-improvement": {
			const key = url.searchParams.get("key");
			if (!key) {
				const all: Record<string, string> = {};
				for (const s of getSessionList()) {
					const ws = getSessionWorkspaceDir(s.key);
					const file = pathResolve(ws, "workspace", "self-improvement.md");
					if (existsSync(file)) {
						all[s.key] = readFileSync(file, "utf-8");
					}
				}
				return Response.json(all);
			}
			const file = pathResolve(getSessionWorkspaceDir(key), "workspace", "self-improvement.md");
			if (!existsSync(file)) {
				return Response.json({ content: "", key });
			}
			return Response.json({ content: readFileSync(file, "utf-8"), key });
		}

		// === Proposed Changes ===
		case "GET /api/proposed-changes": {
			const key = url.searchParams.get("key");
			if (!key) {
				const all: Record<string, string> = {};
				for (const s of getSessionList()) {
					const ws = getSessionWorkspaceDir(s.key);
					const file = pathResolve(ws, "workspace", "proposed-changes.md");
					if (existsSync(file)) {
						all[s.key] = readFileSync(file, "utf-8");
					}
				}
				return Response.json(all);
			}
			const file = pathResolve(getSessionWorkspaceDir(key), "workspace", "proposed-changes.md");
			if (!existsSync(file)) {
				return Response.json({ content: "", key });
			}
			return Response.json({ content: readFileSync(file, "utf-8"), key });
		}

		case "PUT /api/proposed-changes": {
			try {
				const body = await req.json() as { key?: string; approved: boolean };
				if (body.approved) {
					const key = body.key;
					let content = "";
					if (key) {
						const file = pathResolve(
							getSessionWorkspaceDir(key),
							"workspace",
							"proposed-changes.md",
						);
						if (existsSync(file)) {
							content = readFileSync(file, "utf-8");
						}
					}
					if (content) {
						setPromptOverride(content);
					}
				}
				return Response.json({ ok: true, approved: body.approved });
			} catch (err) {
				return Response.json({ ok: false, error: String(err) }, { status: 500 });
			}
		}

		default:
			return null;
	}
}
// ---------------------------------------------------------------------------
// HTTP Handler
// ---------------------------------------------------------------------------
async function handleHttpRequest(req: Request): Promise<Response> {
	const url = new URL(req.url);

	const path = url.pathname;
	const method = req.method;

	// Favicon fallback
	if (path === "/favicon.ico" || path === "/favicon.svg") {
		return new Response("", { status: 204 });
	}

	// New API routes (checked before dashboard so we can override /api/*)
	const apiResp = await handleNewApiRoutes(method, path, url, req);
	if (apiResp) return apiResp;

	// Dashboard routes
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

		case "GET /chat/message":
			return Response.json({ message: "use POST /chat/message" });

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

		const response = await dispatchMessage(event);
		return Response.json(response);
	} catch (err) {
		return Response.json({ error: String(err) }, { status: 500 });
	}
}

// ---------------------------------------------------------------------------
// OneBot Message Handler
// ---------------------------------------------------------------------------

async function handleOneBotMessage(event: OneBotMessageEvent): Promise<void> {
	queue.push(event);
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
					const result = await dispatchMessage(msg.event);
					// Log activity
					const targetType = msg.event.message_type;
					const targetId = targetType === "group" ? msg.event.group_id! : msg.event.user_id;
					logActivity({
						timestamp: new Date().toISOString(),
						sessionKey: `${targetType}:${targetId}`,
						userId: msg.event.user_id,
						userName: msg.event.sender.nickname,
						message: msg.event.raw_message.slice(0, 200),
						decision: result.silent ? "skipped" : "replied",
						reason: result.trigger_reason ?? result.error ?? "",
						reply: result.reply?.slice(0, 200),
					});

					// Push activity to WS clients
					const entry = {
						timestamp: new Date().toISOString(),
						sessionKey: `${targetType}:${targetId}`,
						userId: msg.event.user_id,
						userName: msg.event.sender.nickname,
						message: msg.event.raw_message.slice(0, 200),
						decision: result.silent ? "skipped" : "replied",
						reason: result.trigger_reason ?? result.error ?? "",
						reply: result.reply?.slice(0, 200),
					};
					broadcast({ type: "activity", entry });

					// Update stats overview
					const activity = getRecentActivity(200);
					const today = new Date().toDateString();
					const todayEntries = activity.filter(e => {
						const d = new Date(e.timestamp);
						return d.toDateString() === today;
					});
					broadcast({
						type: "stats",
						overview: {
							sessionCount: getSessionList().length,
							messagesToday: todayEntries.length,
							repliedToday: todayEntries.filter(e => e.decision === "replied").length,
							skippedToday: todayEntries.filter(e => e.decision === "skipped").length,
							errorsToday: todayEntries.filter(e => e.decision === "error").length,
						},
					});
				} catch (err) {
					logger.error(`[bot] Error processing message: ${err}`);
					markCrash(err);
				}
			}
		}
		// Small sleep to prevent tight loop
		await new Promise(r => setTimeout(r, 100));
	}
}


// Crash marker — written before fatal errors so Zero can recover on next session
const CRASH_MARKER = "/data/crash-marker.txt";
function markCrash(err: unknown): void {
	try { writeFileSync(CRASH_MARKER, `[${new Date().toISOString()}] ${String(err).slice(0, 500)}`, "utf-8"); } catch {}
}
// ---------------------------------------------------------------------------
// Message Dispatch
// ---------------------------------------------------------------------------

async function dispatchMessage(event: OneBotMessageEvent): Promise<ChatMessageResponse> {
	const botSelfId = gateway.botSelfId ?? event.self_id;
	if (!botSelfId) {
		return { reply: null, silent: true, session_id: "", tool_calls: [], error: "bot self_id unknown" };
	}

	// Parse CQ codes
	const message = event.message || [];
	const parsed = parseMessageSegments(message, botSelfId);

	// Decide whether to trigger
	const decision = shouldTrigger(event, parsed, botSelfId);
	if (!decision.shouldTrigger) {
		return {
			reply: null,
			silent: true,
			session_id: "",
			tool_calls: [],
			trigger_reason: decision.reason,
		};
	}

	// Build context with message source prefix
	const context = buildMessageContext(parsed, event);
	const hasImages = parsed.imageUrls.length > 0;

	// Inject crash marker info for self-recovery
	let crashContext = "";
	try {
		if (existsSync("/data/crash-marker.txt")) {
			crashContext = `\n\n[SYSTEM] Previous session crashed: ${readFileSync("/data/crash-marker.txt", "utf-8").slice(0, 400)}`;
			unlinkSync("/data/crash-marker.txt");
		}
	} catch {}

	// Use global session (created at startup)
	const { globalSession, ensureGlobalSession } = await import("./session-manager");
	let botSession = globalSession;
	if (!botSession) {
		botSession = await ensureGlobalSession();
	}

	// Subscribe to agent output for real-time streaming
	let sendBuffer = "";
	let accumulatedReply = "";
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	const toolCalls: string[] = [];
	const sessionKey = "zero";

	const flushBuffer = async () => {
		const text = sendBuffer.trim();
		if (!text) return;
		sendBuffer = "";
		try {
			const cleaned = stripMarkdown(text);
			if (cleaned) {
				await qqSendMessage({ target_type: "private", target_id: 1104507145, content: cleaned });
				logger.info(`[debounce] sent: ${cleaned.slice(0, 80)}`);
			}
		} catch (err) {
			logger.error(`[debounce] send failed: ${err}`);
		}
	};

	const debounce = () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(flushBuffer, 800);
	};

	const unsub = botSession.session.subscribe(evt => {
		if (evt.type === "message_update" && evt.assistantMessageEvent?.type === "text_delta") {
			accumulatedReply += evt.assistantMessageEvent.delta;
			sendBuffer += evt.assistantMessageEvent.delta;
			debounce();
		}
		if (evt.type === "message_end" || evt.type === "agent_end" || evt.type === "turn_end") {
			flushBuffer();
		}
		if (evt.type === "tool_execution_start") {
			toolCalls.push(evt.toolName);
		}
	});
	const promptText = crashContext ? context + crashContext : context;
	const promptImages = hasImages ? parsed.imageUrls.map(url => ({ type: "image" as const, image: url })) : undefined;
	try {
		logger.info(`[dispatch] steer: ${promptText.slice(0, 100)}…`);
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				await botSession.session.prompt(promptText, promptImages ? { images: promptImages } : undefined);
				break;
			} catch (err) {
				if (String(err).includes("AgentBusyError") && attempt < 2) {
					logger.warn(`[dispatch] Session busy (attempt ${attempt + 1}), retrying in ${(attempt + 1) * 2}s…`);
					await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
					continue;
				}
				logger.error(`[dispatch] prompt failed: ${err}`);
				break;
			}
		}
	} finally {
		flushBuffer();
		unsub();
		if (debounceTimer) clearTimeout(debounceTimer);
	}

	const replyText = stripMarkdown(accumulatedReply);
	return {
		reply: replyText || null,
		silent: !replyText,
		session_id: sessionKey,
		tool_calls: toolCalls,
	};
}

function stripMarkdown(text: string): string {
	return text
		.replace(/\*\*\*(.+?)\*\*\*/g, "$1")
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/\*(.+?)\*/g, "$1")
		.replace(/`{3}[^`]*`{3}/gs, "")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/^(#{1,6})\s*/gm, "")
		.replace(/~~(.+?)~~/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.trim();
}
function extractReplyText(msg: AssistantMessage): string | null {
	// Only use the last text block — earlier blocks are internal reasoning
	const textBlocks = msg.content.filter(
		(c: any) => c.type === "text" && c.text?.trim()
	);
	if (textBlocks.length === 0) return null;
	const last = textBlocks[textBlocks.length - 1] as { text: string };
	return last.text.trim() || null;
}
