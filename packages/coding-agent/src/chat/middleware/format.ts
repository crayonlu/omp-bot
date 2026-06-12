/**
 * Format — converts InternalMessage into the prompt text string and
 * ImageContent[] that OMP's session.prompt() accepts.
 *
 * Non-image media (video, file, share, etc.) are described in text
 * so Zero can decide what to do with them (e.g. write a script to
 * extract frames, download the file, etc.).
 */
import type { InternalMessage, ImageContent } from "./types";

export interface FormattedPrompt {
	text: string;
	images: ImageContent[];
}

/**
 * Build prompt text and image content for OMP from an InternalMessage.
 */
export function formatPrompt(msg: InternalMessage): FormattedPrompt {
	const parts: string[] = [];

	// Message source header
	const scope = msg.messageType === "private" ? "private" : `group:${msg.groupId}`;
	const displayName = msg.card || msg.nickname;
	parts.push(`[${new Date(msg.timestamp * 1000).toISOString()}] [${scope}] [uid:${msg.userId}] ${displayName}:`);

	// Reply context
	if (msg.replyTo) {
		parts.push(`  [回复消息 id=${msg.replyTo}]`);
	}

	// Images — described in text for context, actual data passed as ImageContent[]
	for (const img of msg.images) {
		if (img.dataUri) {
			parts.push(`  [图片: 已加载，可以分析]`);
		} else {
			parts.push(`  [图片: 需要下载分析]`);
		}
	}

	// Other media — describe in text so OMP can decide how to handle
	for (const media of msg.otherMedia) {
		parts.push(`  ${media.description}`);
	}

	// Message text
	const textContent = msg.text || "(media-only message)";
	parts.push(`  ${textContent}`);

	// Build ImageContent[] from enriched images
	const images: ImageContent[] = [];
	for (const img of msg.images) {
		const src = img.dataUri || img.url;
		if (src) {
			images.push({ type: "image", image: src });
		}
	}

	return {
		text: parts.join("\n"),
		images,
	};
}