import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "pr-companion-gateway",
		exclude: ["**/dist/**", "**/node_modules/**"],
	},
});
