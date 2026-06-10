/**
 * OneBot v11 Reverse WebSocket Server.
 *
 * NapCat connects to US (reverse WS). We receive message events and
 * send API calls back to NapCat's HTTP API on port 3000.
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
	};
	time: number;
	self_id: number;
}

export type OneBotEventHandler = (event: OneBotMessageEvent) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const WS_PATH = "/onebot/ws";
const WS_PORT = parseInt(process.env.ONEBOT_WS_PORT ?? "3001", 10);

export class OneBotGateway {
	private server: ReturnType<typeof Bun.serve> | null = null;
	private wsConnection: WebSocket | null = null;
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

	/** Send an action (API call) to NapCat through the WS connection. */
	send(data: string): void {
		if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
			this.wsConnection.send(data);
		} else {
			logger.warn("[onebot] Cannot send — WS not connected");
		}
	}
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

	start(): void {
		this.server = Bun.serve({
			port: WS_PORT,
			fetch: (req, server) => {
				const url = new URL(req.url);
				if (url.pathname === WS_PATH && req.headers.get("upgrade") === "websocket") {
					if (server.upgrade(req)) return;
					return new Response("Upgrade failed", { status: 500 });
				}
				if (url.pathname === "/health") {
					return new Response(JSON.stringify({ ok: true, onebot_ws: WS_PATH }), {
						headers: { "Content-Type": "application/json" }
					});
				}
				return new Response("Not Found", { status: 404 });
			},
			websocket: {
				open: (ws) => {
					this.wsConnection = ws;
					this.connected = true;
					logger.info(`[onebot] NapCat connected`);
				},
				message: (ws, msg) => {
					this.handleRawMessage(msg as string);
				},
				close: (ws) => {
					this.wsConnection = null;
					this.connected = false;
					logger.warn(`[onebot] NapCat disconnected`);
				},
			},
		});
		logger.info(`[onebot] WebSocket server on ws://0.0.0.0:${WS_PORT}${WS_PATH}`);
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
}
