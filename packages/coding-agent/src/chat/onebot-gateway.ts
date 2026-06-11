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

/** Timeout for API call echoes (ms). */
const ECHO_TIMEOUT_MS = 30_000;

export class OneBotGateway {
	private server: Bun.Server<undefined> | null = null;
	private wsConnection: Bun.ServerWebSocket<undefined> | null = null;
	private handler: OneBotEventHandler | null = null;
	private selfId: number | null = null;
	private pendingEchoes = new Map<
		string,
		{ resolve: (data: unknown) => void; reject: (err: Error) => void }
	>();
	private connected = false;
	private statusCallbacks: Array<(connected: boolean) => void> = [];

	get isConnected(): boolean {
		return this.connected;
	}

	get botSelfId(): number | null {
		return this.selfId;
	}

	onMessage(handler: OneBotEventHandler): void {
		this.handler = handler;
	}

	onStatusChange(cb: (connected: boolean) => void): void {
		this.statusCallbacks.push(cb);
	}

	/**
	 * Register a pending echo for an API call.
	 * Returns a promise that resolves when the WS response arrives,
	 * or rejects on timeout.
	 */
	registerEcho(echo: string): Promise<unknown> {
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingEchoes.delete(echo);
				reject(new Error(`[onebot] Echo timeout: ${echo}`));
			}, ECHO_TIMEOUT_MS);

			this.pendingEchoes.set(echo, {
				resolve: (data: unknown) => {
					clearTimeout(timer);
					this.pendingEchoes.delete(echo);
					resolve(data);
				},
				reject: (err: Error) => {
					clearTimeout(timer);
					this.pendingEchoes.delete(echo);
					reject(err);
				},
			});
		});
	}

	/** Send raw data through the WS connection. */
	send(data: string): void {
		if (this.wsConnection && this.wsConnection.readyState === 1) {
			this.wsConnection.send(data);
		} else {
			logger.warn("[onebot] Cannot send — WS not connected");
		}
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
					for (const cb of this.statusCallbacks) cb(true);
					logger.info(`[onebot] NapCat connected`);
				},
				message: (ws, msg) => {
					this.handleRawMessage(msg as string);
				},
				close: (ws) => {
					this.wsConnection = null;
					this.connected = false;
					this.rejectPendingEchoes();
					for (const cb of this.statusCallbacks) cb(false);
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

			// API response: echo + status fields
			if (msg.echo !== undefined && msg.status !== undefined) {
				const pending = this.pendingEchoes.get(msg.echo);
				if (pending) {
					if (msg.status === "ok" || msg.retcode === 0) {
						pending.resolve(msg.data);
					} else {
						pending.reject(
							new Error(
								`[onebot] API error: ${msg.status} retcode=${msg.retcode} echo=${msg.echo}`
							)
						);
					}
				}
				return;
			}

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

	private rejectPendingEchoes(): void {
		for (const [echo, pending] of this.pendingEchoes) {
			pending.reject(new Error(`[onebot] WS disconnected (echo: ${echo})`));
		}
		this.pendingEchoes.clear();
	}
}
