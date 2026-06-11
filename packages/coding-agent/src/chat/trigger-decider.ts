/**
 * Trigger Decider — determines whether an inbound QQ message should
 * wake up the OMP agent based on channel configuration.
 *
 * Config stored via dashboard-api's persistent channel store.
 */
import type { OneBotMessageEvent } from "./onebot-gateway";
import type { ParsedMessage } from "./cq-parser";
import { getChannelConfig as getPersistedConfig } from "./dashboard-api";
import type { ChannelConfig } from "./dashboard-api";

export type TriggerMode = "all" | "mention_only" | "smart" | "off";

export interface TriggerDecision {
	shouldTrigger: boolean;
	reason: string;
}

const DEFAULT_PRIVATE: TriggerMode = "all";
const DEFAULT_GROUP: TriggerMode = "mention_only";

/**
 * Decide whether this message should trigger the agent.
 */
export function shouldTrigger(
	event: OneBotMessageEvent,
	parsed: ParsedMessage,
	_botSelfId: number,
): TriggerDecision {
	const targetType = event.message_type;
	const targetId = targetType === "group" ? event.group_id! : event.user_id;
	const key = `${targetType}:${targetId}`;

	const config = getPersistedConfig(key);
	const mode = config?.triggerMode ?? (targetType === "private" ? DEFAULT_PRIVATE : DEFAULT_GROUP);

	// Explicitly off → never trigger
	if (mode === "off") {
		return { shouldTrigger: false, reason: "channel set to off" };
	}

	// Private chat
	if (targetType === "private") {
		if (mode === "mention_only" && !parsed.mentionsBot && !parsed.mentionsAll) {
			return { shouldTrigger: false, reason: "private chat mention_only, no @mention" };
		}
		return { shouldTrigger: true, reason: "private chat" };
	}

	// Group chat
	switch (mode) {
		case "all":
			return { shouldTrigger: true, reason: "group mode=all" };
		case "mention_only":
			if (parsed.mentionsBot || parsed.mentionsAll) {
				return { shouldTrigger: true, reason: "@mention" };
			}
			return { shouldTrigger: false, reason: "no @mention" };
		case "smart":
			if (parsed.mentionsBot || parsed.mentionsAll) {
				return { shouldTrigger: true, reason: "@mention (smart)" };
			}
			if (config?.keywords && config.keywords.length > 0) {
				const text = parsed.plainText.toLowerCase();
				const matched = config.keywords.find(kw => text.includes(kw.toLowerCase()));
				if (matched) {
					return { shouldTrigger: true, reason: `keyword: "${matched}"` };
				}
			}
			return { shouldTrigger: false, reason: "no trigger (smart)" };
		default:
			return { shouldTrigger: false, reason: "no trigger" };
	}
}
