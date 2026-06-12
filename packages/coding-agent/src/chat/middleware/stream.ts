/**
 * Stream — manages text_delta accumulation and debounce sending.
 *
 * Accumulates streaming text from OMP, flushes on 800ms silence,
 * also flushes on tool calls and turn end.
 */
import { logger } from "@oh-my-pi/pi-utils";

export type SendFn = (text: string) => Promise<void>;

export class StreamManager {
	private sendBuffer = "";
	private accumulatedReply = "";
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private sendFn: SendFn;
	private debounceMs: number;
	private flushed = false;

	constructor(sendFn: SendFn, debounceMs = 800) {
		this.sendFn = sendFn;
		this.debounceMs = debounceMs;
	}

	/** Receive a text delta from stream */
	onDelta(delta: string): void {
		this.accumulatedReply += delta;
		this.sendBuffer += delta;
		this.scheduleFlush();
	}

	/** Flush immediately (called on tool calls and turn end) */
	async flush(): Promise<void> {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		await this.doFlush();
	}

	/** Flush on turn end */
	onEnd(): void {
		this.flush();
	}

	/** Flush on tool call — send what we have so far */
	onToolCall(): void {
		this.flush();
	}

	/** Get accumulated text so far */
	getReply(): string {
		return this.accumulatedReply;
	}

	/** Reset state */
	reset(): void {
		this.sendBuffer = "";
		this.accumulatedReply = "";
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	private scheduleFlush(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => this.doFlush(), this.debounceMs);
	}

	private async doFlush(): Promise<void> {
		const text = this.sendBuffer.trim();
		if (!text) return;
		this.sendBuffer = "";
		try {
			await this.sendFn(text);
		} catch (err) {
			logger.error(`[stream] send failed: ${err}`);
		}
	}
}