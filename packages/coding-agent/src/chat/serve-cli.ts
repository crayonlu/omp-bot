/**
 * Serve mode: persistent HTTP + OneBot server for QQ bot integration.
 *
 * Delegates to the bot-runner module which wires all components together.
 */
import type { Args } from "../cli/args";

export { runBotServer as runServeMode } from "./bot-runner";
