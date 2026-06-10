/**
 * OneBot v11 WebSocket Gateway.
 *
 * Connects to NapCat's reverse WebSocket endpoint, handles heartbeat,
 * parses incoming message events, and routes them to the trigger decider.
 *
 * Reference: https://onebots.pages.dev/en/protocol/onebot-v11
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { MessageSegment } from "./onebot-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OneBotMessageEvent {
	post_type: "message";
	message_type: "private" | "group";
	sub_type: string;
	message_id: number;
	user_id: number;
	group_id?: number;
	message: MessageSegment[];
	raw_message: string;
	font: number;
	sender: {
		user_id: number;
		nickname: string;
		card?: string;
		sex?: string;
		age?: number;
		role?: string;
	};
	time: number;
	self_id: number;
}

export type OneBotEventHandler = (event: OneBotMessageEvent) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ONEBOT_WS_URL = process.env.ONEBOT_WS_URL ?? "ws://127.0.0.1:6099";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 15000;

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

export class OneBotGateway {
	private ws: WebSocket | null = null;
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private handler: OneBotEventHandler | null = null;
	private selfId: number | null = null;
	private connected = false;

	get isConnected(): boolean {
		return this.connected;
	}

	get botSelfId(): number | null {
		return this.selfId;
	}

	onMessage(handler: OneBotEventHandler): void {
		this.handler = handler;
	}

	async connect(): Promise<void> {
		logger.info(`[onebot] Connecting to ${ONEBOT_WS_URL}...`);

		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket(ONEBOT_WS_URL);

				this.ws.onopen = () => {
					logger.info(`[onebot] Connected`);
					this.connected = true;
					this.reconnectAttempt = 0;
					this.startHeartbeat();
					resolve();
				};

				this.ws.onmessage = (event: MessageEvent) => {
					this.handleRawMessage(event.data);
				};

				this.ws.onclose = (event) => {
					logger.warn(`[onebot] Disconnected (code=${event.code}, reason=${event.reason})`);
					this.connected = false;
					this.stopHeartbeat();
					this.scheduleReconnect();
				};

				this.ws.onerror = (err) => {
					logger.error(`[onebot] WebSocket error: ${err}`);
					// onclose will fire after this
				};

			} catch (err) {
				reject(err);
			}
		});
	}

	disconnect(): void {
		this.connected = false;
		this.stopHeartbeat();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.close(1000, "client disconnect");
			this.ws = null;
		}
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	private handleRawMessage(data: string): void {
		try {
			const msg = JSON.parse(data);
			if (msg.post_type === "meta_event" && msg.meta_event_type === "lifecycle") {
				this.selfId = msg.self_id;
				logger.info(`[onebot] Lifecycle: self_id=${this.selfId}`);
				return;
			}
			if (msg.post_type === "message" && this.handler) {
				this.handler(msg as OneBotMessageEvent);
			}
		} catch (err) {
			logger.warn(`[onebot] Failed to parse message: ${err}`);
		}
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = setInterval(() => {
			if (this.ws && this.ws.readyState === WebSocket.OPEN) {
				this.ws.send(JSON.stringify({
					action: "get_status",
					echo: `hb_${Date.now()}`
				}));
			}
		}, HEARTBEAT_INTERVAL_MS);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	private scheduleReconnect(): void {
		const delay = Math.min(
			RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt),
			RECONNECT_MAX_MS
		);
		this.reconnectAttempt++;
		logger.warn(`[onebot] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempt})`);

		this.reconnectTimer = setTimeout(async () => {
			try {
				await this.connect();
			} catch (err) {
				logger.error(`[onebot] Reconnect failed: ${err}`);
				// connect()'s onclose will trigger another reconnect
			}
		}, delay);
	}
}
