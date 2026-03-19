import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SandcasterConfigSchema } from "../schemas.js";

// Resolve examples directory relative to this test file
// Test file: packages/core/src/__tests__/examples-schema.test.ts
// Examples:  examples/*/sandcaster.json
const EXAMPLES_DIR = resolve(import.meta.dirname, "../../../../examples");

function getExampleConfigs(): string[] {
	const entries = readdirSync(EXAMPLES_DIR);
	const configs: string[] = [];
	for (const entry of entries) {
		const configPath = join(EXAMPLES_DIR, entry, "sandcaster.json");
		try {
			statSync(configPath);
			configs.push(configPath);
		} catch {
			// skip directories without sandcaster.json
		}
	}
	return configs.sort();
}

describe("examples — sandcaster.json schema validation", () => {
	const configs = getExampleConfigs();

	it("finds at least 14 example configs", () => {
		expect(configs.length).toBeGreaterThanOrEqual(14);
	});

	for (const configPath of configs) {
		const exampleName = basename(dirname(configPath));

		it(`${exampleName}/sandcaster.json validates against SandcasterConfigSchema`, () => {
			const raw = readFileSync(configPath, "utf-8");
			const json = JSON.parse(raw);
			const result = SandcasterConfigSchema.safeParse(json);

			if (!result.success) {
				const issues = result.error.issues
					.map((i) => `  ${i.path.join(".")}: ${i.message}`)
					.join("\n");
				throw new Error(
					`${exampleName}/sandcaster.json failed validation:\n${issues}`,
				);
			}

			expect(result.success).toBe(true);
		});
	}
});
