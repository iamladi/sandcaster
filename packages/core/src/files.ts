import posix from "node:path/posix";
import type { Sandbox } from "e2b";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOME = "/home/user";
const SKILLS_BASE = `${HOME}/.pi/skills`;
const MAX_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Shell-quote a string by wrapping in single quotes, escaping embedded quotes.
 */
function shellQuote(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Validate that a relative path contains no traversal or absolute references.
 * Returns the normalized POSIX path, or throws on violation.
 */
function validateRelativePath(raw: string): string {
	if (
		raw.startsWith("/") ||
		raw.startsWith("\\") ||
		/^[a-zA-Z]:[\\/]/.test(raw)
	) {
		throw new Error(`Absolute paths are not allowed: ${raw}`);
	}

	const parts = raw.replace(/\\/g, "/").split("/");
	const stack: string[] = [];

	for (const part of parts) {
		if (part === "" || part === ".") {
			// skip
		} else if (part === "..") {
			if (stack.length === 0) {
				throw new Error(`Path traversal not allowed: ${raw}`);
			}
			stack.pop();
		} else {
			stack.push(part);
		}
	}

	const normalized = stack.join("/");
	if (!normalized) {
		throw new Error(`Invalid path: ${raw}`);
	}
	return normalized;
}

// ---------------------------------------------------------------------------
// uploadFiles
// ---------------------------------------------------------------------------

/**
 * Upload user files to /home/user/ in the sandbox, creating parent dirs as needed.
 */
export async function uploadFiles(
	sbx: Sandbox,
	files: Record<string, string>,
): Promise<void> {
	// Validate and normalize all paths
	const normalized: Record<string, string> = {};
	for (const [path, content] of Object.entries(files)) {
		const safe = validateRelativePath(path);
		normalized[safe] = content;
	}

	// Collect unique parent directories that need creation (only for nested paths)
	const dirs = new Set<string>();
	for (const path of Object.keys(normalized)) {
		const dir = posix.dirname(path);
		if (dir && dir !== ".") {
			dirs.add(`${HOME}/${dir}`);
		}
	}

	// Run mkdir -p for all needed directories in one command (shell-quoted)
	if (dirs.size > 0) {
		const dirList = Array.from(dirs).map(shellQuote).join(" ");
		await sbx.commands.run(`mkdir -p ${dirList}`);
	}

	// Write each file individually
	await Promise.all(
		Object.entries(normalized).map(([path, content]) =>
			sbx.files.write(`${HOME}/${path}`, content),
		),
	);
}

// ---------------------------------------------------------------------------
// uploadSkills
// ---------------------------------------------------------------------------

/**
 * Upload skills to /home/user/.pi/skills/<name>/SKILL.md in the sandbox.
 */
export async function uploadSkills(
	sbx: Sandbox,
	skills: { name: string; content: string }[],
): Promise<void> {
	if (skills.length === 0) return;

	// Create all skill directories (shell-quoted)
	const dirs = skills
		.map((s) => shellQuote(`${SKILLS_BASE}/${s.name}`))
		.join(" ");
	await sbx.commands.run(`mkdir -p ${dirs}`);

	// Write all SKILL.md files
	await Promise.all(
		skills.map((s) =>
			sbx.files.write(`${SKILLS_BASE}/${s.name}/SKILL.md`, s.content),
		),
	);
}

// ---------------------------------------------------------------------------
// createExtractionMarker
// ---------------------------------------------------------------------------

/**
 * Create an extraction marker file for tracking new files.
 * Returns the marker path.
 */
export async function createExtractionMarker(
	sbx: Sandbox,
	requestId: string,
): Promise<string> {
	const markerPath = `/tmp/sandcaster-extract-${requestId}.marker`;
	await sbx.commands.run(`touch ${shellQuote(markerPath)}`);
	return markerPath;
}

// ---------------------------------------------------------------------------
// extractGeneratedFiles
// ---------------------------------------------------------------------------

/**
 * Extract new files created after the marker, returning file events.
 */
export async function extractGeneratedFiles(
	sbx: Sandbox,
	inputFileNames: Set<string>,
	_requestId: string,
	markerPath: string,
): Promise<Array<{ type: "file"; path: string; content: string }>> {
	try {
		// Find files newer than the marker, excluding dotfiles
		const findCmd = `find /home/user -path '*/.*' -prune -o -type f -cnewer ${shellQuote(markerPath)} -printf '%P\\t%s\\n'`;
		const { stdout } = await sbx.commands.run(findCmd);

		// Parse the find output into (relativePath, sizeBytes) pairs
		type FileEntry = { path: string; size: number };
		const entries: FileEntry[] = [];
		for (const line of stdout.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			const tab = trimmed.lastIndexOf("\t");
			if (tab === -1) continue;

			const relativePath = trimmed.slice(0, tab);
			const size = Number(trimmed.slice(tab + 1));

			// Filter: skip malformed size
			if (!Number.isFinite(size)) continue;

			// Filter: skip input files
			if (inputFileNames.has(relativePath)) continue;

			// Filter: skip dotfiles (paths starting with . or having /. segments)
			if (relativePath.startsWith(".") || relativePath.includes("/.")) continue;

			// Filter: skip files over 25MB
			if (size > MAX_FILE_BYTES) continue;

			entries.push({ path: relativePath, size });
		}

		// Cap at MAX_FILES
		const capped = entries.slice(0, MAX_FILES);

		// Read files, respecting 50MB total cap
		const results: Array<{ type: "file"; path: string; content: string }> = [];
		let totalBytes = 0;

		for (const entry of capped) {
			if (totalBytes + entry.size > MAX_TOTAL_BYTES) break;

			const content = await sbx.files.read(`${HOME}/${entry.path}`, {
				format: "text",
			});

			results.push({
				type: "file",
				path: entry.path,
				content:
					typeof content === "string"
						? content
						: Buffer.from(content).toString("base64"),
			});

			totalBytes += entry.size;
		}

		return results;
	} finally {
		// Always clean up the marker file
		await sbx.commands.run(`rm -f ${shellQuote(markerPath)}`);
	}
}
