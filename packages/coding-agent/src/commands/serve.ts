/**
 * Run Oh My Pi as a persistent QQ bot server.
 *
 * Starts an HTTP server that accepts chat messages, maintains per-user
 * agent sessions, and dispatches messages to the OMP agent for processing.
 */
import { Command } from "@oh-my-pi/pi-utils/cli";
import { parseArgs } from "../cli/args";
import { runServeMode } from "../chat/serve-cli";

export default class Serve extends Command {
	static description = "Run Oh My Pi as a persistent chat bot server";
	static strict = false;

	async run(): Promise<void> {
		const args = parseArgs(this.argv);
		await runServeMode(args);
	}
}
