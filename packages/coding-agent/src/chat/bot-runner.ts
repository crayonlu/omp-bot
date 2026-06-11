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

	const context = buildMessageContext(parsed, event);
	const hasImages = parsed.imageUrls.length > 0;

	const targetType = event.message_type;
	const targetId = targetType === "group" ? event.group_id! : event.user_id;
	const sessionKey = `${targetType}:${targetId}`;
	// Get or create session (recreate if previous was disposed by shutdown)
	let botSession = getBotSession(sessionKey);
	if (botSession) {
		try {
			// Test if session is alive by checking its state
			botSession.session.state;
		} catch {
			logger.warn(`[dispatch] Session ${sessionKey} was disposed — recreating`);
			await destroyBotSession(sessionKey);
			botSession = null;
		}
	}
	if (!botSession) {
		const config: BotSessionConfig = {
			targetType,
			targetId,
			userName: event.sender.card || event.sender.nickname,
		};
		botSession = await createBotSession(sessionKey, config);
	}
	// Session recovery: check for a saved session file from a previous process life
	try {
		const recoveryPath = `/data/last-session-${sessionKey}.path`;
		if (existsSync(recoveryPath)) {
			const savedPath = readFileSync(recoveryPath, "utf-8").trim();
			logger.info(`[dispatch] Found saved session file for ${sessionKey}: ${savedPath} — future: use SessionManager.open() to restore`);
		}
	} catch {}
	// Dispatch to agent
	const toolCalls: string[] = [];
	const unsub = botSession.session.subscribe(evt => {
		if (evt.type === "tool_execution_start") {
			toolCalls.push(evt.toolName);
		}
	});
	const promptText = context;

	const promptImages = hasImages
		? parsed.imageUrls.map(url => ({ type: "image" as const, image: url }))
		: undefined;

	logger.info(`[dispatch] session prompt: ${promptText.slice(0, 120)}…${hasImages ? ` +${parsed.imageUrls.length} image(s)` : ""}`);
	try {
		await botSession.session.prompt(promptText, promptImages ? { images: promptImages } : undefined);

		const state = botSession.session.state;
		const msgCount = state.messages.length;
		logger.info(`[dispatch] session state has ${msgCount} messages`);

		// Auto-summarize every 5 turns
		if (msgCount > 5 && msgCount % 5 === 0) {
			logger.info(`[dispatch] ${msgCount} messages reached — injecting memory summary`);
			try {
				const summaryPrompt = `[SYSTEM] This conversation has reached ${msgCount} messages. Summarize key points discussed, decisions made, and preferences expressed into /workspace/memory.md. Keep it concise.`;
				await botSession.session.prompt(summaryPrompt);
			} catch (sumErr) {
				logger.warn(`[dispatch] memory summary injection failed: ${sumErr}`);
			}
		}
		const lastMsg = state.messages[msgCount - 1];

		if (lastMsg?.role === "assistant") {
			const assistantMsg = lastMsg as AssistantMessage;
			logger.info(`[dispatch] FULL assistant: ${JSON.stringify({
				role: assistantMsg.role,
				contentCount: assistantMsg.content.length,
				model: (assistantMsg as any).model,
				attribution: (assistantMsg as any).attribution,
				content: assistantMsg.content.map(c => ({type: (c as any).type, hasText: !!((c as any)?.text?.trim())}))
			}).slice(0, 400)}`);
			let replyText = extractReplyText(assistantMsg);
			if (replyText) replyText = stripMarkdown(replyText);
			logger.info(`[dispatch] extractReplyText returned: ${replyText ? JSON.stringify(replyText.slice(0, 200)) : "null"}`);
			// Auto-send only if Zero didn't already send messages herself
			if (replyText && !toolCalls.includes("qq_send_message")) {
				try {
					await qqSendMessage({
						target_type: targetType,
						target_id: targetId,
						content: replyText,
					});
					logger.info(`[dispatch] auto-sent reply to ${targetType}:${targetId} (Zero didn't reply herself)`);
				} catch (err) {
					logger.error(`[dispatch] Failed to send reply: ${err}`);
				}
			} else if (replyText && toolCalls.includes("qq_send_message")) {
				logger.info(`[dispatch] Zero already sent her own messages → skip auto-send`);
			}

			return {
				reply: replyText,
				silent: replyText === null,
				session_id: sessionKey,
				tool_calls: toolCalls,
				trigger_reason: decision.reason,
			};
		}

		logger.info(`[dispatch] last message role is "${lastMsg?.role}", not assistant. full state messages: ${msgCount}`);
		return {
			reply: null,
			silent: true,
			session_id: sessionKey,
			tool_calls: toolCalls,
			trigger_reason: decision.reason,
		};
	} finally {
		unsub();
		if (botSession) {
			botSession.lastActivity = Date.now();
		}
	}
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
