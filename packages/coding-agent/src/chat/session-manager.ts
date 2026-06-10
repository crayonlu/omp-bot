/**
 * Per-user session management for the QQ bot.
 *
 * Each session key ("private:<uid>" or "group:<gid>") maps to an OMP
 * AgentSession in its own workspace directory. Sessions are lazy-created
 * on first message and persisted indefinitely.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { $env, logger, setProjectDir, getProjectDir } from "@oh-my-pi/pi-utils";
import type { CreateAgentSessionOptions, CreateAgentSessionResult } from "../sdk";
import type { AgentSession } from "../session/agent-session";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BotSessionConfig {
	targetType: "private" | "group";
	targetId: number;
	userName: string;
}

export interface BotSession {
	sessionKey: string;
	config: BotSessionConfig;
	session: AgentSession;
	workspaceDir: string;
	createdAt: number;
	lastActivity: number;
}

// ---------------------------------------------------------------------------
// Session Storage
// ---------------------------------------------------------------------------

const sessions = new Map<string, BotSession>();

const WORKSPACE_ROOT = process.env.OMP_BOT_WORKSPACE ?? resolve(getProjectDir(), "..", "omp-bot-workspace");

function getWorkspaceDir(key: string): string {
	return resolve(WORKSPACE_ROOT, key.replace(":", "/"));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getBotSession(key: string): BotSession | undefined {
	return sessions.get(key);
}

export function listBotSessions(): BotSession[] {
	return Array.from(sessions.values());
}

export async function createBotSession(key: string, config: BotSessionConfig): Promise<BotSession> {
	const workspaceDir = getWorkspaceDir(key);

	// Ensure workspace directory exists
	mkdirSync(workspaceDir, { recursive: true });

	// Override project dir so tools operate in the user's workspace
	const prevProjectDir = getProjectDir();
	setProjectDir(workspaceDir);

	try {
		const sessionOpts: CreateAgentSessionOptions = {
			cwd: workspaceDir,
			enableLsp: false,
			skipPythonPreflight: true,
			spawns: "bash",
			systemPrompt: (defaultBlocks) => {
				// Discard default coding-agent prompt, use bot prompt
				const botPrompt = buildBotSessionPrompt(config);
				return [botPrompt];
			},
		};

		// Dynamic import to avoid circular deps at module load time
		const { createAgentSession } = await import("../sdk");

		const result: CreateAgentSessionResult = await logger.time(
			`bot:session:create:${key}`,
			() => createAgentSession(sessionOpts),
		);

		const now = Date.now();
		const botSession: BotSession = {
			sessionKey: key,
			config,
			session: result.session,
			workspaceDir,
			createdAt: now,
			lastActivity: now,
		};

		sessions.set(key, botSession);
		logger.info(`[bot-session] Created session ${key} at ${workspaceDir}`);
		return botSession;
	} finally {
		setProjectDir(prevProjectDir);
	}
}

export async function destroyBotSession(key: string): Promise<void> {
	const botSession = sessions.get(key);
	if (!botSession) return;

	await botSession.session.dispose();
	sessions.delete(key);
	logger.info(`[bot-session] Destroyed session ${key}`);
}

// ---------------------------------------------------------------------------
// System Prompt (per-session)
// ---------------------------------------------------------------------------

import { BOT_SYSTEM_PROMPT } from "./bot-prompt";

function buildBotSessionPrompt(config: BotSessionConfig): string {
	const targetLabel = config.targetType === "private"
		? `private chat with ${config.userName}`
		: `group chat **${config.userName}**`;

	const preamble = [
		`You are now in a **${targetLabel}**.`,
		`Your session key is: ${config.targetType}:${config.targetId}`,
		``,
		`You have access to read/write files in your workspace.`,
		`Store user preferences in /workspace/memory.md.`,
		`Reflect on your behavior in /workspace/self-improvement.md.`,
	].join("\n");

	return `${preamble}\n\n---\n\n${BOT_SYSTEM_PROMPT}`;
}
