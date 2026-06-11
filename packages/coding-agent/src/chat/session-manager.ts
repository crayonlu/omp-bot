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
import { growthTools } from "./growth-tools";

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

type SessionChangeCallback = (key: string, active: boolean) => void;
const sessionChangeCallbacks: SessionChangeCallback[] = [];

export function onSessionChange(cb: SessionChangeCallback): void {
	sessionChangeCallbacks.push(cb);
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
			customTools: growthTools,
			model: {
				id: "deepseek/deepseek-v4-flash",
				provider: "ppio",
				reasoning: false,
			},
			systemPrompt: (_defaultBlocks) => {
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
		for (const cb of sessionChangeCallbacks) cb(key, true);
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
	for (const cb of sessionChangeCallbacks) cb(key, false);
	logger.info(`[bot-session] Destroyed session ${key}`);
}

// ---------------------------------------------------------------------------
// Background Cleanup
// ---------------------------------------------------------------------------

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_MAX_IDLE_MS = 24 * 60 * 60 * 1000; // 24 hours

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startCleanupTimer(): void {
	if (cleanupTimer) return; // idempotent

	cleanupTimer = setInterval(async () => {
		const now = Date.now();
		for (const [key, botSession] of sessions) {
			if (now - botSession.lastActivity > SESSION_MAX_IDLE_MS) {
				logger.info(`[bot-session] Cleanup: destroying idle session ${key} (last activity ${new Date(botSession.lastActivity).toISOString()})`);
				await destroyBotSession(key);
			}
		}
	}, CLEANUP_INTERVAL_MS).unref();

	logger.info(`[bot-session] Cleanup timer started (every 30min, evict after 24h idle)`);
}

// ---------------------------------------------------------------------------
// System Prompt (per-session)
// ---------------------------------------------------------------------------

import { BOT_SYSTEM_PROMPT } from "./bot-prompt";
import { getPromptOverride } from "./dashboard-api";

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
	const override = getPromptOverride();
	const basePrompt = override ?? BOT_SYSTEM_PROMPT;
	return `${preamble}\n\n---\n\n${basePrompt}`;
