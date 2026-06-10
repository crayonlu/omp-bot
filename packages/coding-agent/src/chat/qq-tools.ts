/**
 * QQ tools registered as OMP custom tools.
 *
 * These tools call the OneBot v11 HTTP API on the NapCat container.
 * NapCat listens on port 3000 for HTTP API calls.
 */
import { logger } from "@oh-my-pi/pi-utils";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ONEBOT_HTTP_URL = process.env.ONEBOT_HTTP_URL ?? "http://127.0.0.1:3000";

// ---------------------------------------------------------------------------
// API Helpers
// ---------------------------------------------------------------------------

interface OneBotApiResponse<T = unknown> {
	status: "ok" | "failed";
	retcode: number;
	data: T;
	msg?: string;
}

async function onebotApi<T = unknown>(
	action: string,
	params: Record<string, unknown> = {},
): Promise<OneBotApiResponse<T>> {
	const resp = await fetch(`${ONEBOT_HTTP_URL}/${action}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(params),
	});

	if (!resp.ok) {
		throw new Error(`OneBot API error: ${resp.status} ${resp.statusText}`);
	}

	return resp.json() as Promise<OneBotApiResponse<T>>;
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
	const resp = await onebotApi<{ message_id: number }>(action, apiParams);

	if (resp.status !== "ok") {
		throw new Error(`Failed to send message: retcode=${resp.retcode} msg=${resp.msg}`);
	}

	return { message_id: resp.data.message_id };
}

// ---------------------------------------------------------------------------
// Tool: qq_get_message
// ---------------------------------------------------------------------------

export async function qqGetMessage(message_id: number): Promise<{
	raw_message: string;
	user_id: number;
	time: number;
}> {
	const resp = await onebotApi<{
		message_id: number;
		raw_message: string;
		user_id: number;
		time: number;
	}>("get_msg", { message_id });

	if (resp.status !== "ok") {
		throw new Error(`Failed to get message: retcode=${resp.retcode}`);
	}

	return {
		raw_message: resp.data.raw_message,
		user_id: resp.data.user_id,
		time: resp.data.time,
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

	const resp = await onebotApi<{
		messages: Array<{
			message_id: number;
			user_id: number;
			nickname?: string;
			sender?: { nickname: string };
			raw_message: string;
			time: number;
		}>;
	}>(action, apiParams);

	if (resp.status !== "ok") {
		throw new Error(`Failed to get history: retcode=${resp.retcode}`);
	}

	return {
		messages: resp.data.messages.map(m => ({
			message_id: m.message_id,
			user_id: m.user_id,
			nickname: m.nickname ?? m.sender?.nickname ?? String(m.user_id),
			raw_message: m.raw_message,
			time: m.time,
		})),
	};
}
