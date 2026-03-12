// @vitest-environment jsdom
import type { SandcasterEvent } from "@sandcaster/core";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
	SandcasterClientLike,
	UseSSEOptions,
} from "../../hooks/useSSE.js";
import { useSSE } from "../../hooks/useSSE.js";

// ---------------------------------------------------------------------------
// Fake client factory
// ---------------------------------------------------------------------------

function makeFakeClient(
	events: SandcasterEvent[] = [],
): SandcasterClientLike & { disposed: boolean } {
	const client = {
		disposed: false,
		query(_request: unknown): AsyncIterable<SandcasterEvent> {
			async function* gen() {
				for (const event of events) {
					yield event;
				}
			}
			return gen();
		},
		[Symbol.asyncDispose](): Promise<void> {
			client.disposed = true;
			return Promise.resolve();
		},
	};
	return client;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSSE", () => {
	describe("null options", () => {
		it("returns null when options is null", () => {
			const createClient = vi.fn(() => makeFakeClient());
			const { result } = renderHook(() => useSSE(null, createClient));
			expect(result.current).toBeNull();
		});

		it("does not call createClient when options is null", () => {
			const createClient = vi.fn(() => makeFakeClient());
			renderHook(() => useSSE(null, createClient));
			expect(createClient).not.toHaveBeenCalled();
		});
	});

	describe("valid options", () => {
		it("returns an AsyncIterable when options are provided", () => {
			const createClient = vi.fn(() => makeFakeClient());
			const options: UseSSEOptions = {
				baseUrl: "http://localhost:3000",
				prompt: "hello",
			};
			const { result } = renderHook(() => useSSE(options, createClient));
			expect(result.current).not.toBeNull();
			expect(
				typeof (result.current as AsyncIterable<SandcasterEvent>)[
					Symbol.asyncIterator
				],
			).toBe("function");
		});

		it("calls createClient with baseUrl and apiKey", () => {
			const createClient = vi.fn(() => makeFakeClient());
			const options: UseSSEOptions = {
				baseUrl: "http://localhost:3000",
				apiKey: "sk-test",
				prompt: "hello",
			};
			renderHook(() => useSSE(options, createClient));
			expect(createClient).toHaveBeenCalledWith({
				baseUrl: "http://localhost:3000",
				apiKey: "sk-test",
			});
		});

		it("calls createClient with only baseUrl when no apiKey", () => {
			const createClient = vi.fn(() => makeFakeClient());
			const options: UseSSEOptions = {
				baseUrl: "http://localhost:3000",
				prompt: "hello",
			};
			renderHook(() => useSSE(options, createClient));
			expect(createClient).toHaveBeenCalledWith({
				baseUrl: "http://localhost:3000",
				apiKey: undefined,
			});
		});

		it("reuses the same client instance when baseUrl and apiKey don't change", () => {
			const createClient = vi.fn(() => makeFakeClient());
			const options: UseSSEOptions = {
				baseUrl: "http://localhost:3000",
				prompt: "hello",
			};
			const { rerender } = renderHook(
				(opts: UseSSEOptions) => useSSE(opts, createClient),
				{ initialProps: options },
			);
			rerender({ ...options, prompt: "world" });
			expect(createClient).toHaveBeenCalledTimes(1);
		});

		it("creates a new client when baseUrl changes", () => {
			const createClient = vi.fn(() => makeFakeClient());
			const { rerender } = renderHook(
				(opts: UseSSEOptions) => useSSE(opts, createClient),
				{
					initialProps: {
						baseUrl: "http://localhost:3000",
						prompt: "hello",
					} as UseSSEOptions,
				},
			);
			rerender({ baseUrl: "http://localhost:4000", prompt: "hello" });
			expect(createClient).toHaveBeenCalledTimes(2);
		});
	});

	describe("query iterable memoization", () => {
		it("returns the same iterable when options don't change", () => {
			const createClient = vi.fn(() => makeFakeClient());
			const options: UseSSEOptions = {
				baseUrl: "http://localhost:3000",
				prompt: "hello",
			};
			const { result, rerender } = renderHook(
				(opts: UseSSEOptions) => useSSE(opts, createClient),
				{ initialProps: options },
			);
			const first = result.current;
			rerender(options);
			expect(result.current).toBe(first);
		});

		it("returns a new iterable when prompt changes", () => {
			const createClient = vi.fn(() => makeFakeClient());
			const { result, rerender } = renderHook(
				(opts: UseSSEOptions) => useSSE(opts, createClient),
				{
					initialProps: {
						baseUrl: "http://localhost:3000",
						prompt: "hello",
					} as UseSSEOptions,
				},
			);
			const first = result.current;
			rerender({ baseUrl: "http://localhost:3000", prompt: "world" });
			expect(result.current).not.toBe(first);
		});
	});

	describe("cleanup", () => {
		it("disposes the client on unmount", async () => {
			let capturedClient:
				| (SandcasterClientLike & { disposed: boolean })
				| null = null;
			const createClient = vi.fn(() => {
				capturedClient = makeFakeClient();
				return capturedClient;
			});
			const options: UseSSEOptions = {
				baseUrl: "http://localhost:3000",
				prompt: "hello",
			};
			const { unmount } = renderHook(() => useSSE(options, createClient));
			unmount();
			// Give async dispose a tick to run
			await Promise.resolve();
			expect(capturedClient?.disposed).toBe(true);
		});
	});
});
