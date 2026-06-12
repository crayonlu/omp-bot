/**
 * Middleware types — internal message and pipeline interfaces
 * that bridge OneBot events to OMP sessions.
 */
import type { MessageSegment } from "../onebot-types";

/** Normalized internal message from OneBot event */
export interface InternalMessage {
	userId: number;
	nickname: string;
	card?: string;
	groupId?: number;
	messageId: number;
	messageType: "private" | "group";
	text: string;
	images: ImageAttachment[];
	otherMedia: MediaSegment[];
	replyTo?: number;
	hasMention: boolean;
	hasAtAll: boolean;
	rawSegments: MessageSegment[];
	timestamp: number;
}

export interface ImageAttachment {
	url?: string;
	fileId: string;
	dataUri?: string;
}

export interface MediaEntry {
	type: "video" | "file" | "share" | "json" | "location" | "face" | "record";
	description: string;
	raw: MessageSegment;
}

/** Model configuration for switching */
export interface ModelConfig {
	id: string;
	provider: string;
	api: string;
	baseUrl: string;
	input: string[];
	maxTokens: number;
	contextWindow: number;
}

/** ImageContent for OMP session.prompt() */
export interface ImageContent {
	type: "image";
	image: string; // URL or data URI
}

/** Pipeline result */
export interface DispatchResult {
	reply: string | null;
	silent: boolean;
	sessionId: string;
	toolCalls: string[];
	error?: string;
	triggerReason?: string;
}