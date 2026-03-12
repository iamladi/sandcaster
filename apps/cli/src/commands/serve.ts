import { serve } from "@hono/node-server";
import type { AppDeps } from "@sandcaster/api";
import { createApp as apiCreateApp } from "@sandcaster/api";
import type { SandcasterConfig } from "@sandcaster/core";
import { loadConfig as coreLoadConfig } from "@sandcaster/core";
import { defineCommand } from "citty";
import type { Hono } from "hono";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServeArgs {
	port: number;
	host: string;
}

export interface ServeDeps {
	loadConfig: (dir?: string) => SandcasterConfig | null;
	createApp: (deps: AppDeps) => Hono;
	startServer: (app: Hono, options: { port: number; hostname: string }) => void;
	stdout: { write: (data: string) => boolean };
	exit: (code: number) => void;
}

// ---------------------------------------------------------------------------
// Core logic (injectable for testing)
// ---------------------------------------------------------------------------

export async function executeServe(
	args: ServeArgs,
	deps: ServeDeps,
): Promise<void> {
	const _config = deps.loadConfig();

	const apiKey = process.env.SANDCASTER_API_KEY;
	const webhookSecret =
		process.env.SANDCASTER_WEBHOOK_SECRET ??
		process.env.SANDSTORM_WEBHOOK_SECRET;
	const corsOriginsRaw = process.env.SANDCASTER_CORS_ORIGINS;
	const corsOrigins = corsOriginsRaw ? corsOriginsRaw.split(",") : undefined;

	// version from package.json or fallback
	let version = "0.0.0";
	try {
		const { createRequire } = await import("node:module");
		const require = createRequire(import.meta.url);
		const pkg = require("../../package.json") as { version?: string };
		version = pkg.version ?? "0.0.0";
	} catch {
		// ignore — fallback to "0.0.0"
	}

	const app = deps.createApp({
		apiKey,
		webhookSecret,
		corsOrigins,
		version,
	});

	deps.startServer(app, { port: args.port, hostname: args.host });
	deps.stdout.write(
		`Sandcaster API listening on http://${args.host}:${args.port}\n`,
	);
}

// ---------------------------------------------------------------------------
// Production deps
// ---------------------------------------------------------------------------

function startServerProd(
	app: Hono,
	options: { port: number; hostname: string },
): void {
	serve({ fetch: app.fetch, port: options.port, hostname: options.hostname });
}

const prodDeps: ServeDeps = {
	loadConfig: coreLoadConfig,
	createApp: apiCreateApp,
	startServer: startServerProd,
	stdout: process.stdout,
	exit: (code: number) => process.exit(code),
};

// ---------------------------------------------------------------------------
// citty command definition
// ---------------------------------------------------------------------------

export const serveCommand = defineCommand({
	meta: {
		name: "serve",
		description: "Start the Sandcaster API server",
	},
	args: {
		port: {
			type: "string",
			alias: "p",
			description: "Port to listen on",
			default: "8000",
		},
		host: {
			type: "string",
			alias: "h",
			description: "Host to bind to",
			default: "0.0.0.0",
		},
	},
	async run({ args }) {
		const port = Number(args.port);
		if (!Number.isFinite(port) || port < 1 || port > 65535) {
			console.error(`Invalid --port value: ${args.port}`);
			process.exit(1);
		}

		await executeServe({ port, host: args.host as string }, prodDeps);
	},
});
