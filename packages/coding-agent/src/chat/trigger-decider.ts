/**
 * Trigger Decider — determines whether an inbound QQ message should
 * wake up the OMP agent based on channel configuration.
 */
import type { OneBotMessageEvent } from "./onebot-gateway";
import type { ParsedMessage } from "./cq-parser";

export type TriggerMode = "all" | "mention_only" | "smart" | "off";

export interface ChannelTriggerConfig {
	targetId: number;
	targetType: "private" | "group";
	triggerMode: TriggerMode;
	keywords?: string[];
}

export interface TriggerDecision {
	shouldTrigger: boolean;
	reason: string;
}

/** In-memory channel config store. Persisted to disk later. */
const channelConfigs = new Map<string, ChannelTriggerConfig>();

// Default configs
const DEFAULT_PRIVATE: TriggerMode = "all";
const DEFAULT_GROUP: TriggerMode = "mention_only";

export function setChannelConfig(key: string, config: ChannelTriggerConfig): void {
	channelConfigs.set(key, config);
}

export function getChannelConfig(key: string): ChannelTriggerConfig | undefined {
	return channelConfigs.get(key);
}

export function getEffectiveTriggerMode(
	targetType: "private" | "group",
	targetId: number,
): TriggerMode {
	const key = `${targetType}:${targetId}`;
	return channelConfigs.get(key)?.triggerMode
		?? (targetType === "private" ? DEFAULT_PRIVATE : DEFAULT_GROUP);
}

/**
 * Decide whether this message should trigger the agent.
 */
export function shouldTrigger(
	event: OneBotMessageEvent,
	parsed: ParsedMessage,
	botSelfId: number,
): TriggerDecision {
	const targetType = event.message_type;
	const targetId = targetType === "group" ? event.group_id! : event.user_id;
	const key = `${targetType}:${targetId}`;
	const config = channelConfigs.get(key);

	// Explicitly off → never trigger
	if (config?.triggerMode === "off") {
		return { shouldTrigger: false, reason: "channel is set to off" };
	}

	// Private chat: default = all
	if (targetType === "private") {
		if (config?.triggerMode === "mention_only" && !parsed.mentionsBot && !parsed.mentionsAll) {
			return { shouldTrigger: false, reason: "private chat set to mention_only, no @mention" };
		}
		return { shouldTrigger: true, reason: "private chat (mode=all)" };
	}

	// Group chat: default = mention_only
	const mode = config?.triggerMode ?? DEFAULT_GROUP;

	switch (mode) {
		case "all":
			return { shouldTrigger: true, reason: "group chat mode=all" };

		case "mention_only":
			if (parsed.mentionsBot || parsed.mentionsAll) {
				return { shouldTrigger: true, reason: "@mention detected" };
			}
			return { shouldTrigger: false, reason: "no @mention (mode=mention_only)" };

		case "smart":
			if (parsed.mentionsBot || parsed.mentionsAll) {
				return { shouldTrigger: true, reason: "@mention detected (smart mode)" };
			}
			// Check keywords
			if (config?.keywords && config.keywords.length > 0) {
				const text = parsed.plainText.toLowerCase();
				const matched = config.keywords.find(kw => text.includes(kw.toLowerCase()));
				if (matched) {
					return { shouldTrigger: true, reason: `keyword match: "${matched}"` };
				}
			}
			return { shouldTrigger: false, reason: "no trigger condition met (smart mode)" };

		case "off":
			return { shouldTrigger: false, reason: "channel is off" };

		default:
			return { shouldTrigger: false, reason: `unknown mode: ${mode}` };
	}
}
