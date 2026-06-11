/**
 * Self-Growth tools — plugin installation and marketplace search.
 *
 * Registered as OMP CustomTools so Zero can call them during agent turns.
 * These wrap the OMP CLI (`omp plugin marketplace`, `omp plugin install`).
 */
import { logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import type { CustomTool, CustomToolContext } from "../extensibility/custom-tools/types";
import type { AgentToolResult } from "../tools";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function runOmp(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	try {
		const result = await $`/usr/local/bin/omp ${args}`.quiet();
		return { stdout: result.stdout.toString().trim(), stderr: result.stderr.toString().trim(), exitCode: 0 };
	} catch (err: any) {
		return {
			stdout: err.stdout?.toString().trim() ?? "",
			stderr: err.stderr?.toString().trim() ?? String(err),
			exitCode: err.exitCode ?? 1,
		};
	}
}

// ---------------------------------------------------------------------------
// install_plugin
// ---------------------------------------------------------------------------

export const installPluginTool: CustomTool = {
	name: "install_plugin",
	label: "Install Plugin",
	description:
		"Install a plugin from the OMP marketplace to gain new capabilities. " +
		"Use this when you encounter a task your current tools cannot handle. " +
		"Search for available plugins first with search_plugins. " +
		"Plugins are safe — they come from the verified marketplace.",

	parameters: {
		type: "object",
		properties: {
			plugin_name: {
				type: "string",
				description: "Name of the plugin to install, e.g. 'web-search' or 'image-gen'",
			},
		},
		required: ["plugin_name"],
	},

	async execute(
		_toolCallId: string,
		params: { plugin_name: string },
		_onUpdate: any,
		_ctx: CustomToolContext,
	) {
		logger.info(`[self-growth] Installing plugin: ${params.plugin_name}`);
		const result = await runOmp(["plugin", "install", params.plugin_name]);

		if (result.exitCode === 0) {
			return {
				content: [{ type: "text" as const, text: `Plugin "${params.plugin_name}" installed successfully.\n${result.stdout}` }],
			};
		}
		return {
			content: [{ type: "text" as const, text: `Failed to install "${params.plugin_name}":\n${result.stderr || result.stdout}` }],
			isError: true,
		};
	},
};

// ---------------------------------------------------------------------------
// search_plugins
// ---------------------------------------------------------------------------

export const searchPluginsTool: CustomTool = {
	name: "search_plugins",
	label: "Search Plugins",
	description:
		"Search the OMP plugin marketplace for available plugins. " +
		"Use this to discover new capabilities you can install. " +
		"After finding a plugin, use install_plugin to acquire it.",

	parameters: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "Search query, e.g. 'image generation' or 'web search' or 'memory'",
			},
		},
		required: ["query"],
	},

	async execute(
		_toolCallId: string,
		params: { query: string },
		_onUpdate: any,
		_ctx: CustomToolContext,
	) {
		logger.info(`[self-growth] Searching plugins for: ${params.query}`);
		const result = await runOmp(["plugin", "marketplace", "search", params.query]);

		if (result.exitCode === 0) {
			return {
				content: [{ type: "text" as const, text: `Search results for "${params.query}":\n${result.stdout || "(no results)"}` }],
			};
		}
		return {
			content: [{ type: "text" as const, text: `Search failed: ${result.stderr || result.stdout}` }],
			isError: true,
		};
	},
};

// ---------------------------------------------------------------------------
// All growth tools
// ---------------------------------------------------------------------------

export const growthTools: CustomTool[] = [installPluginTool, searchPluginsTool];
