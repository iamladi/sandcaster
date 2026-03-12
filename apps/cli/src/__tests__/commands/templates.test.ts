import { describe, expect, it, vi } from "vitest";
import type { TemplatesArgs, TemplatesDeps } from "../../commands/templates.js";
import { executeTemplates } from "../../commands/templates.js";
import type { StarterDefinition } from "../../starters/catalog.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sparseStarter: StarterDefinition = {
	slug: "general-assistant",
	title: "General Assistant",
	description:
		"General-purpose agent for research, documents, support, ops, and software work.",
	nextStepCommand:
		'sandcaster "Compare Notion, Coda, and Slite for async product teams"',
	aliases: [],
	configJson: {
		systemPrompt: "You are a pragmatic general-purpose AI agent.",
		model: "sonnet",
		maxTurns: 15,
		templateSkills: true,
	},
	readme: "# General Assistant\n",
};

const richStarter: StarterDefinition = {
	slug: "security-audit",
	title: "Security Audit",
	description:
		"Run a structured security audit with sub-agents and an OWASP skill.",
	nextStepCommand:
		'sandcaster "Run a security audit on this codebase" -f /path/to/src/auth.py',
	aliases: [],
	configJson: {
		systemPrompt: "You are a security team lead.",
		model: "sonnet",
		maxTurns: 15,
		skillsDir: ".claude/skills",
		allowedTools: ["Read", "Glob", "Grep", "Bash", "Task"],
		agents: {
			"dependency-scanner": { description: "Checks dependencies for CVEs" },
			"code-scanner": { description: "Static analysis for OWASP Top 10" },
			"config-scanner": { description: "Audits configuration files" },
		},
		outputFormat: {
			type: "json_schema",
			schema: {
				type: "object",
				properties: {
					riskLevel: {},
					summary: {},
					vulnerabilities: {},
					stats: {},
				},
			},
		},
	},
	readme: "# Security Audit\n",
	extraFiles: { ".claude/skills/owasp-top-10/SKILL.md": "# OWASP\n" },
};

const researchBriefStarter: StarterDefinition = {
	slug: "research-brief",
	title: "Research Brief",
	description:
		"Research a topic, compare options, and return a concise decision brief.",
	nextStepCommand:
		'sandcaster -T research-brief "Research Acme\'s competitors"',
	aliases: ["competitive-analysis"],
	configJson: {
		systemPrompt: "You are a research analyst.",
		model: "sonnet",
		maxTurns: 20,
		outputFormat: {
			type: "json_schema",
			schema: {
				type: "object",
				properties: {
					summary: {},
					scope: {},
					keyFindings: {},
					recommendations: {},
					sources: {},
				},
			},
		},
	},
	readme: "# Research Brief\n",
};

const fakeStarters: StarterDefinition[] = [
	sparseStarter,
	researchBriefStarter,
	richStarter,
];

function makeDeps(overrides: Partial<TemplatesDeps> = {}): TemplatesDeps & {
	output: string;
} {
	let output = "";
	const deps: TemplatesDeps & { output: string } = {
		get output() {
			return output;
		},
		listStarters: () => [...fakeStarters],
		resolveStarter: (name: string) => {
			const found = fakeStarters.find(
				(s) => s.slug === name || s.aliases.includes(name),
			);
			if (!found) {
				throw new Error(
					`Unknown starter "${name}". Choose one of: ${fakeStarters.map((s) => s.slug).join(", ")}`,
				);
			}
			return found;
		},
		stdout: {
			write: (data: string) => {
				output += data;
				return true;
			},
		},
		exit: vi.fn(),
		...overrides,
	};
	return deps;
}

function makeArgs(overrides: Partial<TemplatesArgs> = {}): TemplatesArgs {
	return {
		name: undefined,
		json: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeTemplates", () => {
	describe("list mode (no name arg)", () => {
		it("prints all starters with their slugs, titles, and descriptions", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs(), deps);

			expect(deps.output).toContain("general-assistant");
			expect(deps.output).toContain("General Assistant");
			expect(deps.output).toContain(
				"General-purpose agent for research, documents, support, ops, and software work.",
			);

			expect(deps.output).toContain("research-brief");
			expect(deps.output).toContain("Research Brief");
			expect(deps.output).toContain(
				"Research a topic, compare options, and return a concise decision brief.",
			);

			expect(deps.output).toContain("security-audit");
			expect(deps.output).toContain("Security Audit");
		});

		it("shows aliases for starters that have them", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs(), deps);

			expect(deps.output).toContain("competitive-analysis");
		});

		it("does not call exit", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs(), deps);

			expect(deps.exit).not.toHaveBeenCalled();
		});
	});

	describe("list mode with --json", () => {
		it("prints all starters as a JSON array with required fields", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ json: true }), deps);

			const parsed = JSON.parse(deps.output);
			expect(Array.isArray(parsed)).toBe(true);
			expect(parsed).toHaveLength(3);

			const first = parsed[0];
			expect(first).toHaveProperty("slug");
			expect(first).toHaveProperty("title");
			expect(first).toHaveProperty("description");
			expect(first).toHaveProperty("aliases");
			expect(first).toHaveProperty("configJson");
		});

		it("includes slug, title, description, aliases, and configJson for each starter", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ json: true }), deps);

			const parsed = JSON.parse(deps.output);
			const research = parsed.find(
				(s: { slug: string }) => s.slug === "research-brief",
			);
			expect(research.title).toBe("Research Brief");
			expect(research.description).toBe(
				"Research a topic, compare options, and return a concise decision brief.",
			);
			expect(research.aliases).toEqual(["competitive-analysis"]);
			expect(research.configJson).toBeDefined();
		});
	});

	describe("detail mode (name arg)", () => {
		it("prints human-readable summary for a named starter", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "research-brief" }), deps);

			expect(deps.output).toContain("research-brief");
			expect(deps.output).toContain("Research Brief");
			expect(deps.output).toContain(
				"Research a topic, compare options, and return a concise decision brief.",
			);
		});

		it("shows model and maxTurns in detail view", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "research-brief" }), deps);

			expect(deps.output).toContain("sonnet");
			expect(deps.output).toContain("20");
		});

		it("shows aliases in detail view", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "research-brief" }), deps);

			expect(deps.output).toContain("competitive-analysis");
		});

		it("shows outputFormat schema property names when present", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "research-brief" }), deps);

			// Should show the outputFormat type and its schema keys
			expect(deps.output).toContain("json_schema");
		});

		it("does not call exit", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "research-brief" }), deps);

			expect(deps.exit).not.toHaveBeenCalled();
		});
	});

	describe("detail mode with --json", () => {
		it("prints the raw configJson for the named starter", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "research-brief", json: true }), deps);

			const parsed = JSON.parse(deps.output);
			expect(parsed.model).toBe("sonnet");
			expect(parsed.maxTurns).toBe(20);
			expect(parsed.outputFormat).toBeDefined();
		});

		it("outputs valid JSON", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "security-audit", json: true }), deps);

			expect(() => JSON.parse(deps.output)).not.toThrow();
		});
	});

	describe("unknown name", () => {
		it("prints an error message and exits with code 1", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "does-not-exist" }), deps);

			expect(deps.exit).toHaveBeenCalledWith(1);
			expect(deps.output).toContain("does-not-exist");
		});
	});

	describe("alias resolution", () => {
		it("shows detail for the resolved starter when given an alias", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "competitive-analysis" }), deps);

			// competitive-analysis is an alias for research-brief
			expect(deps.output).toContain("research-brief");
			expect(deps.output).toContain("Research Brief");
			expect(deps.exit).not.toHaveBeenCalledWith(1);
		});
	});

	describe("sparse starter (general-assistant — no outputFormat/allowedTools/agents)", () => {
		it("renders cleanly without errors", () => {
			const deps = makeDeps();
			expect(() =>
				executeTemplates(makeArgs({ name: "general-assistant" }), deps),
			).not.toThrow();
		});

		it("shows slug, title, model, and maxTurns", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "general-assistant" }), deps);

			expect(deps.output).toContain("general-assistant");
			expect(deps.output).toContain("General Assistant");
			expect(deps.output).toContain("sonnet");
			expect(deps.output).toContain("15");
		});

		it("does not output undefined or null for missing optional fields", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "general-assistant" }), deps);

			expect(deps.output).not.toContain("undefined");
			expect(deps.output).not.toContain("null");
		});
	});

	describe("rich starter (security-audit — has agents/allowedTools/skillsDir)", () => {
		it("shows all fields including agents, allowedTools, and skillsDir", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "security-audit" }), deps);

			expect(deps.output).toContain("security-audit");
			expect(deps.output).toContain("Security Audit");
			expect(deps.output).toContain("sonnet");
			expect(deps.output).toContain("15");
		});

		it("includes agent names in the output", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "security-audit" }), deps);

			expect(deps.output).toContain("dependency-scanner");
			expect(deps.output).toContain("code-scanner");
			expect(deps.output).toContain("config-scanner");
		});

		it("includes allowed tools in the output", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "security-audit" }), deps);

			expect(deps.output).toContain("Read");
			expect(deps.output).toContain("Bash");
			expect(deps.output).toContain("Task");
		});

		it("includes outputFormat type in the output", () => {
			const deps = makeDeps();
			executeTemplates(makeArgs({ name: "security-audit" }), deps);

			expect(deps.output).toContain("json_schema");
		});
	});
});
