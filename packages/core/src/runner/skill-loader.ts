import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SkillInfo {
	name: string;
	description: string;
	content: string;
	disableModelInvocation: boolean;
}

// ---------------------------------------------------------------------------
// loadSkills
// ---------------------------------------------------------------------------

/**
 * Scan a directory for skills, each skill in its own subdirectory with a SKILL.md.
 * Returns ALL skills (including disabled ones). Callers decide what to include
 * in the system prompt vs what to expose via a read_skill tool.
 */
export function loadSkills(skillsDir: string): SkillInfo[] {
	if (!existsSync(skillsDir)) {
		return [];
	}

	const entries = readdirSync(skillsDir);
	const skills: SkillInfo[] = [];

	for (const entry of entries) {
		const entryPath = join(skillsDir, entry);

		// Only consider subdirectories
		const stat = statSync(entryPath);
		if (!stat.isDirectory()) {
			continue;
		}

		const skillMdPath = join(entryPath, "SKILL.md");
		if (!existsSync(skillMdPath)) {
			continue;
		}

		const content = readFileSync(skillMdPath, "utf-8");
		const frontmatter = parseFrontmatter(content);

		const name =
			typeof frontmatter?.name === "string" && frontmatter.name.length > 0
				? frontmatter.name
				: entry;

		const description =
			typeof frontmatter?.description === "string"
				? frontmatter.description
				: "";

		const disableModelInvocation =
			frontmatter?.["disable-model-invocation"] === true;

		skills.push({ name, description, content, disableModelInvocation });
	}

	return skills;
}

// ---------------------------------------------------------------------------
// buildSkillsXml
// ---------------------------------------------------------------------------

/**
 * Build an XML block listing available skills for system prompt injection.
 * Only includes skills where disableModelInvocation === false.
 * Returns empty string when no skills are available to include.
 */
export function buildSkillsXml(skills: SkillInfo[]): string {
	const enabled = skills.filter((s) => !s.disableModelInvocation);
	if (enabled.length === 0) {
		return "";
	}

	const lines: string[] = ["<available_skills>"];

	for (const skill of enabled) {
		const body = extractBody(skill.content).trim();
		lines.push(
			`<skill name="${skill.name}" description="${skill.description}">${body}</skill>`,
		);
	}

	lines.push("</available_skills>");
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from the start of a markdown file.
 * Returns null if no frontmatter is present.
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
	if (!content.startsWith("---")) {
		return null;
	}

	// Find the closing ---
	const end = content.indexOf("\n---", 3);
	if (end === -1) {
		return null;
	}

	const yamlText = content.slice(3, end).trim();

	try {
		const parsed = parseYaml(yamlText);
		if (
			parsed !== null &&
			typeof parsed === "object" &&
			!Array.isArray(parsed)
		) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Extract the body of a markdown file — everything after the closing `---`
 * frontmatter delimiter. If there is no frontmatter, returns the full content.
 */
function extractBody(content: string): string {
	if (!content.startsWith("---")) {
		return content;
	}

	const end = content.indexOf("\n---", 3);
	if (end === -1) {
		return content;
	}

	// Skip past the closing `---` line
	const afterDelimiter = end + 4; // length of "\n---"
	return content.slice(afterDelimiter);
}
