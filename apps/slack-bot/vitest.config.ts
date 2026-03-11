import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "slack-bot",
		passWithNoTests: true,
	},
});
