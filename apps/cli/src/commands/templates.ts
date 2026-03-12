import { defineCommand } from "citty";
import type { StarterDefinition } from "../starters/catalog.js";
import {
	listStarters as catalogListStarters,
	resolveStarter as catalogResolveStarter,
} from "../starters/catalog.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplatesArgs {
	name?: string;
	json: boolean;
}

export interface TemplatesDeps {
	listStarters: () => StarterDefinition[];
	resolveStarter: (name: string) => StarterDefinition;
	stdout: { write: (data: string) => boolean };
	exit: (code: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padRight(str: string, width: number): string {
	return str + " ".repeat(Math.max(0, width - str.length));
}

function formatList(starters: StarterDefinition[]): string {
	const slugWidth = Math.max(...starters.map((s) => s.slug.length)) + 4;
	const lines: string[] = [];

	for (const s of starters) {
		lines.push(`${padRight(s.slug, slugWidth)}${s.title}`);
		lines.push(`  ${s.description}`);
		if (s.aliases.length > 0) {
			lines.push(`  Aliases: ${s.aliases.join(", ")}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

function formatDetail(s: StarterDefinition): string {
	const cfg = s.configJson;
	const lines: string[] = [];

	lines.push(`${s.slug} — ${s.title}`);
	lines.push("");
	lines.push(`  ${s.description}`);
	lines.push("");

	if (cfg.model !== undefined) {
		lines.push(`  Model:       ${cfg.model}`);
	}
	if (cfg.maxTurns !== undefined) {
		lines.push(`  Max turns:   ${cfg.maxTurns}`);
	}

	const outputFormat = cfg.outputFormat as
		| { type?: string; schema?: { properties?: Record<string, unknown> } }
		| undefined;
	if (outputFormat !== undefined) {
		const schemaProps = outputFormat.schema?.properties;
		const propNames = schemaProps ? Object.keys(schemaProps) : [];
		if (propNames.length > 0) {
			lines.push(
				`  Output:      ${outputFormat.type} (${propNames.join(", ")})`,
			);
		} else {
			lines.push(`  Output:      ${outputFormat.type}`);
		}
	}

	const allowedTools = cfg.allowedTools as string[] | undefined;
	if (allowedTools !== undefined && allowedTools.length > 0) {
		lines.push(`  Tools:       ${allowedTools.join(", ")}`);
	}

	if (s.aliases.length > 0) {
		lines.push(`  Aliases:     ${s.aliases.join(", ")}`);
	}

	const agents = cfg.agents as Record<string, unknown> | undefined;
	if (agents !== undefined) {
		const agentNames = Object.keys(agents);
		if (agentNames.length > 0) {
			lines.push(`  Agents:      ${agentNames.join(", ")}`);
		}
	}

	lines.push("");
	lines.push("  Example:");
	lines.push(`    ${s.nextStepCommand}`);
	lines.push("");

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

export function executeTemplates(
	args: TemplatesArgs,
	deps: TemplatesDeps,
): void {
	if (args.name !== undefined) {
		// Detail mode
		let starter: StarterDefinition;
		try {
			starter = deps.resolveStarter(args.name);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			deps.stdout.write(`${msg}\n`);
			deps.exit(1);
			return;
		}

		if (args.json) {
			deps.stdout.write(JSON.stringify(starter.configJson, null, 2));
		} else {
			deps.stdout.write(formatDetail(starter));
		}
	} else {
		// List mode
		const starters = deps.listStarters();

		if (args.json) {
			const output = starters.map((s) => ({
				slug: s.slug,
				title: s.title,
				description: s.description,
				aliases: s.aliases,
				configJson: s.configJson,
			}));
			deps.stdout.write(JSON.stringify(output, null, 2));
		} else {
			deps.stdout.write(formatList(starters));
		}
	}
}

// ---------------------------------------------------------------------------
// Production deps
// ---------------------------------------------------------------------------

export const prodDeps: TemplatesDeps = {
	listStarters: catalogListStarters,
	resolveStarter: catalogResolveStarter,
	stdout: process.stdout,
	exit: (code: number) => process.exit(code),
};

// ---------------------------------------------------------------------------
// citty command definition
// ---------------------------------------------------------------------------

export const templatesCommand = defineCommand({
	meta: {
		name: "templates",
		description: "List and inspect available templates",
	},
	args: {
		name: {
			type: "positional",
			required: false,
			description: "Template name or alias",
		},
		json: {
			type: "boolean",
			description: "Output as JSON",
			default: false,
		},
	},
	run({ args }) {
		executeTemplates(
			{
				name: args.name as string | undefined,
				json: args.json as boolean,
			},
			prodDeps,
		);
	},
});
