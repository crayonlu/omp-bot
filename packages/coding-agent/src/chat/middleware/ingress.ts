/**
 * Ingress — converts raw OneBot message segments into an InternalMessage.
 *
 * Handles: text, image, reply, at, face, video, file, share, json, location, record.
 * Non-text, non-image segments are passed through as MediaEntry for Zero to handle.
 * Image fileIds are extracted for enrichment (get_image → base64).
 */
import type { MessageSegment } from "../onebot-types";
import type { InternalMessage, ImageAttachment, MediaEntry } from "./types";

export function parseEvent(event: {
	post_type: "message";
	message_type: "private" | "group";
	sub_type: string;
	message_id: number;
	user_id: number;
	group_id?: number;
	message: MessageSegment[];
	raw_message: string;
	sender: { nickname: string; card?: string; user_id: number };
	time: number;
	self_id: number;
}, botSelfId: number): InternalMessage {
	const segments = event.message || [];
	let text = "";
	const images: ImageAttachment[] = [];
	const otherMedia: MediaEntry[] = [];
	let replyTo: number | undefined;
	let hasMention = false;
	let hasAtAll = false;

	for (const seg of segments) {
		switch (seg.type) {
			case "text":
				text += seg.data.text;
				break;
			case "image":
				images.push({
					url: seg.data.url,
					fileId: seg.data.file,
				});
				break;
			case "reply":
				replyTo = parseInt(seg.data.id, 10);
				break;
			case "at": {
				const target = seg.data.qq;
				if (target === String(botSelfId)) hasMention = true;
				if (target === "all") hasAtAll = true;
				// Keep @ text visible
				text += ` @${target === "all" ? "全体成员" : seg.data.qq}`;
				break;
			}
			case "face": {
				const entry: MediaEntry = {
					type: "face",
					description: `[表情:${seg.data.id}]`,
					raw: seg as MessageSegment,
				};
				otherMedia.push(entry);
				break;
			}
			case "video": {
				const entry: MediaEntry = {
					type: "video",
					description: `[视频文件:${seg.data.file}]`,
					raw: seg as MessageSegment,
				};
				otherMedia.push(entry);
				break;
			}
			case "record": {
				const entry: MediaEntry = {
					type: "record",
					description: `[语音:${seg.data.file}]`,
					raw: seg as MessageSegment,
				};
				otherMedia.push(entry);
				break;
			}
			case "file": {
				const entry: MediaEntry = {
					type: "file",
					description: `[文件:${seg.data.name ?? seg.data.file}]`,
					raw: seg as MessageSegment,
				};
				otherMedia.push(entry);
				break;
			}
			case "share": {
				const entry: MediaEntry = {
					type: "share",
					description: `[分享:${seg.data.title ?? seg.data.url}] ${seg.data.url}`,
					raw: seg as MessageSegment,
				};
				otherMedia.push(entry);
				break;
			}
			case "json": {
				const entry: MediaEntry = {
					type: "json",
					description: `[富媒体消息]`,
					raw: seg as MessageSegment,
				};
				otherMedia.push(entry);
				break;
			}
			case "location": {
				const entry: MediaEntry = {
					type: "location",
					description: `[位置:${seg.data.lat},${seg.data.lon}]`,
					raw: seg as MessageSegment,
				};
				otherMedia.push(entry);
				break;
			}
		}
	}

	return {
		userId: event.user_id,
		nickname: event.sender.nickname,
		card: event.sender.card,
		groupId: event.group_id,
		messageId: event.message_id,
		messageType: event.message_type,
		text: text.trim(),
		images,
		otherMedia,
		replyTo,
		hasMention,
		hasAtAll,
		rawSegments: segments,
		timestamp: event.time,
	};
}