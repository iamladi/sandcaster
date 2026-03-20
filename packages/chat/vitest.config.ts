import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "chat",
		exclude: ["**/dist/**", "**/node_modules/**"],
	},
});
