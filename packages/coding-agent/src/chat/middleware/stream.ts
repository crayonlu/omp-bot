/**
 * Stream — manages text_delta accumulation and debounce sending.
 *
 * Accumulates streaming text from OMP, flushes on 800ms silence.
 * Splits at sentence boundaries to avoid mid-sentence truncation.
 * Also flushes on tool calls and turn end (final flush sends all).
 *
 * Sentence boundaries: 。！？.!?\n (including fullwidth CJK punctuation)
 */
import { logger } from "@oh-my-pi/pi-utils";

export type SendFn = (text: string) => Promise<void>;

const SENTENCE_BOUNDARY_RE = /[。！？.!?\n]/;

export class StreamManager {
	private sendBuffer = "";
	private accumulatedReply = "";
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private sendFn: SendFn;
	private debounceMs: number;
	private finalFlush = false;

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
	async flush(final = false): Promise<void> {
		this.finalFlush = final;
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		await this.doFlush();
	}

	/** Flush on turn end (send everything) */
	onEnd(): void {
		this.flush(true);
	}

	/** Flush on tool call — send whatever we have, even mid-sentence. */
	onToolCall(): void {
		this.sendBuffer = this.sendBuffer.trim();
		if (this.sendBuffer) {
			this.flush(true);
		}
	}

	/** Get accumulated text so far */
	getReply(): string {
		return this.accumulatedReply;
	}

	/** Reset state */
	reset(): void {
		this.sendBuffer = "";
		this.accumulatedReply = "";
		this.finalFlush = false;
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	private scheduleFlush(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => this.doFlush(), this.debounceMs);
	}

	/**
	 * Find the last sentence-boundary index in the given text.
	 * Returns -1 when no boundary is found.
	 */
	private static lastSentenceBoundary(text: string): number {
		for (let i = text.length - 1; i >= 0; i--) {
			if (SENTENCE_BOUNDARY_RE.test(text[i])) return i;
		}
		return -1;
	}

	private async doFlush(): Promise<void> {
		const buffer = this.sendBuffer;
		if (!buffer) return;

		// Final flush: send everything regardless of boundaries.
		if (this.finalFlush) {
			this.sendBuffer = "";
			this.finalFlush = false;
			const text = buffer.trim();
			if (text) {
				try {
					await this.sendFn(text);
				} catch (err) {
					logger.error(`[stream] send failed: ${err}`);
				}
			}
			return;
		}

		// Try to split at the last sentence boundary.
		const boundary = StreamManager.lastSentenceBoundary(buffer);
		if (boundary >= 0) {
			// Split after the boundary char (include it in the sent chunk).
			const send = buffer.slice(0, boundary + 1).trim();
			this.sendBuffer = buffer.slice(boundary + 1);
			if (send) {
				try {
					await this.sendFn(send);
				} catch (err) {
					logger.error(`[stream] send failed: ${err}`);
				}
			}
		}
		// No sentence boundary → keep accumulating; don't send partial text.
		// The content stays in sendBuffer and gets flushed on the next
		// timer fire or final flush.
	}
}
