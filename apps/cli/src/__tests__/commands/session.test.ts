import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	executeSessionAttach,
	executeSessionDelete,
	executeSessionList,
} from "../../commands/session.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSSEBody(
	...events: Array<{ type: string; content: string }>
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(text));
			controller.close();
		},
	});
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;
let stdout: { write: ReturnType<typeof vi.fn>; output: string };

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
	stdout = {
		write: vi.fn((data: string) => {
			stdout.output += data;
			return true;
		}),
		output: "",
	};
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// executeSessionList
// ---------------------------------------------------------------------------

describe("executeSessionList", () => {
	it("shows sessions table when API returns sessions", async () => {
		const sessions = [
			{
				id: "abc123",
				status: "active",
				name: "my-session",
				createdAt: "2026-03-18T10:00:00Z",
				lastActivityAt: "2026-03-18T10:05:00Z",
				runsCount: 3,
				totalCostUsd: 0.0042,
			},
		];
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => sessions,
		});

		await executeSessionList({ baseUrl: "http://localhost:8000", stdout });

		expect(stdout.output).toContain("ID\tStatus\tName\tRuns\tCost\tCreated");
		expect(stdout.output).toContain("abc123");
		expect(stdout.output).toContain("active");
		expect(stdout.output).toContain("my-session");
		expect(stdout.output).toContain("3");
		expect(stdout.output).toContain("$0.0042");
	});

	it("shows 'No sessions found' when API returns empty array", async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => [],
		});

		await executeSessionList({ baseUrl: "http://localhost:8000", stdout });

		expect(stdout.output).toContain("No sessions found.");
	});

	it("shows error message when API returns error status", async () => {
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
		});

		await executeSessionList({ baseUrl: "http://localhost:8000", stdout });

		expect(stdout.output).toContain("Error: 500 Internal Server Error");
	});

	it("sends Authorization header when apiKey is provided", async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => [],
		});

		await executeSessionList({
			baseUrl: "http://localhost:8000",
			apiKey: "secret-key",
			stdout,
		});

		const [_url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((options.headers as Record<string, string>).Authorization).toBe(
			"Bearer secret-key",
		);
	});

	it("uses session name '-' when name is absent", async () => {
		const sessions = [
			{
				id: "xyz789",
				status: "idle",
				createdAt: "2026-03-18T09:00:00Z",
				lastActivityAt: "2026-03-18T09:01:00Z",
				runsCount: 0,
				totalCostUsd: 0,
			},
		];
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => sessions,
		});

		await executeSessionList({ baseUrl: "http://localhost:8000", stdout });

		expect(stdout.output).toContain("\t-\t");
	});
});

// ---------------------------------------------------------------------------
// executeSessionDelete
// ---------------------------------------------------------------------------

describe("executeSessionDelete", () => {
	it("sends DELETE request to the correct URL", async () => {
		fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

		await executeSessionDelete("session-1", {
			baseUrl: "http://localhost:8000",
			stdout,
		});

		const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://localhost:8000/sessions/session-1");
		expect(options.method).toBe("DELETE");
	});

	it("shows success message when API returns 204", async () => {
		fetchMock.mockResolvedValueOnce({ ok: true, status: 204 });

		await executeSessionDelete("session-1", {
			baseUrl: "http://localhost:8000",
			stdout,
		});

		expect(stdout.output).toContain("Session session-1 deleted.");
	});

	it("shows success message when API returns 200", async () => {
		fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

		await executeSessionDelete("session-2", {
			baseUrl: "http://localhost:8000",
			stdout,
		});

		expect(stdout.output).toContain("Session session-2 deleted.");
	});

	it("shows error message when API returns 404", async () => {
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 404,
			statusText: "Not Found",
		});

		await executeSessionDelete("missing-session", {
			baseUrl: "http://localhost:8000",
			stdout,
		});

		expect(stdout.output).toContain("Error: 404 Not Found");
	});

	it("sends Authorization header when apiKey is provided", async () => {
		fetchMock.mockResolvedValueOnce({ ok: true, status: 204 });

		await executeSessionDelete("session-1", {
			baseUrl: "http://localhost:8000",
			apiKey: "my-key",
			stdout,
		});

		const [_url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((options.headers as Record<string, string>).Authorization).toBe(
			"Bearer my-key",
		);
	});
});

// ---------------------------------------------------------------------------
// executeSessionAttach
// ---------------------------------------------------------------------------

describe("executeSessionAttach", () => {
	it("streams SSE events and writes formatted output", async () => {
		const body = createSSEBody(
			{ type: "assistant", content: "thinking..." },
			{ type: "result", content: "done" },
		);
		fetchMock.mockResolvedValueOnce({ ok: true, body });

		await executeSessionAttach("session-42", {
			baseUrl: "http://localhost:8000",
			stdout,
		});

		expect(stdout.output).toContain("[assistant] thinking...");
		expect(stdout.output).toContain("[result] done");
	});

	it("shows error message when API returns error status", async () => {
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 404,
			statusText: "Not Found",
		});

		await executeSessionAttach("missing-session", {
			baseUrl: "http://localhost:8000",
			stdout,
		});

		expect(stdout.output).toContain("Error: 404 Not Found");
	});

	it("sends Authorization header when apiKey is provided", async () => {
		const body = createSSEBody({ type: "result", content: "ok" });
		fetchMock.mockResolvedValueOnce({ ok: true, body });

		await executeSessionAttach("session-1", {
			baseUrl: "http://localhost:8000",
			apiKey: "attach-key",
			stdout,
		});

		const [_url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((options.headers as Record<string, string>).Authorization).toBe(
			"Bearer attach-key",
		);
	});

	it("shows message when response body is null", async () => {
		fetchMock.mockResolvedValueOnce({ ok: true, body: null });

		await executeSessionAttach("session-1", {
			baseUrl: "http://localhost:8000",
			stdout,
		});

		expect(stdout.output).toContain("No event stream available.");
	});

	it("fetches from the correct events URL", async () => {
		const body = createSSEBody({ type: "result", content: "ok" });
		fetchMock.mockResolvedValueOnce({ ok: true, body });

		await executeSessionAttach("session-99", {
			baseUrl: "http://localhost:8000",
			stdout,
		});

		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://localhost:8000/sessions/session-99/events");
	});
});
