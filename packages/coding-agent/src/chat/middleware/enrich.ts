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
			const data = resp as any;
			if (data?.base64) {
				results.push({ ...img, dataUri: `data:image/jpeg;base64,${data.base64}` });
				logger.info(`[enrich] image ${img.fileId.slice(0, 8)} → base64 (${data.base64.length}b)`);
			} else {
				logger.warn(`[enrich] get_image returned no base64 for ${img.fileId.slice(0, 8)}`);
				results.push(img);
			}
		} catch (err) {
			logger.warn(`[enrich] get_image failed for ${img.fileId.slice(0, 8)}: ${err}`);
			results.push(img);
		}
	}

	return results;
}