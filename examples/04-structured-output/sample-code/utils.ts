// TODO: replace with a proper date library (dayjs or date-fns)
export function formatDate(date: Date): string {
	return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

// TODO: add retry logic for transient failures
export async function fetchWithTimeout(url: string, timeoutMs: number = 5000) {
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		return response;
	} finally {
		clearTimeout(id);
	}
}

// TODO: memoize this function for repeated calls with same input
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "");
}
