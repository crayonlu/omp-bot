/**
 * Unified bot configuration — stored as /data/bot-config.json
 *
 * All settings live in one file. Other state files (activity/logs/sessions)
 * are managed separately but stored on the same persistent volume.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { logger } from "@oh-my-pi/pi-utils";

const CONFIG_PATH = "/data/bot-config.json";

export interface BotConfig {
	model: string;
	promptOverride: string | null;
	marketplace: { autoUpdate: "on" | "off" };
	webSearch: { enabled: boolean; provider: string; endpoint: string };
}

let cachedConfig: BotConfig | null = null;

const DEFAULTS: BotConfig = {
	model: "",
	promptOverride: null,
	marketplace: { autoUpdate: "off" },
	webSearch: { enabled: true, provider: "searxng", endpoint: "https://search.cyncyn.xyz" },
};

export function loadConfig(): BotConfig {
	if (cachedConfig) return cachedConfig;
	try {
		if (existsSync(CONFIG_PATH)) {
			const raw = readFileSync(CONFIG_PATH, "utf-8");
			cachedConfig = { ...DEFAULTS, ...JSON.parse(raw) };
			return cachedConfig!;
		}
	} catch (err) {
		logger.warn(`[config] Failed to load config: ${err}`);
	}
	cachedConfig = { ...DEFAULTS };
	return cachedConfig;
}

export function saveConfig(partial: Partial<BotConfig>): BotConfig {
	const current = loadConfig();
	cachedConfig = { ...current, ...partial };
	try {
		writeFileSync(CONFIG_PATH, JSON.stringify(cachedConfig, null, 2), "utf-8");
		logger.info(`[config] Saved config`);
	} catch (err) {
		logger.warn(`[config] Failed to save config: ${err}`);
	}
	return cachedConfig;
}

export function getConfig(): BotConfig {
	return loadConfig();
}