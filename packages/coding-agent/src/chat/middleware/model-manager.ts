/**
 * Model Manager — autonomously selects the right model based on
 * message content (images → vision model, text → default model).
 *
 * No configurable model from dashboard — the bot decides.
 */
import type { ModelConfig, ImageAttachment } from "./types";

const DEFAULT_MODEL: ModelConfig = {
	id: "deepseek/deepseek-v4-flash",
	provider: "ppio",
	api: "openai-completions",
	baseUrl: "https://api.ppio.com/openai",
	input: ["text"],
	maxTokens: 8192,
	contextWindow: 65536,
};

const VISION_MODEL: ModelConfig = {
	id: "minimax/minimax-m3",
	provider: "ppio",
	api: "openai-completions",
	baseUrl: "https://api.ppio.com/openai",
	input: ["text", "image"],
	maxTokens: 4096,
	contextWindow: 1048576,
};

let currentOverride: ModelConfig | null = null;

/**
 * Select model based on message content.
 * Images → MiniMax M3 (vision). Pure text → DeepSeek.
 * An override can be set for one turn (replaced by next selectModel call).
 */
export function selectModel(images: ImageAttachment[]): ModelConfig {
	// One-turn override takes priority
	if (currentOverride) {
		const ov = currentOverride;
		currentOverride = null;
		return ov;
	}
	if (images.length > 0 && images.some(i => i.dataUri || i.url)) {
		return VISION_MODEL;
	}
	return DEFAULT_MODEL;
}

/** Force a one-turn model override (e.g. explicit user request) */
export function setOneTurnOverride(model: ModelConfig): void {
	currentOverride = model;
}

export function getDefaultModel(): ModelConfig {
	return DEFAULT_MODEL;
}

export function getVisionModel(): ModelConfig {
	return VISION_MODEL;
}

/**
 * Apply model to an OMP session by setting agent.state.model directly
 * (setModelTemporary is broken — doesn't update the getter).
 */
export function applyModelToSession(session: any, model: ModelConfig): void {
	const agent = session.agent;
	if (!agent?.state) return;
	agent.state.model = model;
}