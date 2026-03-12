import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSkillsXml, loadSkills } from "../../runner/skill-loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkillDir(base: string, name: string): string {
	const dir = join(base, name);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writeSkillMd(dir: string, content: string): void {
	writeFileSync(join(dir, "SKILL.md"), content, "utf-8");
}

// ---------------------------------------------------------------------------
// loadSkills
// ---------------------------------------------------------------------------

describe("loadSkills", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "sandcaster-skill-loader-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns empty array for non-existent directory", () => {
		const result = loadSkills(join(tmpDir, "does-not-exist"));
		expect(result).toEqual([]);
	});

	it("returns empty array for an empty directory", () => {
		const result = loadSkills(tmpDir);
		expect(result).toEqual([]);
	});

	it("skips subdirectories without SKILL.md", () => {
		mkdirSync(join(tmpDir, "no-skill-here"));
		const result = loadSkills(tmpDir);
		expect(result).toEqual([]);
	});

	it("returns a SkillInfo for a subdirectory with SKILL.md", () => {
		const skillDir = makeSkillDir(tmpDir, "my-skill");
		writeSkillMd(
			skillDir,
			`---\nname: my-skill\ndescription: Does something\n---\n\n# Body here`,
		);

		const result = loadSkills(tmpDir);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("my-skill");
	});

	it("uses directory name as fallback when frontmatter has no name field", () => {
		const skillDir = makeSkillDir(tmpDir, "fallback-skill");
		writeSkillMd(skillDir, `---\ndescription: No name field\n---\n\n# Body`);

		const result = loadSkills(tmpDir);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("fallback-skill");
	});

	it("reads description from frontmatter", () => {
		const skillDir = makeSkillDir(tmpDir, "described-skill");
		writeSkillMd(
			skillDir,
			`---\nname: described-skill\ndescription: Useful for searching\n---\n\n# Body`,
		);

		const result = loadSkills(tmpDir);
		expect(result[0].description).toBe("Useful for searching");
	});

	it("defaults description to empty string when not in frontmatter", () => {
		const skillDir = makeSkillDir(tmpDir, "nodesc-skill");
		writeSkillMd(skillDir, `---\nname: nodesc-skill\n---\n\n# Body`);

		const result = loadSkills(tmpDir);
		expect(result[0].description).toBe("");
	});

	it("handles missing frontmatter gracefully with all defaults", () => {
		const skillDir = makeSkillDir(tmpDir, "no-frontmatter");
		writeSkillMd(skillDir, `# Just a heading\n\nNo frontmatter at all.`);

		const result = loadSkills(tmpDir);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("no-frontmatter");
		expect(result[0].description).toBe("");
		expect(result[0].disableModelInvocation).toBe(false);
	});

	it("sets disableModelInvocation from frontmatter disable-model-invocation", () => {
		const skillDir = makeSkillDir(tmpDir, "disabled-skill");
		writeSkillMd(
			skillDir,
			`---\nname: disabled-skill\ndisable-model-invocation: true\n---\n\n# Body`,
		);

		const result = loadSkills(tmpDir);
		expect(result[0].disableModelInvocation).toBe(true);
	});

	it("defaults disableModelInvocation to false when not in frontmatter", () => {
		const skillDir = makeSkillDir(tmpDir, "enabled-skill");
		writeSkillMd(skillDir, `---\nname: enabled-skill\n---\n\n# Body`);

		const result = loadSkills(tmpDir);
		expect(result[0].disableModelInvocation).toBe(false);
	});

	it("includes full SKILL.md content (including frontmatter) in content field", () => {
		const raw = `---\nname: full-content\ndescription: Test\n---\n\n# Heading\n\nBody text.`;
		const skillDir = makeSkillDir(tmpDir, "full-content");
		writeSkillMd(skillDir, raw);

		const result = loadSkills(tmpDir);
		expect(result[0].content).toBe(raw);
	});

	it("returns ALL skills regardless of disableModelInvocation (caller decides)", () => {
		const enabledDir = makeSkillDir(tmpDir, "enabled");
		writeSkillMd(enabledDir, `---\nname: enabled\n---\n\n# Enabled skill`);

		const disabledDir = makeSkillDir(tmpDir, "disabled");
		writeSkillMd(
			disabledDir,
			`---\nname: disabled\ndisable-model-invocation: true\n---\n\n# Disabled skill`,
		);

		const result = loadSkills(tmpDir);
		expect(result).toHaveLength(2);
	});

	it("returns multiple skills from multiple subdirectories", () => {
		for (const name of ["alpha", "beta", "gamma"]) {
			const dir = makeSkillDir(tmpDir, name);
			writeSkillMd(
				dir,
				`---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}`,
			);
		}

		const result = loadSkills(tmpDir);
		expect(result).toHaveLength(3);
		const names = result.map((s) => s.name).sort();
		expect(names).toEqual(["alpha", "beta", "gamma"]);
	});
});

// ---------------------------------------------------------------------------
// buildSkillsXml
// ---------------------------------------------------------------------------

describe("buildSkillsXml", () => {
	it("returns empty string when skills array is empty", () => {
		expect(buildSkillsXml([])).toBe("");
	});

	it("returns empty string when all skills have disableModelInvocation true", () => {
		const result = buildSkillsXml([
			{
				name: "secret",
				description: "Hidden skill",
				content: "---\ndisable-model-invocation: true\n---\n\n# Secret",
				disableModelInvocation: true,
			},
		]);
		expect(result).toBe("");
	});

	it("produces valid XML wrapper with available_skills tags", () => {
		const result = buildSkillsXml([
			{
				name: "search",
				description: "Web search",
				content: "---\nname: search\n---\n\nUse /search to find information",
				disableModelInvocation: false,
			},
		]);
		expect(result).toMatch(/^<available_skills>/);
		expect(result).toMatch(/<\/available_skills>$/);
	});

	it("includes skill name attribute in skill tags", () => {
		const result = buildSkillsXml([
			{
				name: "calculator",
				description: "Math calculations",
				content: "---\nname: calculator\n---\n\nUse /calc for arithmetic",
				disableModelInvocation: false,
			},
		]);
		expect(result).toContain('name="calculator"');
	});

	it("includes skill description attribute in skill tags", () => {
		const result = buildSkillsXml([
			{
				name: "calculator",
				description: "Math calculations",
				content: "---\nname: calculator\n---\n\nUse /calc for arithmetic",
				disableModelInvocation: false,
			},
		]);
		expect(result).toContain('description="Math calculations"');
	});

	it("uses body after frontmatter (trimmed) as skill tag content", () => {
		const result = buildSkillsXml([
			{
				name: "search",
				description: "Web search",
				content: "---\nname: search\n---\n\nUse /search to find information",
				disableModelInvocation: false,
			},
		]);
		expect(result).toContain(">Use /search to find information</skill>");
	});

	it("excludes skills with disableModelInvocation but includes enabled ones", () => {
		const result = buildSkillsXml([
			{
				name: "visible",
				description: "Shown skill",
				content: "---\nname: visible\n---\n\nVisible body",
				disableModelInvocation: false,
			},
			{
				name: "hidden",
				description: "Hidden skill",
				content: "---\nname: hidden\n---\n\nHidden body",
				disableModelInvocation: true,
			},
		]);
		expect(result).toContain('name="visible"');
		expect(result).not.toContain('name="hidden"');
	});

	it("includes multiple enabled skills", () => {
		const result = buildSkillsXml([
			{
				name: "search",
				description: "Web search",
				content: "---\nname: search\n---\n\nSearch body",
				disableModelInvocation: false,
			},
			{
				name: "calculator",
				description: "Math",
				content: "---\nname: calculator\n---\n\nCalc body",
				disableModelInvocation: false,
			},
		]);
		expect(result).toContain('name="search"');
		expect(result).toContain('name="calculator"');
	});

	it("uses body trimmed from content for skills without frontmatter", () => {
		const result = buildSkillsXml([
			{
				name: "plain",
				description: "No frontmatter",
				content: "# Plain skill\n\nJust body content.",
				disableModelInvocation: false,
			},
		]);
		expect(result).toContain("># Plain skill");
	});

	it("handles special XML characters in content by including them as-is", () => {
		const result = buildSkillsXml([
			{
				name: "xml-skill",
				description: "Has XML chars",
				content: "---\nname: xml-skill\n---\n\nUse <tag> & 'quotes'",
				disableModelInvocation: false,
			},
		]);
		// The body content is placed inside the skill tag
		expect(result).toContain("<tag>");
		expect(result).toContain("&");
	});
});
