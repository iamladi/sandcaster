import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "core",
		exclude: ["**/dist/**", "**/node_modules/**"],
	},
});
