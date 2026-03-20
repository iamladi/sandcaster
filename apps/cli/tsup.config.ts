import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	target: "node20",
	outDir: "dist",
	clean: true,
	noExternal: [/^@sandcaster\/.*/],
	external: [
		/^node:/,
		/^[a-zA-Z]/, // bare specifiers (npm packages, node builtins)
		/^@(?!sandcaster\/)/, // scoped packages except @sandcaster
	],
	banner: { js: "#!/usr/bin/env node" },
	shims: true,
	splitting: false,
	sourcemap: true,
});
