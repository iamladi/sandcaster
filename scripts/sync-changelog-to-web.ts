/**
 * Generates per-version markdown files for the website changelog
 * from changesets/action publishedPackages output.
 *
 * Usage: PUBLISHED_PACKAGES='<json>' bun run scripts/sync-changelog-to-web.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface PublishedPackage {
	name: string;
	version: string;
}

const scriptDir =
	import.meta.dirname ?? dirname(import.meta.url.replace("file://", ""));
const changelogDir = resolve(scriptDir, "../apps/web/src/content/changelog");

function slugFromPackageName(name: string): string {
	return name.replace(/^@sandcaster\//, "");
}

function extractLatestVersionSection(
	changelogPath: string,
	version: string,
): string {
	if (!existsSync(changelogPath)) return "";

	const content = readFileSync(changelogPath, "utf-8");
	const versionHeader = `## ${version}`;
	const startIdx = content.indexOf(versionHeader);
	if (startIdx === -1) return "";

	const afterHeader = startIdx + versionHeader.length;
	const nextHeaderIdx = content.indexOf("\n## ", afterHeader);
	const section =
		nextHeaderIdx === -1
			? content.slice(afterHeader)
			: content.slice(afterHeader, nextHeaderIdx);

	return section.trim();
}

const knownPackages: Record<string, string> = {
	"@sandcaster/sdk": "packages/sdk",
	"@sandcaster/cli": "apps/cli",
};

function main() {
	const input = (process.env.PUBLISHED_PACKAGES ?? process.argv[2])?.trim();

	if (!input) {
		console.log("No published packages input received, skipping.");
		return;
	}

	let packages: PublishedPackage[];
	try {
		packages = JSON.parse(input) as PublishedPackage[];
	} catch (e) {
		console.error("Failed to parse publishedPackages JSON:", e);
		process.exit(1);
	}

	if (!Array.isArray(packages) || packages.length === 0) {
		console.log("No packages published, skipping changelog sync.");
		return;
	}

	mkdirSync(changelogDir, { recursive: true });

	const today = new Date().toISOString().split("T")[0];

	for (const pkg of packages) {
		const pkgDir = knownPackages[pkg.name];
		if (!pkgDir) {
			console.warn(`Unknown package "${pkg.name}", skipping changelog sync.`);
			continue;
		}

		const slug = slugFromPackageName(pkg.name);
		const filename = `${slug}-v${pkg.version}.md`;
		const outputPath = resolve(changelogDir, filename);
		const changelogPath = resolve(scriptDir, "..", pkgDir, "CHANGELOG.md");

		const changelogContent = extractLatestVersionSection(
			changelogPath,
			pkg.version,
		);

		const frontmatter = [
			"---",
			`version: "${pkg.version}"`,
			`date: ${today}`,
			`title: "${pkg.name} v${pkg.version}"`,
			"---",
		].join("\n");

		const body = changelogContent || `Release of ${pkg.name} v${pkg.version}.`;

		writeFileSync(outputPath, `${frontmatter}\n\n${body}\n`);
		console.log(`Generated ${filename}`);
	}
}

main();
