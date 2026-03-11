import { defaultBuildLogger, Template } from "e2b";

const TEMPLATE_ALIAS = "sandcaster-v1";

const apiKey = process.env.E2B_API_KEY;
if (!apiKey) {
	console.error(
		"Error: E2B_API_KEY not set.\n" +
			"Set it in .env or export E2B_API_KEY=your-key-here.",
	);
	process.exit(1);
}

const template = Template()
	.fromNodeImage("24")
	.runCmd(
		"mkdir -p /opt/sandcaster" +
			" && cd /opt/sandcaster" +
			" && npm init -y" +
			" && npm install @mariozechner/pi-ai@0.57.1 @mariozechner/pi-agent-core@0.57.1 @sinclair/typebox@0.34.48" +
			" && chown -R user:user /opt/sandcaster",
		{ user: "root" },
	);

console.log(`Building template '${TEMPLATE_ALIAS}'...`);
console.log("This may take a few minutes on first build.\n");

try {
	await Template.build(template, {
		alias: TEMPLATE_ALIAS,
		cpuCount: 2,
		memoryMB: 2048,
		onBuildLogs: defaultBuildLogger(),
		apiKey,
	});

	console.log(`\nTemplate '${TEMPLATE_ALIAS}' built successfully!`);
	console.log(`Use it with: Sandbox.create('${TEMPLATE_ALIAS}', { apiKey })`);
} catch (error) {
	console.error("\nTemplate build failed:", error);
	console.error(
		"\nTroubleshooting:\n" +
			"  - Verify your E2B_API_KEY is valid\n" +
			"  - Check https://e2b.dev/dashboard for account status\n" +
			"  - Ensure you have template creation permissions",
	);
	process.exit(1);
}
