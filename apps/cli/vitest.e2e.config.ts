import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "cli-e2e",
		include: ["src/__tests__/e2e/**/*.e2e.test.ts"],
		testTimeout: 30_000,
		hookTimeout: 15_000,
	},
});
