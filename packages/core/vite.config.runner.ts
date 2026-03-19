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
			// Only Node built-ins are external — pi-mono packages are inlined
			// so the runner is self-contained and works in any clean Node.js sandbox
			// (E2B, Vercel, Docker) without pre-installed dependencies.
			external: [/^node:/],
		},
	},
});
