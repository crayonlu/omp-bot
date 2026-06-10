/**
 * Ring buffer message queue.
 *
 * Survives WebSocket disconnects by buffering messages in memory.
 * Tracks sequence IDs for replay detection.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { OneBotMessageEvent } from "./onebot-gateway";

interface QueuedMessage {
	seq: number;
	event: OneBotMessageEvent;
	timestamp: number;
}

export class MessageQueue {
	private buffer: QueuedMessage[] = [];
	private capacity: number;
	private lastSeq = 0;

	constructor(capacity = 500) {
		this.capacity = capacity;
	}

	/** Push a message into the queue. Returns false if dropped (duplicate). */
	push(event: OneBotMessageEvent): boolean {
		// Deduplicate by message_id
		if (event.message_id <= this.lastSeq) {
			return false;
		}
		this.lastSeq = event.message_id;

		this.buffer.push({
			seq: event.message_id,
			event,
			timestamp: Date.now(),
		});

		// Evict oldest if over capacity
		while (this.buffer.length > this.capacity) {
			this.buffer.shift();
		}

		return true;
	}

	/** Dequeue and return the oldest message, or null if empty. */
	dequeue(): QueuedMessage | null {
		return this.buffer.shift() ?? null;
	}

	/** Check if there are pending messages. */
	get hasMessages(): boolean {
		return this.buffer.length > 0;
	}

	/** Get queue depth for monitoring. */
	get depth(): number {
		return this.buffer.length;
	}

	/** Get messages since a given sequence ID (for replay after reconnect). */
	getSince(seq: number): OneBotMessageEvent[] {
		return this.buffer
			.filter(m => m.seq > seq)
			.sort((a, b) => a.seq - b.seq)
			.map(m => m.event);
	}

	/** Clear all messages (used on reconnect — NapCat replays anyway). */
	clear(): void {
		this.buffer = [];
	}

	/** Get the last seen sequence ID. */
	get lastSequence(): number {
		return this.lastSeq;
	}
}
