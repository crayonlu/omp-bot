/**
 * QQ tools — OneBot v11 API calls via WebSocket.
 *
 * NapCat connects to us via reverse WebSocket. We send API calls
 * back through the same WS connection. No HTTP API needed.
 */
import { logger } from "@oh-my-pi/pi-utils";

// ---------------------------------------------------------------------------
// WS Send helper — injected by gateway after connection
// ---------------------------------------------------------------------------

let wsSender: ((data: string) => void) | null = null;

export function setWsSender(sender: (data: string) => void): void {
	wsSender = sender;
}

function sendAction(action: string, params: Record<string, unknown> = {}): void {
	if (!wsSender) {
		throw new Error("OneBot WebSocket not connected — cannot send action");
	}
	const msg = JSON.stringify({ action, params, echo: `omp_${Date.now()}` });
	logger.debug(`[qq-tool] WS send: ${action}`);
	wsSender(msg);
}

// ---------------------------------------------------------------------------
// Tool: qq_send_message
// ---------------------------------------------------------------------------

interface SendMessageParams {
	target_type: "private" | "group";
	target_id: number;
	content: string;
	reply_to_message_id?: number;
}

export async function qqSendMessage(params: SendMessageParams): Promise<{
	message_id: number;
}> {
	const { target_type, target_id, content, reply_to_message_id } = params;

	const action = target_type === "private" ? "send_private_msg" : "send_group_msg";
	const apiParams: Record<string, unknown> = {
		...(target_type === "private" ? { user_id: target_id } : { group_id: target_id }),
		message: content,
	};

	if (reply_to_message_id) {
		apiParams.message = `[CQ:reply,id=${reply_to_message_id}]${content}`;
	}

	logger.info(`[qq-tool] send_message: ${target_type}/${target_id} -> ${content.slice(0, 80)}`);
	sendAction(action, apiParams);

	// We don't wait for response — it comes async via WS
	return { message_id: 0 };
}

// ---------------------------------------------------------------------------
// Tool: qq_get_message
// ---------------------------------------------------------------------------

export async function qqGetMessage(message_id: number): Promise<{
	raw_message: string;
	user_id: number;
	time: number;
}> {
	logger.info(`[qq-tool] get_message: ${message_id}`);
	sendAction("get_msg", { message_id });
	// Async — results come via WS events
	return { raw_message: "", user_id: 0, time: 0 };
}

// ---------------------------------------------------------------------------
// Tool: qq_get_recent_history
// ---------------------------------------------------------------------------

interface GetHistoryParams {
	target_type: "private" | "group";
	target_id: number;
	limit?: number;
}

export async function qqGetRecentHistory(params: GetHistoryParams): Promise<{
	messages: Array<{
		message_id: number;
		user_id: number;
		nickname: string;
		raw_message: string;
		time: number;
	}>;
}> {
	const { target_type, target_id, limit = 20 } = params;

	const action = target_type === "private"
		? "get_friend_msg_history"
		: "get_group_msg_history";

	const apiParams: Record<string, unknown> = {
		...(target_type === "private" ? { user_id: target_id } : { group_id: target_id }),
		count: Math.min(limit, 50),
	};

	logger.info(`[qq-tool] get_history: ${target_type}/${target_id} (limit=${limit})`);
	sendAction(action, apiParams);

	return { messages: [] };
}
