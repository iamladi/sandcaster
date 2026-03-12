/** Parse a .env file string into key-value pairs, stripping surrounding quotes. */
export function parseEnvFile(content: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		const raw = trimmed.slice(eqIdx + 1).trim();
		const value = raw.replace(/^(['"])(.*)\1$/, "$2");
		result[key] = value;
	}
	return result;
}
