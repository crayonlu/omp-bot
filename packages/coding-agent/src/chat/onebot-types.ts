/**
 * OneBot v11 message types used by the QQ bridge.
 *
 * Reference: https://onebots.pages.dev/en/protocol/onebot-v11
 */

export interface MessageSegmentText {
	type: "text";
	data: { text: string };
}

export interface MessageSegmentAt {
	type: "at";
	data: { qq: string };
}

export interface MessageSegmentImage {
	type: "image";
	data: { file: string; url?: string; type?: string };
}

export interface MessageSegmentFace {
	type: "face";
	data: { id: string };
}

export interface MessageSegmentReply {
	type: "reply";
	data: { id: string };
}

export interface MessageSegmentRecord {
	type: "record";
	data: { file: string };
}

export interface MessageSegmentVideo {
	type: "video";
	data: { file: string };
}

export interface MessageSegmentFile {
	type: "file";
	data: { file: string; name?: string };
}

export interface MessageSegmentShare {
	type: "share";
	data: { url: string; title?: string };
}

export interface MessageSegmentJson {
	type: "json";
	data: { data: string };
}

export interface MessageSegmentLocation {
	type: "location";
	data: { lat: string; lon: string };
}

export type MessageSegment =
	| MessageSegmentText
	| MessageSegmentAt
	| MessageSegmentImage
	| MessageSegmentFace
	| MessageSegmentReply
	| MessageSegmentRecord
	| MessageSegmentVideo
	| MessageSegmentFile
	| MessageSegmentShare
	| MessageSegmentJson
	| MessageSegmentLocation;
