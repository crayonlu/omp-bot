/**
 * Session Bridge — wraps the OMP session for our middleware.
 *
 * Handles: session creation, recovery, model switching, prompt dispatch.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { ModelConfig, ImageContent } from "./types";
import { applyModelToSession } from "./model-manager";
import type { BotSession } from "../session-manager";

export interface PromptOptions {
	text: string;
	images?: ImageContent[];
	model?: ModelConfig;
}

export interface PromptResult {
	accumulatedReply: string;
	toolCalls: string[];
}

export type TextDeltaHandler = (delta: string) => void;
export type ToolCallHandler = (toolName: string) => void;
export type TurnEndHandler = () => void;

/**
 * Send a prompt to the OMP session.
 *
 * 1. Switch model if specified (direct agent.state.model write)
 * 2. Subscribe to text_delta events
 * 3. Call session.prompt()
 * 4. Return accumulated output
 */
export async function dispatchPrompt(
	session: BotSession,
	options: PromptOptions,
	onDelta?: TextDeltaHandler,
	onToolCall?: ToolCallHandler,
	onEnd?: TurnEndHandler,
): Promise<PromptResult> {
	const ompSession = (session as any).session as any;
	if (!ompSession) throw new Error("No OMP session available");

	let accumulatedReply = "";
	const toolCalls: string[] = [];

	// Subscribe to agent output
	const unsub = ompSession.subscribe((evt: any) => {
		if (evt.type === "message_update" && evt.assistantMessageEvent?.type === "text_delta") {
			accumulatedReply += evt.assistantMessageEvent.delta;
			onDelta?.(evt.assistantMessageEvent.delta);
		}
		if (evt.type === "message_end" || evt.type === "agent_end" || evt.type === "turn_end") {
			onEnd?.();
		}
		if (evt.type === "tool_execution_start") {
			toolCalls.push(evt.toolName);
			onToolCall?.(evt.toolName);
		}
	});

	try {
		// Save default model so we can restore after
		const savedModel = ompSession.agent?.state?.model;

		// Switch to vision model if images present
		if (options.model) {
			applyModelToSession(ompSession, options.model);
			logger.info(`[bridge] model → ${options.model.id} (vision=${options.model.input.includes("image")})`);
		}

		// Prompt with optional images — OMP's provider checks model.input.includes("image")
		const promptOptions = options.images && options.images.length > 0
			? { images: options.images }
			: undefined;

		logger.info(`[bridge] >>> calling ompSession.prompt() text_len=${options.text.length} images=${promptOptions?.images?.length ?? 0}`);
		const startTime = Date.now();
		try {
			const promptResult = await ompSession.prompt(options.text, promptOptions);
			const elapsed = Date.now() - startTime;
			logger.info(`[bridge] <<< prompt returned in ${elapsed}ms accumulatedReply=${accumulatedReply.length}b resultType=${typeof promptResult} hasContent=${!!promptResult?.content} contentLen=${(promptResult?.content as string)?.length ?? 0} toolCalls=${(promptResult?.toolCalls as any[])?.length ?? 0}`);
			if (!accumulatedReply) {
				logger.warn(`[bridge] Empty reply. Session state: ${JSON.stringify({status: ompSession.state?.status, mode: ompSession.mode, conversationLength: ompSession.conversation?.length, promptResultKeys: promptResult ? Object.keys(promptResult as object) : null})}`);
			}
		} catch (err) {
			const elapsed = Date.now() - startTime;
			logger.warn(`[bridge] prompt threw in ${elapsed}ms: ${err}`);
			if (String(err).includes("AgentBusyError")) {
				logger.warn(`[bridge] Session busy, waiting 4s then retrying once…`);
				await new Promise(r => setTimeout(r, 4000));
				await ompSession.prompt(options.text, promptOptions);
				logger.info(`[bridge] retry prompt returned in ${Date.now() - startTime}ms`);
			} else {
				throw err;
			}
		}

		// Restore default model after vision turn
		if (savedModel && options.model?.input.includes("image")) {
			ompSession.agent.state.model = savedModel;
			logger.info(`[bridge] restored default model`);
		}

		return { accumulatedReply, toolCalls };
	} finally {
		unsub();
	}
}