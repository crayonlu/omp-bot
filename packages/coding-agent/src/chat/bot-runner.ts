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
import { getBotSession, createBotSession, startCleanupTimer, type BotSessionConfig } from "./session-manager";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { qqSendMessage, setWsSender, setEchoRegisterer } from "./qq-tools";
import {
	handleDashboardRequest,
	logActivity,
	getRecentActivity,
	getPromptOverride,
	setPromptOverride,
	getSessionList,
} from "./dashboard-api";
import { onSessionChange } from "./session-manager";

export interface ChatMessageResponse {
	reply: string | null;
	silent: boolean;
	session_id: string;
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


export async function runBotServer(args: Args): Promise<never> {
	const port = args.port ?? PORT;


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


	// Start HTTP server for health checks + dashboard + WebSocket
	const server = Bun.serve({
		port,
		fetch: handleHttpRequest,
		websocket: {
			open(ws) {
				wsClients.add(ws);
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

	// Build context for the agent

	// Inject crash marker info for self-recovery
	let crashContext = "";
	try {
		if (existsSync("/data/crash-marker.txt")) {
			crashContext = `\n\n[SYSTEM] Previous session crashed: ${readFileSync("/data/crash-marker.txt", "utf-8").slice(0, 400)}`;
			unlinkSync("/data/crash-marker.txt");
		}
	} catch {}
	const context = buildMessageContext(parsed, event);
	const targetType = event.message_type;
	const targetId = targetType === "group" ? event.group_id! : event.user_id;
	const sessionKey = `${targetType}:${targetId}`;

	// Get or create session
	let botSession = getBotSession(sessionKey);
	if (!botSession) {
		const config: BotSessionConfig = {
			targetType,
			targetId,
			userName: event.sender.card || event.sender.nickname,
		};
		botSession = await createBotSession(sessionKey, config);
	}

	// Dispatch to agent
	const toolCalls: string[] = [];
	const unsub = botSession.session.subscribe(evt => {
		if (evt.type === "tool_call_start") {
			toolCalls.push(evt.toolName);
		}
	});
	const promptText = crashContext ? context + crashContext : context;
	logger.info(`[dispatch] session prompt: ${promptText.slice(0, 120)}…`);
	try {
		await botSession.session.prompt(promptText);
		logger.info(`[dispatch] prompt completed for ${sessionKey}`);

		const state = botSession.session.state;
		const msgCount = state.messages.length;
		logger.info(`[dispatch] session state has ${msgCount} messages`);
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
