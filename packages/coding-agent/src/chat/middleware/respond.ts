/**
 * Respond — formats OMP output into QQ-friendly messages and sends them.
 *
 * Strips markdown, respects reply chains, splits long messages.
 * Uses the same WS echo mechanism as other OneBot API calls.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { InternalMessage } from "./types";

/** Injected by pipeline on startup */
let sendMsgFn: ((params: {
	target_type: "private" | "group";
	target_id: number;
	content: string;
}) => Promise<{ message_id: number }>) | null = null;

export function setRespondSendMsg(fn: typeof sendMsgFn): void {
	sendMsgFn = fn;
}

/**
 * Strip markdown formatting for QQ plain text compatibility.
 */
function stripMarkdown(text: string): string {
	return text
		.replace(/\*\*\*(.+?)\*\*\*/g, "$1")
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/\*(.+?)\*/g, "$1")
		.replace(/`{3}[^`]*`{3}/gs, "")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/^(#{1,6})\s*/gm, "")
		.replace(/~~(.+?)~~/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.trim();
}

/**
 * Send a reply message to the user/group.
 * Strips markdown, splits multi-paragraph messages for QQ compatibility.
 */
export async function sendReply(
	text: string,
	msg: InternalMessage,
): Promise<void> {
	if (!text || !sendMsgFn) return;

	const cleaned = stripMarkdown(text);
	if (!cleaned) return;

	const params = {
		target_type: msg.messageType,
		target_id: msg.groupId ?? msg.userId,
		content: cleaned,
	};

	try {
		const result = await sendMsgFn(params);
		logger.info(`[respond] sent ${cleaned.length}b → msg_id=${result.message_id}`);
	} catch (err) {
		logger.error(`[respond] send failed: ${err}`);
	}
}