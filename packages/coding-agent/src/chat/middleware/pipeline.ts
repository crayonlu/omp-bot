/**
 * Message Pipeline — orchestrates all middleware stages.
 *
 * Ingress → Enrich → Format → SelectModel → Dispatch → Stream → Respond
 *
 * Also manages crash recovery markers and activity logging.
 */
import { logger } from "@oh-my-pi/pi-utils";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { parseEvent } from "./ingress";
import { enrichImages } from "./enrich";
import { formatPrompt } from "./format";
import { selectModel } from "./model-manager";
import { dispatchPrompt } from "./session-bridge";
import { StreamManager } from "./stream";
import { sendReply } from "./respond";
import type { DispatchResult, InternalMessage } from "./types";
import type { BotSession } from "../session-manager";
import type { OneBotMessageEvent } from "../onebot-gateway";

const CRASH_MARKER = "/data/crash-marker.txt";

export interface PipelineActivity {
	timestamp: string;
	sessionKey: string;
	userId: number;
	userName: string;
	message: string;
	decision: "replied" | "skipped" | "error";
	reason: string;
	reply?: string;
}

export type ActivityCallback = (entry: PipelineActivity) => void;

export class MessagePipeline {
	private activityCallback: ActivityCallback | null = null;

	onActivity(cb: ActivityCallback): void {
		this.activityCallback = cb;
	}

	/**
	 * Process an inbound OneBot event through the full pipeline.
	 */
	async processEvent(
		event: OneBotMessageEvent,
		session: BotSession,
		botSelfId: number,
	): Promise<DispatchResult> {
		const sessionKey = "zero";

		try {
			// ① Ingress: parse raw event → InternalMessage
			const msg = parseEvent(event, botSelfId);

			// ② Enrich: download images via NapCat → base64 data URI
			msg.images = await enrichImages(msg.images);

			// ③ Format: build prompt text + ImageContent[]
			const { text, images } = formatPrompt(msg);

			// Check crash marker for self-healing context
			let finalText = text;
			try {
				if (existsSync(CRASH_MARKER)) {
					const crashInfo = readFileSync(CRASH_MARKER, "utf-8").slice(0, 400);
					finalText = `${text}\n\n[SYSTEM] Previous session crashed: ${crashInfo}`;
					unlinkSync(CRASH_MARKER);
				}
			} catch { /* ignore */ }
			// Handle /clear command: reset session context
			const rawText = event.raw_message.trim();
			if (rawText.startsWith("/clear")) {
				const agent = session.session?.agent;
				if (agent) {
					agent.clearMessages();
					logger.info(`[pipeline] /clear: session cleared for uid=${event.user_id}`);
				}
				return {
					reply: "已清除会话上下文，可以开始新话题了。",
					silent: false,
					sessionId: sessionKey,
					toolCalls: [],
				};
			}

			logger.info(`[pipeline] steer: ${finalText.slice(0, 120)}…`);
			logger.info(`[pipeline] images=${images.length}`);

			// ④ Select model based on content
			const model = selectModel(msg.images);

			// ⑤ Dispatch: prompt via session bridge with streaming
			const stream = new StreamManager(async (partial) => {
				await sendReply(partial, msg);
			});

			const result = await dispatchPrompt(
				session,
				{ text: finalText, images, model },
				(delta) => stream.onDelta(delta),
				() => stream.onToolCall(),
				() => stream.onEnd(),
			);

			// ⑥ Final flush
			await stream.flush();

			const replyText = result.accumulatedReply;
			const toolCalls = result.toolCalls;

			// Log activity
			const entry: PipelineActivity = {
				timestamp: new Date().toISOString(),
				sessionKey,
				userId: event.user_id,
				userName: event.sender.nickname,
				message: event.raw_message.slice(0, 200),
				decision: replyText ? "replied" : "skipped",
				reason: replyText ? "replied" : "no response text",
				reply: replyText?.slice(0, 200),
			};
			this.activityCallback?.(entry);

			return {
				reply: replyText || null,
				silent: !replyText,
				sessionId: sessionKey,
				toolCalls,
			};
		} catch (err) {
			logger.error(`[pipeline] error: ${err}`);
			try {
				writeFileSync(CRASH_MARKER, `[${new Date().toISOString()}] ${String(err).slice(0, 500)}`, "utf-8");
			} catch { /* ignore */ }

			this.activityCallback?.({
				timestamp: new Date().toISOString(),
				sessionKey,
				userId: event.user_id,
				userName: event.sender.nickname,
				message: event.raw_message?.slice(0, 200) ?? "",
				decision: "error",
				reason: String(err).slice(0, 200),
			});

			return {
				reply: null,
				silent: true,
				sessionId: sessionKey,
				toolCalls: [],
				error: String(err),
			};
		}
	}
}