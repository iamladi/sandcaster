import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Create a temporary directory for test isolation.
 * Returns the path and a cleanup function.
 */
export function createTempDir(): { path: string; cleanup: () => void } {
	const path = mkdtempSync(join(tmpdir(), "sandcaster-e2e-"));
	return {
		path,
		cleanup: () => {
			rmSync(path, { recursive: true, force: true });
		},
	};
}
