import { defineConfig } from "vite";

export default defineConfig({
	build: {
		lib: {
			entry: "src/runner/runner.ts",
			formats: ["es"],
			fileName: () => "runner.mjs",
		},
		outDir: "dist/runner",
		emptyOutDir: false,
		minify: false,
		rollupOptions: {
			external: [
				"@mariozechner/pi-ai",
				"@mariozechner/pi-agent-core",
				"@sinclair/typebox",
				/^node:/,
			],
		},
	},
});
