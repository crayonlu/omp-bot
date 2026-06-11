import { useCallback, useEffect, useRef, useState } from "react";
import type { WsEvent } from "../types";

export type WsStatus = "connecting" | "connected" | "disconnected";

export interface WsCallbacks {
	onActivity?: (event: WsEvent & { type: "activity" }) => void;
	onStats?: (event: WsEvent & { type: "stats" }) => void;
	onStatus?: (event: WsEvent & { type: "status" }) => void;
	onSession?: (event: WsEvent & { type: "session" }) => void;
}

const WS_PATH = "/ws";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

function getWsUrl(): string {
	if (import.meta.env.DEV) {
		const host = window.location.hostname;
		const port = window.location.port || "5173";
		return `ws://${host}:3099${WS_PATH}`;
	}
	const proto = window.location.protocol === "https:" ? "wss" : "ws";
	return `${proto}://${window.location.host}${WS_PATH}`;
}

export function useWebSocket(callbacks: WsCallbacks) {
	const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);
	const [status, setStatus] = useState<WsStatus>("disconnected");
	const wsRef = useRef<WebSocket | null>(null);
	const callbacksRef = useRef(callbacks);
	callbacksRef.current = callbacks;
	const retriesRef = useRef(0);
	const timerRef = useRef<ReturnType<typeof setTimeout>>();

	const connect = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN) return;

		setStatus("connecting");
		const ws = new WebSocket(getWsUrl());

		ws.onopen = () => {
			setStatus("connected");
			retriesRef.current = 0;
		};

		ws.onmessage = (msg) => {
			try {
				const event = JSON.parse(msg.data) as WsEvent;
				setLastEvent(event);
				const cb = callbacksRef.current;
				switch (event.type) {
					case "activity":
						cb.onActivity?.(event as WsEvent & { type: "activity" });
						break;
					case "stats":
						cb.onStats?.(event as WsEvent & { type: "stats" });
						break;
					case "status":
						cb.onStatus?.(event as WsEvent & { type: "status" });
						break;
					case "session":
						cb.onSession?.(event as WsEvent & { type: "session" });
						break;
				}
			} catch {
				// ignore malformed JSON
			}
		};

		ws.onclose = () => {
			setStatus("disconnected");
			const delay = Math.min(
				RECONNECT_BASE_MS * 2 ** retriesRef.current,
				RECONNECT_MAX_MS,
			);
			retriesRef.current += 1;
			timerRef.current = setTimeout(connect, delay);
		};

		ws.onerror = () => {
			ws.close(); // triggers onclose path
		};

		wsRef.current = ws;
	}, []);

	const send = useCallback((data: unknown) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify(data));
		}
	}, []);

	useEffect(() => {
		connect();
		return () => {
			clearTimeout(timerRef.current);
			wsRef.current?.close();
		};
	}, [connect]);

	return { lastEvent, status, send };
}
