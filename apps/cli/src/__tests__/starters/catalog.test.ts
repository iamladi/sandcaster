import { describe, expect, it } from "vitest";
import type { StarterDefinition } from "../../starters/catalog.js";
import {
	ENV_EXAMPLE,
	listStarters,
	resolveStarter,
} from "../../starters/catalog.js";

describe("listStarters", () => {
	it("returns exactly 6 starters", () => {
		expect(listStarters()).toHaveLength(6);
	});

	it("returns starters in expected order", () => {
		const slugs = listStarters().map((s) => s.slug);
		expect(slugs).toEqual([
			"general-assistant",
			"research-brief",
			"document-analyst",
			"support-triage",
			"api-extractor",
			"security-audit",
		]);
	});

	it("each starter has required string fields", () => {
		for (const starter of listStarters()) {
			expect(typeof starter.slug).toBe("string");
			expect(starter.slug.length).toBeGreaterThan(0);
			expect(typeof starter.title).toBe("string");
			expect(starter.title.length).toBeGreaterThan(0);
			expect(typeof starter.description).toBe("string");
			expect(starter.description.length).toBeGreaterThan(0);
			expect(typeof starter.nextStepCommand).toBe("string");
			expect(starter.nextStepCommand.length).toBeGreaterThan(0);
			expect(typeof starter.readme).toBe("string");
			expect(starter.readme.length).toBeGreaterThan(0);
		}
	});

	it("each starter has a valid configJson with required fields", () => {
		for (const starter of listStarters()) {
			expect(typeof starter.configJson).toBe("object");
			expect(typeof starter.configJson.systemPrompt).toBe("string");
			expect(
				(starter.configJson.systemPrompt as string).length,
			).toBeGreaterThan(0);
			expect(typeof starter.configJson.model).toBe("string");
			expect(typeof starter.configJson.maxTurns).toBe("number");
		}
	});

	it("each starter has an aliases array", () => {
		for (const starter of listStarters()) {
			expect(Array.isArray(starter.aliases)).toBe(true);
		}
	});

	it("configJson uses camelCase keys (not snake_case)", () => {
		for (const starter of listStarters()) {
			const keys = Object.keys(starter.configJson);
			for (const key of keys) {
				expect(key).not.toMatch(/_/);
			}
		}
	});
});

describe("resolveStarter", () => {
	it("resolves by exact slug", () => {
		const starter = resolveStarter("general-assistant");
		expect(starter.slug).toBe("general-assistant");
	});

	it("resolves research-brief by slug", () => {
		const starter = resolveStarter("research-brief");
		expect(starter.slug).toBe("research-brief");
	});

	it("resolves all 6 starters by slug", () => {
		const slugs = [
			"general-assistant",
			"research-brief",
			"document-analyst",
			"support-triage",
			"api-extractor",
			"security-audit",
		];
		for (const slug of slugs) {
			expect(resolveStarter(slug).slug).toBe(slug);
		}
	});

	it("resolves research-brief by alias competitive-analysis", () => {
		const starter = resolveStarter("competitive-analysis");
		expect(starter.slug).toBe("research-brief");
	});

	it("resolves support-triage by alias issue-triage", () => {
		const starter = resolveStarter("issue-triage");
		expect(starter.slug).toBe("support-triage");
	});

	it("resolves api-extractor by alias docs-to-openapi", () => {
		const starter = resolveStarter("docs-to-openapi");
		expect(starter.slug).toBe("api-extractor");
	});

	it("throws for unknown starter name", () => {
		expect(() => resolveStarter("not-a-real-starter")).toThrow();
	});

	it("throws with informative message for unknown starter", () => {
		expect(() => resolveStarter("bogus")).toThrowError(/bogus/);
	});
});

describe("specific starter configs", () => {
	it("general-assistant has templateSkills: true", () => {
		const starter = resolveStarter("general-assistant");
		expect(starter.configJson.templateSkills).toBe(true);
	});

	it("research-brief has maxTurns: 20", () => {
		const starter = resolveStarter("research-brief");
		expect(starter.configJson.maxTurns).toBe(20);
	});

	it("research-brief has outputFormat", () => {
		const starter = resolveStarter("research-brief");
		expect(starter.configJson.outputFormat).toBeDefined();
	});

	it("support-triage has allowedTools", () => {
		const starter = resolveStarter("support-triage");
		expect(Array.isArray(starter.configJson.allowedTools)).toBe(true);
		expect(starter.configJson.allowedTools).toContain("Read");
	});

	it("security-audit has agents", () => {
		const starter = resolveStarter("security-audit");
		expect(starter.configJson.agents).toBeDefined();
		const agents = starter.configJson.agents as Record<string, unknown>;
		expect(agents["dependency-scanner"]).toBeDefined();
		expect(agents["code-scanner"]).toBeDefined();
		expect(agents["config-scanner"]).toBeDefined();
	});

	it("security-audit has extraFiles with OWASP skill", () => {
		const starter = resolveStarter("security-audit");
		expect(starter.extraFiles).toBeDefined();
		const extraFiles = starter.extraFiles as Record<string, string>;
		const hasOwaspSkill = Object.keys(extraFiles).some((k) =>
			k.includes("owasp"),
		);
		expect(hasOwaspSkill).toBe(true);
	});

	it("security-audit has skillsDir", () => {
		const starter = resolveStarter("security-audit");
		expect(starter.configJson.skillsDir).toBe(".claude/skills");
	});
});

describe("StarterDefinition interface", () => {
	it("type check: configJson accepts nested objects", () => {
		const starter: StarterDefinition = resolveStarter("security-audit");
		expect(typeof starter.configJson).toBe("object");
	});
});

describe("ENV_EXAMPLE", () => {
	it("contains ANTHROPIC_API_KEY", () => {
		expect(ENV_EXAMPLE).toContain("ANTHROPIC_API_KEY");
	});

	it("contains E2B_API_KEY", () => {
		expect(ENV_EXAMPLE).toContain("E2B_API_KEY");
	});
});
