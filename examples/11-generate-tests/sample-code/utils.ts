/**
 * Clamps a number between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
	if (min > max) throw new RangeError("min must be <= max");
	return Math.max(min, Math.min(max, value));
}

/**
 * Retries an async function up to `maxRetries` times with exponential backoff.
 */
export async function retry<T>(
	fn: () => Promise<T>,
	maxRetries: number = 3,
	baseDelayMs: number = 100,
): Promise<T> {
	let lastError: Error | undefined;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (attempt < maxRetries) {
				await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
			}
		}
	}
	throw lastError;
}

/**
 * Groups an array of items by a key function.
 */
export function groupBy<T>(
	items: T[],
	keyFn: (item: T) => string,
): Record<string, T[]> {
	const result: Record<string, T[]> = {};
	for (const item of items) {
		const key = keyFn(item);
		if (!result[key]) result[key] = [];
		result[key].push(item);
	}
	return result;
}

/**
 * Truncates a string to maxLength, appending "..." if truncated.
 */
export function truncate(str: string, maxLength: number): string {
	if (maxLength < 4) throw new RangeError("maxLength must be >= 4");
	if (str.length <= maxLength) return str;
	return `${str.slice(0, maxLength - 3)}...`;
}

/**
 * Debounce: returns a function that delays invoking fn until after wait ms
 * have elapsed since the last invocation.
 */
export function debounce<T extends (...args: any[]) => void>(
	fn: T,
	waitMs: number,
): T {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return ((...args: any[]) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), waitMs);
	}) as T;
}
