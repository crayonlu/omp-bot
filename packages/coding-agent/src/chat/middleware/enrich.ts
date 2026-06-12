/**
 * Enrich — downloads attachments (images via NapCat get_image) and
 * converts to base64 data URIs so the vision model can read them.
 *
 * Uses the same WS echo mechanism as qqSendMessage to call
 * OneBot's get_image action.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { ImageAttachment } from "./types";

/** Injected by pipeline on startup */
let sendActionFn: ((action: string, params: Record<string, unknown>, echo: string) => Promise<Record<string, unknown>>) | null = null;

export function setEnrichSendAction(fn: typeof sendActionFn): void {
	sendActionFn = fn;
}

/**
 * Download all images via NapCat's get_image API.
 * Returns attachments with dataUri populated on success, or unchanged on failure.
 */
export async function enrichImages(images: ImageAttachment[]): Promise<ImageAttachment[]> {
	if (images.length === 0 || !sendActionFn) return images;

	const results: ImageAttachment[] = [];

	for (const img of images) {
		if (!img.fileId) {
			results.push(img);
			continue;
		}
		try {
			const echo = `omp_img_${img.fileId.slice(0, 8)}_${Date.now()}`;
			const resp = await sendActionFn("get_image", { file: img.fileId }, echo);
			logger.info(`[enrich] get_image response keys=${Object.keys(resp as object).join(",")}`);
			// NapCat get_image returns { file, file_size, base64?, filename?, url? }
			const data = resp as Record<string, unknown>;
			if (data?.base64 && typeof data.base64 === "string") {
				results.push({ ...img, dataUri: `data:image/jpeg;base64,${data.base64}` });
				logger.info(`[enrich] image ${img.fileId.slice(0, 8)} → base64 (${(data.base64 as string).length}b)`);
			} else if (data?.url && typeof data.url === "string") {
				// Fallback: NapCat might return only url (no base64) in some configurations
				results.push({ ...img, dataUri: data.url });
				logger.info(`[enrich] image ${img.fileId.slice(0, 8)} → url (${(data.url as string).slice(0, 60)}…)`);
			} else {
				logger.warn(`[enrich] get_image response with no usable data for ${img.fileId.slice(0, 8)}: ${JSON.stringify(data).slice(0, 200)}`);
				results.push(img);
			}
		} catch (err) {
			logger.warn(`[enrich] get_image failed for ${img.fileId.slice(0, 8)}: ${err}`);
			results.push(img);
		}
	}

	return results;
}