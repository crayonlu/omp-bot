/**
 * Ring buffer message queue.
 *
 * Tracks recent message IDs in a Set for deduplication.
 * No monotonic ID assumption — QQ message_ids are not sequential.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { OneBotMessageEvent } from "./onebot-gateway";

interface QueuedMessage {
	event: OneBotMessageEvent;
	timestamp: number;
}

export class MessageQueue {
	private buffer: QueuedMessage[] = [];
	private capacity: number;
	private recentIds = new Set<number>();
	private readonly MAX_TRACKED_IDS = 1000;

	constructor(capacity = 500) {
		this.capacity = capacity;
	}

	/** Push a message into the queue. Returns false if dropped (duplicate). */
	push(event: OneBotMessageEvent): boolean {
		// Deduplicate by message_id using a recent-ID set (not monotonic)
		if (this.recentIds.has(event.message_id)) {
			logger.debug(`[queue] duplicate msg_id=${event.message_id} — dropped`);
			return false;
		}

		this.recentIds.add(event.message_id);
		// Prune tracked IDs to prevent memory leak
		if (this.recentIds.size > this.MAX_TRACKED_IDS) {
			const toRemove = Array.from(this.recentIds).slice(0, 500);
			for (const id of toRemove) this.recentIds.delete(id);
		}

		this.buffer.push({
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

	/** Clear all messages and tracked IDs. */
	clear(): void {
		this.buffer = [];
		this.recentIds.clear();
	}
}