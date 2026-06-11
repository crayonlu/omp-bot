/**
 * QQ tools — OneBot v11 API calls via WebSocket.
 *
 * NapCat connects to us via reverse WebSocket. We send API calls
 * back through the same WS connection. No HTTP API needed.
 */
import { logger } from "@oh-my-pi/pi-utils";

// ---------------------------------------------------------------------------
// WS injects — set by gateway after connection
// ---------------------------------------------------------------------------

let wsSender: ((data: string) => void) | null = null;

export function setWsSender(sender: (data: string) => void): void {
	wsSender = sender;
}

let echoRegisterer: ((echo: string) => Promise<unknown>) | null = null;

/**
 * Inject the echo registerer from the OneBot gateway.
 * Call once after gateway is created.
 */
export function setEchoRegisterer(registerer: (echo: string) => Promise<unknown>): void {
	echoRegisterer = registerer;
}

// ---------------------------------------------------------------------------
// Internal: send an API action and wait for the echoed response
// ---------------------------------------------------------------------------

function sendAction(
	action: string,
	params: Record<string, unknown> = {},
	echo: string,
): Promise<Record<string, unknown>> {
	if (!wsSender) {
		throw new Error("OneBot WebSocket not connected — cannot send action");
	}
	if (!echoRegisterer) {
		throw new Error("Echo registerer not set — cannot await response");
	}
	const msg = JSON.stringify({ action, params, echo });
	logger.debug(`[qq-tool] WS send: ${action} (echo=${echo})`);
	wsSender(msg);
	return echoRegisterer(echo) as Promise<Record<string, unknown>>;
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
	const data = await sendAction(action, apiParams, `omp_send_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
	return { message_id: (data?.message_id as number) ?? 0 };
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
	const data = await sendAction("get_msg", { message_id }, `omp_getmsg_${message_id}_${Date.now()}`);

	const sender = (data?.sender as Record<string, unknown> | undefined) ?? {};
	return {
		raw_message: ((data?.raw_message ?? data?.message) as string) ?? "",
		user_id: (sender.user_id as number) ?? 0,
		time: (data?.time as number) ?? 0,
	};
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
	const data = await sendAction(
		action,
		apiParams,
		`omp_hist_${target_type}_${target_id}_${Date.now()}`,
	);

	const messages = (data?.messages as Array<Record<string, unknown>>) ?? [];
	return {
		messages: messages.map((msg) => ({
			message_id: (msg.message_id as number) ?? 0,
			user_id: (msg.user_id as number) ?? 0,
			nickname: (msg.nickname as string) ?? "",
			raw_message: (msg.raw_message as string) ?? "",
			time: (msg.time as number) ?? 0,
		})),
	};
}
