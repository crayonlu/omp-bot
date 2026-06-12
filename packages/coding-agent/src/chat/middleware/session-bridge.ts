/**
 * Session Bridge — wraps the OMP session for our middleware.
 *
 * Handles: session creation, recovery, model switching, prompt dispatch.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { ModelConfig } from "./types";
import type { BotSession } from "../session-manager";
import type { AgentSession } from "../session/agent-session";
import type { AgentSessionEvent } from "../session/agent-session";
import type { AgentEvent } from "@oh-my-pi/pi-agent";
import type { ModelRegistry } from "../config/model-registry";
import type { Model } from "@oh-my-pi/pi-catalog/types";
import type { AssistantMessageEvent } from "@oh-my-pi/pi-ai";

export interface PromptOptions {
	text: string;
	/** Image content in pi-ai ImageContent format: { type:"image", data, mimeType } */
	images?: Array<{ type: "image"; data: string; mimeType: string }>;
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
 * Apply model config to session, preserving compat/headers from the existing model.
 * Tries registry lookup first; falls back to patching fields in-place so the
 * model retains compat, headers, cost, and reasoning required by the provider.
 */
async function applyModelPreservingCompat(
	ompSession: AgentSession,
	config: ModelConfig,
): Promise<void> {
	const agent = (ompSession as unknown as { agent: { state: { model: Model | undefined } } }).agent;
	if (!agent?.state) return;

	// 1. Try registry lookup for a proper Model object
	try {
		const registry = (ompSession as unknown as { modelRegistry: ModelRegistry }).modelRegistry;
		if (registry?.find) {
			// Strip provider prefix from model ID (e.g. "deepseek/deepseek-v4-flash" → "deepseek-v4-flash")
			const slashIdx = config.id.indexOf("/");
			const bareId = slashIdx >= 0 ? config.id.slice(slashIdx + 1) : config.id;
			const found = registry.find(config.provider, bareId);
			if (found) {
				agent.state.model = found;
				return;
			}
			// Fallback: try full id (some providers register with full path)
			const foundFull = registry.find(config.provider, config.id);
			if (foundFull) {
				agent.state.model = foundFull;
				return;
			}
		}
	} catch {
		// Fall through to patch-in-place below
	}

	// 2. Patch-in-place: update essential fields on the existing model object
	//    without losing compat, headers, cost, reasoning, etc.
	const existing = agent.state.model;
	if (existing && typeof existing === "object") {
		existing.id = config.id;
		existing.provider = config.provider;
		existing.api = config.api as Model["api"];
		existing.baseUrl = config.baseUrl;
		existing.maxTokens = config.maxTokens;
		existing.contextWindow = config.contextWindow;
		existing.input = config.input as ("text" | "image")[];

		// Force alwaysSendMaxTokens for vision models — PPIO's MiniMax-M3
		// returns empty streaming content when max_tokens is omitted (the
		// deepseek compat sets alwaysSendMaxTokens: false by default).
		if (config.input.includes("image") && existing.compat) {
			(existing.compat as Record<string, unknown>).alwaysSendMaxTokens = true;
		}
	} else {
		agent.state.model = config as unknown as Model;
	}
}

interface MessageUpdateEvent extends AgentEvent {
	type: "message_update";
	assistantMessageEvent: AssistantMessageEvent;
}

interface ToolExecutionStartEvent extends AgentEvent {
	type: "tool_execution_start";
	toolName: string;
	toolCallId: string;
}

function isMessageUpdateEvent(evt: AgentSessionEvent): evt is MessageUpdateEvent {
	return evt.type === "message_update" && "assistantMessageEvent" in evt;
}

function isToolExecutionStartEvent(evt: AgentSessionEvent): evt is ToolExecutionStartEvent {
	return evt.type === "tool_execution_start" && "toolName" in evt;
}

/**
 * Send a prompt to the OMP session.
 *
 * 1. Switch model if specified (preserving compat/headers)
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
	const ompSession = session.session;
	if (!ompSession) throw new Error("No OMP session available");

	let accumulatedReply = "";
	const toolCalls: string[] = [];
	// Subscribe to ALL agent output events for debugging
	const eventsReceived: string[] = [];
	const unsub = ompSession.subscribe((evt: AgentSessionEvent) => {
		eventsReceived.push(evt.type);
		if (isMessageUpdateEvent(evt) && evt.assistantMessageEvent?.type === "text_delta") {
			accumulatedReply += evt.assistantMessageEvent.delta;
			onDelta?.(evt.assistantMessageEvent.delta);
		} else if (evt.type === "message_update") {
			// Only log non-text-delta updates
			logger.debug(`[bridge] msg_update event: type=${evt.type} hasDelta=${"assistantMessageEvent" in evt}`);
		} else if (evt.type === "message_end" || evt.type === "agent_end" || evt.type === "turn_end") {
			onEnd?.();
		} else if (isToolExecutionStartEvent(evt)) {
			toolCalls.push(evt.toolName);
			onToolCall?.(evt.toolName);
		}
	});
	logger.info(`[bridge] subscribed, events received so far: []`);

	logger.info(
		`[bridge] session model: id=${ompSession.model?.id} provider=${ompSession.model?.provider} api=${ompSession.model?.api} baseUrl=${ompSession.model?.baseUrl} maxTokens=${ompSession.model?.maxTokens} input=${JSON.stringify(ompSession.model?.input)} headers=${JSON.stringify(ompSession.model?.headers)}`,
	);
	try {
		// Save default model so we can restore after
		const savedModel = ompSession.agent?.state?.model;

		if (options.model) {
			await applyModelPreservingCompat(ompSession, options.model);
			logger.info(`[bridge] model → ${options.model.id} (input=${options.model.input.join(",")})`);
		}

		// Prompt with optional images — OMP's provider checks model.input.includes("image")
		const promptOptions = options.images && options.images.length > 0
			? { images: options.images }
			: undefined;

		logger.info(`[bridge] >>> calling ompSession.prompt() text_len=${options.text.length} images=${promptOptions?.images?.length ?? 0}`);
		const startTime = Date.now();
		try {
			const promptResult = await ompSession.prompt(options.text, promptOptions);
			if (!accumulatedReply) {
				const promptResultKeys = promptResult ? Object.keys(promptResult as object) : null;
				const mode = (ompSession as unknown as { mode: string }).mode;
				logger.warn(
					`[bridge] Empty reply. Events received during prompt: [${eventsReceived.join(",")}]. Session state: ${JSON.stringify({ status: ompSession.state?.status, mode, conversationLength: ompSession.conversation?.length, promptResultKeys })}`,
				);
			}
		} catch (err) {
			const elapsed = Date.now() - startTime;
			logger.warn(`[bridge] prompt threw in ${elapsed}ms: ${err}`);
			if (String(err).includes("AgentBusyError")) {
				logger.warn(`[bridge] Session busy, waiting 4s then retrying once…`);
				const { promise, resolve } = Promise.withResolvers<void>();
				setTimeout(resolve, 4000);
				await promise;
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
