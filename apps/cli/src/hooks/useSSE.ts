import type { SandcasterEvent } from "@sandcaster/core";
import { SandcasterClient } from "@sandcaster/sdk";
import { useEffect, useMemo, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseSSEOptions {
	baseUrl: string;
	apiKey?: string;
	prompt: string;
	model?: string;
	timeout?: number;
	maxTurns?: number;
	files?: Record<string, string>;
	provider?: string;
}

export interface SandcasterClientLike {
	query(request: {
		prompt: string;
		model?: string;
		timeout?: number;
		maxTurns?: number;
		files?: Record<string, string>;
		provider?: string;
	}): AsyncIterable<SandcasterEvent>;
	[Symbol.asyncDispose](): Promise<void>;
}

// ---------------------------------------------------------------------------
// Default factory
// ---------------------------------------------------------------------------

function defaultCreateClient(opts: {
	baseUrl: string;
	apiKey?: string;
}): SandcasterClientLike {
	return new SandcasterClient(opts);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSSE(
	options: UseSSEOptions | null,
	createClient: (opts: {
		baseUrl: string;
		apiKey?: string;
	}) => SandcasterClientLike = defaultCreateClient,
): AsyncIterable<SandcasterEvent> | null {
	// Extract stable primitives so the useMemo deps don't include the options object
	const baseUrl = options?.baseUrl ?? null;
	const apiKey = options?.apiKey ?? null;
	const prompt = options?.prompt ?? null;
	const model = options?.model ?? null;
	const timeout = options?.timeout ?? null;
	const maxTurns = options?.maxTurns ?? null;
	const files = options?.files ?? null;
	const provider = options?.provider ?? null;

	// Stable ref for createClient so it doesn't trigger re-memoization
	const createClientRef = useRef(createClient);
	createClientRef.current = createClient;

	// Memoize client on baseUrl + apiKey only
	const client = useMemo<SandcasterClientLike | null>(() => {
		if (baseUrl === null) return null;
		return createClientRef.current({ baseUrl, apiKey: apiKey ?? undefined });
	}, [baseUrl, apiKey]);

	// Track current client in a ref so the cleanup effect always has the latest
	const clientRef = useRef<SandcasterClientLike | null>(null);
	clientRef.current = client;

	// Dispose client on unmount
	useEffect(() => {
		return () => {
			if (clientRef.current) {
				clientRef.current[Symbol.asyncDispose]().catch(() => {});
			}
		};
	}, []);

	// Serialize files for stable dependency comparison (objects use Object.is)
	const filesKey = files ? JSON.stringify(files) : null;

	// Memoize the query iterable on all query params
	const iterable = useMemo<AsyncIterable<SandcasterEvent> | null>(() => {
		if (prompt === null || !client) return null;
		const parsedFiles = filesKey
			? (JSON.parse(filesKey) as Record<string, string>)
			: undefined;
		return client.query({
			prompt,
			model: model ?? undefined,
			timeout: timeout ?? undefined,
			maxTurns: maxTurns ?? undefined,
			files: parsedFiles,
			provider: provider ?? undefined,
		});
	}, [client, prompt, model, timeout, maxTurns, filesKey, provider]);

	return iterable;
}
