import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "cloudflare-worker",
		exclude: ["**/dist/**", "**/node_modules/**"],
	},
});
