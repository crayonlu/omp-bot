/**
 * Bot Runner — wires OneBot gateway, CQ parser, trigger decider,
 * message queue, and session dispatch into one pipeline.
 *
 * v2: self_id fallback from event when gateway not yet connected.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { Args } from "../cli/args";
import { OneBotGateway, type OneBotMessageEvent } from "./onebot-gateway";
import { parseMessageSegments, buildMessageContext } from "./cq-parser";
import { shouldTrigger } from "./trigger-decider";
import { MessageQueue } from "./message-queue";
import { getBotSession, createBotSession, type BotSessionConfig } from "./session-manager";
import type { ChatMessageResponse } from "./serve-cli";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { qqSendMessage, setWsSender } from "./qq-tools";

// ---------------------------------------------------------------------------
// Bot Server
// ---------------------------------------------------------------------------

const gateway = new OneBotGateway();
const queue = new MessageQueue(500);
const PORT = parseInt(process.env.OMP_SERVE_PORT ?? "3099", 10);

export async function runBotServer(args: Args): Promise<never> {
	const port = args.port ?? PORT;

	// Start HTTP server for health checks and dashboard
	const server = Bun.serve({
		port,
		fetch: handleHttpRequest,
	});
	logger.info(`[bot] HTTP server on port ${port}`);

	// Start OneBot WebSocket server (NapCat connects to us)
	gateway.onMessage(handleOneBotMessage);
	gateway.start();

	// Wire WS sender so qq-tools can send API actions through the WS
	setWsSender((data: string) => gateway.send(data));

	logger.info(`[bot] Bot server running. Waiting for QQ messages...`);

	// Start processing loop
	processMessageQueue();

	// Keep alive
	await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// HTTP Handler
// ---------------------------------------------------------------------------

async function handleHttpRequest(req: Request): Promise<Response> {
	const url = new URL(req.url);

	switch (`${req.method} ${url.pathname}`) {
		case "GET /health":
			return Response.json({
				status: "ok",
				onebot_connected: gateway.isConnected,
				queue_depth: queue.depth,
				uptime: process.uptime(),
			});

		case "GET /chat/message":
			// Manual test endpoint
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
					await dispatchMessage(msg.event);
				} catch (err) {
					logger.error(`[bot] Error processing message: ${err}`);
				}
			}
		}
		// Small sleep to prevent tight loop
		await new Promise(r => setTimeout(r, 100));
	}
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

	try {
		await botSession.session.prompt(context);
		const state = botSession.session.state;
		const lastMsg = state.messages[state.messages.length - 1];
		if (lastMsg?.role === "assistant") {
			const assistantMsg = lastMsg as AssistantMessage;
			const replyText = extractReplyText(assistantMsg);

			// Auto-send reply to QQ
			if (replyText) {
				try {
					await qqSendMessage({
						target_type: targetType,
						target_id: targetId,
						content: replyText,
					});
				} catch (err) {
					logger.error(`[bot] Failed to send reply: ${err}`);
				}
			}

			return {
				reply: replyText,
				silent: replyText === null,
				session_id: sessionKey,
				tool_calls: toolCalls,
				trigger_reason: decision.reason,
			};
		}

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

function extractReplyText(msg: AssistantMessage): string | null {
	for (const block of msg.content) {
		if (block.type === "text" && block.text.trim()) {
			return block.text.trim();
		}
	}
	return null;
}
