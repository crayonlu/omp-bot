/**
 * Builds the context string for an incoming chat message.
 *
 * Formats the message with user identity, trigger reason, and any
 * rich media context extracted from CQ codes.
 */
import type { BotSession } from "./session-manager";
import type { ChatMessageRequest } from "./serve-cli";

export function buildBotContext(session: BotSession, req: ChatMessageRequest): string {
	const now = new Date().toISOString();
	const uid = `[uid:${req.target_id}]`;
	const name = req.user_name ?? `user_${req.target_id}`;
	const chatType = req.target_type === "private" ? "private" : "group";
	const triggerReason = req.target_type === "private" ? "direct message" : "triggered";

	let context = `[${now}] [${chatType}] ${uid} ${name}:`;

	// Add rich media descriptions from parsed segments
	if (req.segments && req.segments.length > 0) {
		for (const seg of req.segments) {
			switch (seg.type) {
				case "image":
					context += `\n  [user sent an image${seg.data.url ? `: ${seg.data.url}` : ""}]`;
					break;
				case "reply":
					context += `\n  [replying to message ${seg.data.id}]`;
					break;
				case "face":
					context += `\n  [emoji #${seg.data.id}]`;
					break;
				case "record":
					context += `\n  [user sent a voice message]`;
					break;
				case "video":
					context += `\n  [user sent a video]`;
					break;
				case "file":
					context += `\n  [user sent a file: ${seg.data.name ?? seg.data.file}]`;
					break;
				case "share":
					context += `\n  [user shared: "${seg.data.title ?? seg.data.url}"]`;
					break;
				case "location":
					context += `\n  [user shared location: ${seg.data.lat}, ${seg.data.lon}]`;
					break;
				case "json":
					context += `\n  [user forwarded messages]`;
					break;
			}
		}
		context += `\n`;
	}

	// Add the message text
	context += `\n  ${req.message}`;

	// Add trigger context
	context += `\n\n---`;
	context += `\nTrigger reason: ${triggerReason}`;
	context += `\nYou are in a ${chatType} conversation with ${name}.`;

	return context;
}
