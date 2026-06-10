/**
 * CQ Code Parser — extracts user-visible text and rich media context
 * from OneBot v11 message segment arrays.
 */
import type { MessageSegment } from "./onebot-types";

export interface ParsedMessage {
	/** Plain text visible to the user (no CQ codes) */
	plainText: string;
	/** Whether the message @mentions the bot */
	mentionsBot: boolean;
	/** Whether it's a @all mention */
	mentionsAll: boolean;
	/** Descriptions of rich media for the agent */
	mediaDescriptions: string[];
	/** The replied-to message ID (if any) */
	replyToMessageId: number | null;
	/** Image URLs for vision model (if configured) */
	imageUrls: string[];
}

export function parseMessageSegments(
	segments: MessageSegment[],
	botSelfId: number | null,
): ParsedMessage {
	const result: ParsedMessage = {
		plainText: "",
		mentionsBot: false,
		mentionsAll: false,
		mediaDescriptions: [],
		replyToMessageId: null,
		imageUrls: [],
	};

	for (const seg of segments) {
		switch (seg.type) {
			case "text":
				result.plainText += seg.data.text;
				break;

			case "at":
				if (seg.data.qq === "all") {
					result.mentionsAll = true;
					result.plainText += "@全体成员 ";
				} else if (botSelfId !== null && seg.data.qq === String(botSelfId)) {
					result.mentionsBot = true;
					result.plainText += "@[bot] ";
				} else {
					result.plainText += `@[qq:${seg.data.qq}] `;
				}
				break;

			case "image":
				result.mediaDescriptions.push(
					seg.data.url
						? `[image: ${seg.data.url}]`
						: "[image]"
				);
				if (seg.data.url) {
					result.imageUrls.push(seg.data.url);
				}
				break;

			case "face":
				result.mediaDescriptions.push(`[emoji #${seg.data.id}]`);
				break;

			case "reply":
				result.replyToMessageId = parseInt(seg.data.id, 10) || null;
				result.mediaDescriptions.push(`[replying to msg #${seg.data.id}]`);
				break;

			case "record":
				result.mediaDescriptions.push("[voice message]");
				break;

			case "video":
				result.mediaDescriptions.push("[video]");
				break;

			case "file":
				result.mediaDescriptions.push(`[file: ${seg.data.name ?? seg.data.file}]`);
				break;

			case "share":
				result.mediaDescriptions.push(
					`[shared: ${seg.data.title ?? seg.data.url}]`
				);
				break;

			case "json":
				result.mediaDescriptions.push("[forwarded messages]");
				break;

			case "location":
				result.mediaDescriptions.push(`[location: ${seg.data.lat}, ${seg.data.lon}]`);
				break;
		}
	}

	return result;
}

/**
 * Build a complete context string for the agent from a parsed message.
 */
export function buildMessageContext(parsed: ParsedMessage, event: {
	user_id: number;
	message_type: "private" | "group";
	group_id?: number;
	sender: { nickname: string; card?: string };
	raw_message: string;
}): string {
	const timestamp = new Date().toISOString();
	const targetId = event.message_type === "group" ? event.group_id : event.user_id;
	const scope = event.message_type === "private" ? "private" : `group:${event.group_id}`;
	const displayName = event.sender.card || event.sender.nickname;

	let ctx = `[${timestamp}] [${scope}] [uid:${event.user_id}] ${displayName}:`;

	// Add media descriptions first
	for (const desc of parsed.mediaDescriptions) {
		ctx += `\n  ${desc}`;
	}

	// Add message text
	ctx += `\n  ${parsed.plainText.trim() || "(media-only message)"}`;

	return ctx;
}
