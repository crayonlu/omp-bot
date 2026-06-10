/**
 * Serve mode: persistent HTTP server for QQ bot integration.
 *
 * - POST /chat/message  — dispatch a message to the agent, return response
 * - GET  /chat/health   — server health check
 * - GET  /chat/sessions — list active sessions
 *
 * Each unique (target_type, target_id) pair gets its own OMP session.
 * Sessions live in /workspace/<target_type>/<target_id>/.
 */
import { type AssistantMessage, type ImageContent } from "@oh-my-pi/pi-ai";
import { logger, getProjectDir } from "@oh-my-pi/pi-utils";
import type { Args } from "../cli/args";
import { createBotSession, getBotSession, type BotSession } from "./session-manager";
import { buildBotSystemPrompt } from "./bot-prompt";
import { buildBotContext } from "./bot-context";
import type { MessageSegment } from "./onebot-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessageRequest {
	/** QQ user ID (private chat) or group ID (group chat) */
	target_id: number;
	/** "private" or "group" */
	target_type: "private" | "group";
	/** User display name */
	user_name?: string;
	/** Raw message text (after CQ code extraction — see onebot-gateway) */
	message: string;
	/** Parsed message segments (for rich media context) */
	segments?: MessageSegment[];
	/** Message ID from OneBot (for reply-to context) */
	message_id?: number;
}

export interface ChatMessageResponse {
	/** The agent's text reply, or null if the agent chose silence */
	reply: string | null;
	/** Whether the agent decided to stay silent */
	silent: boolean;
	/** Session ID for debugging */
	session_id: string;
	/** Tool calls made during processing */
	tool_calls: string[];
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.OMP_SERVE_PORT ?? "3099", 10);

export async function runServeMode(args: Args): Promise<never> {
	const port = args.port ?? PORT;

	logger.info(`[serve] Starting QQ bot server on port ${port}`);

	const server = Bun.serve({
		port,
		fetch: handleRequest,
	});

	logger.info(`[serve] Server listening on http://localhost:${port}`);
	logger.info(`[serve] Health: http://localhost:${port}/chat/health`);

	// Keep alive forever
	await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// Request Handler
// ---------------------------------------------------------------------------

async function handleRequest(req: Request): Promise<Response> {
	const url = new URL(req.url);

	try {
		switch (`${req.method} ${url.pathname}`) {
			case "GET /chat/health":
				return handleHealth();

			case "POST /chat/message":
				return await handleMessage(req);

			case "GET /chat/sessions":
				return handleSessionsList();

			default:
				return new Response("Not Found", { status: 404 });
		}
	} catch (err) {
		logger.error(`[serve] Request error: ${err}`);
		return new Response(JSON.stringify({ error: String(err) }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

function handleHealth(): Response {
	return Response.json({
		status: "ok",
		uptime: process.uptime(),
		pid: process.pid,
		version: "omp-bot-dev",
	});
}

// ---------------------------------------------------------------------------
// Sessions List
// ---------------------------------------------------------------------------

function handleSessionsList(): Response {
	// Stub — will be implemented with session manager tracking
	return Response.json({ sessions: [] });
}

// ---------------------------------------------------------------------------
// Message Dispatch
// ---------------------------------------------------------------------------

async function handleMessage(req: Request): Promise<Response> {
	const body = (await req.json()) as ChatMessageRequest;

	if (!body.target_id || !body.target_type || !body.message) {
		return new Response(JSON.stringify({ error: "Missing required fields: target_id, target_type, message" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	const sessionKey = `${body.target_type}:${body.target_id}`;
	logger.info(`[serve] Message from ${sessionKey}: ${body.message.slice(0, 100)}`);

	// Get or create session for this user/group
	let botSession = getBotSession(sessionKey);
	if (!botSession) {
		logger.info(`[serve] Creating new session for ${sessionKey}`);
		botSession = await createBotSession(sessionKey, {
			targetType: body.target_type,
			targetId: body.target_id,
			userName: body.user_name ?? `user_${body.target_id}`,
		});
	}

	// Build context for this turn
	const contextMessages = buildBotContext(botSession, body);

	// Dispatch to agent
	const response = await dispatchToAgent(botSession, contextMessages);

	return Response.json(response);
}

// ---------------------------------------------------------------------------
// Agent Dispatch
// ---------------------------------------------------------------------------

async function dispatchToAgent(session: BotSession, context: string): Promise<ChatMessageResponse> {
	const toolCalls: string[] = [];

	// Subscribe to agent events for tool call tracking
	const unsub = session.session.subscribe(event => {
		if (event.type === "tool_call_start") {
			toolCalls.push(event.toolName);
		}
	});

	try {
		// Send the message to the agent
		await session.session.prompt(context);

		// Extract the final assistant message
		const state = session.session.state;
		const lastMessage = state.messages[state.messages.length - 1];

		if (lastMessage?.role === "assistant") {
			const assistantMsg = lastMessage as AssistantMessage;
			const replyText = extractReplyText(assistantMsg);

			return {
				reply: replyText,
				silent: replyText === null,
				session_id: session.sessionKey,
				tool_calls: toolCalls,
			};
		}

		return {
			reply: null,
			silent: true,
			session_id: session.sessionKey,
			tool_calls: toolCalls,
		};
	} finally {
		unsub();
	}
}

function extractReplyText(msg: AssistantMessage): string | null {
	// Extract text from content blocks
	for (const block of msg.content) {
		if (block.type === "text" && block.text.trim()) {
			return block.text.trim();
		}
	}
	return null;
}
