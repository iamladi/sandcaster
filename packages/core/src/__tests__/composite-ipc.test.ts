import { describe, expect, it } from "vitest";
import type { CompositeRequest, CompositeResponse } from "../composite-ipc.js";
import {
	generateNonce,
	ipcResponsePath,
	ipcTempPath,
	parseCompositeRequest,
	STALE_IPC_PATTERN,
	serializeCompositeResponse,
	validateNonce,
} from "../composite-ipc.js";

// ---------------------------------------------------------------------------
// parseCompositeRequest
// ---------------------------------------------------------------------------

describe("parseCompositeRequest", () => {
	it("returns null for empty string", () => {
		expect(parseCompositeRequest("")).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		expect(parseCompositeRequest("not-json")).toBeNull();
	});

	it("returns null for valid JSON that is not a composite_request", () => {
		const line = JSON.stringify({ type: "assistant", content: "hello" });
		expect(parseCompositeRequest(line)).toBeNull();
	});

	it("returns null for JSON missing type field", () => {
		const line = JSON.stringify({ action: "spawn", id: "abc", nonce: "xyz" });
		expect(parseCompositeRequest(line)).toBeNull();
	});

	it("parses a valid composite_request line with action spawn", () => {
		const req: CompositeRequest = {
			type: "composite_request",
			id: "req-001",
			nonce: "nonce-abc",
			action: "spawn",
			name: "worker",
			provider: "e2b",
			template: "my-template",
		};
		const result = parseCompositeRequest(JSON.stringify(req));
		expect(result).not.toBeNull();
		expect(result?.type).toBe("composite_request");
		expect(result?.action).toBe("spawn");
		expect(result?.id).toBe("req-001");
		expect(result?.nonce).toBe("nonce-abc");
		expect(result?.name).toBe("worker");
		expect(result?.provider).toBe("e2b");
		expect(result?.template).toBe("my-template");
	});

	it("parses a valid composite_request line with action exec", () => {
		const req: CompositeRequest = {
			type: "composite_request",
			id: "req-002",
			nonce: "nonce-xyz",
			action: "exec",
			name: "worker",
			command: "ls -la",
			timeout: 5000,
		};
		const result = parseCompositeRequest(JSON.stringify(req));
		expect(result).not.toBeNull();
		expect(result?.action).toBe("exec");
		expect(result?.command).toBe("ls -la");
		expect(result?.timeout).toBe(5000);
	});

	it("parses a valid composite_request line with action transfer", () => {
		const req: CompositeRequest = {
			type: "composite_request",
			id: "req-003",
			nonce: "nonce-xyz",
			action: "transfer",
			from: "worker",
			to: "primary",
			paths: ["output.txt", "data/results.json"],
		};
		const result = parseCompositeRequest(JSON.stringify(req));
		expect(result).not.toBeNull();
		expect(result?.action).toBe("transfer");
		expect(result?.from).toBe("worker");
		expect(result?.to).toBe("primary");
		expect(result?.paths).toEqual(["output.txt", "data/results.json"]);
	});

	it("parses a valid composite_request line with action kill", () => {
		const req: CompositeRequest = {
			type: "composite_request",
			id: "req-004",
			nonce: "nonce-xyz",
			action: "kill",
			name: "worker",
		};
		const result = parseCompositeRequest(JSON.stringify(req));
		expect(result).not.toBeNull();
		expect(result?.action).toBe("kill");
		expect(result?.name).toBe("worker");
	});

	it("parses a valid composite_request line with action list", () => {
		const req: CompositeRequest = {
			type: "composite_request",
			id: "req-005",
			nonce: "nonce-xyz",
			action: "list",
		};
		const result = parseCompositeRequest(JSON.stringify(req));
		expect(result).not.toBeNull();
		expect(result?.action).toBe("list");
	});
});

// ---------------------------------------------------------------------------
// serializeCompositeResponse
// ---------------------------------------------------------------------------

describe("serializeCompositeResponse", () => {
	it("serializes a successful response to JSON string", () => {
		const response: CompositeResponse = {
			type: "composite_response",
			id: "req-001",
			ok: true,
			workDir: "/home/user",
		};
		const serialized = serializeCompositeResponse(response);
		expect(typeof serialized).toBe("string");
		const parsed = JSON.parse(serialized);
		expect(parsed.type).toBe("composite_response");
		expect(parsed.id).toBe("req-001");
		expect(parsed.ok).toBe(true);
		expect(parsed.workDir).toBe("/home/user");
	});

	it("serializes an error response to JSON string", () => {
		const response: CompositeResponse = {
			type: "composite_response",
			id: "req-002",
			ok: false,
			error: "Sandbox not found",
		};
		const serialized = serializeCompositeResponse(response);
		const parsed = JSON.parse(serialized);
		expect(parsed.ok).toBe(false);
		expect(parsed.error).toBe("Sandbox not found");
	});

	it("serializes a response with result payload", () => {
		const response: CompositeResponse = {
			type: "composite_response",
			id: "req-003",
			ok: true,
			result: { stdout: "hello", stderr: "", exitCode: 0 },
		};
		const serialized = serializeCompositeResponse(response);
		const parsed = JSON.parse(serialized);
		expect(parsed.result).toEqual({ stdout: "hello", stderr: "", exitCode: 0 });
	});
});

// ---------------------------------------------------------------------------
// validateNonce
// ---------------------------------------------------------------------------

describe("validateNonce", () => {
	it("returns true when nonces match", () => {
		const req: CompositeRequest = {
			type: "composite_request",
			id: "req-001",
			nonce: "abc-123",
			action: "list",
		};
		expect(validateNonce(req, "abc-123")).toBe(true);
	});

	it("returns false when nonces do not match", () => {
		const req: CompositeRequest = {
			type: "composite_request",
			id: "req-001",
			nonce: "abc-123",
			action: "list",
		};
		expect(validateNonce(req, "xyz-999")).toBe(false);
	});

	it("returns false when request nonce is empty", () => {
		const req: CompositeRequest = {
			type: "composite_request",
			id: "req-001",
			nonce: "",
			action: "list",
		};
		expect(validateNonce(req, "abc-123")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// generateNonce
// ---------------------------------------------------------------------------

describe("generateNonce", () => {
	it("returns a non-empty string", () => {
		const nonce = generateNonce();
		expect(typeof nonce).toBe("string");
		expect(nonce.length).toBeGreaterThan(0);
	});

	it("returns unique values on each call", () => {
		const n1 = generateNonce();
		const n2 = generateNonce();
		expect(n1).not.toBe(n2);
	});
});

// ---------------------------------------------------------------------------
// ipcResponsePath
// ---------------------------------------------------------------------------

describe("ipcResponsePath", () => {
	it("returns the expected path for a given requestId", () => {
		expect(ipcResponsePath("abc-123")).toBe("/tmp/sandcaster-ipc-abc-123.json");
	});

	it("interpolates any string requestId", () => {
		expect(ipcResponsePath("req-999-xyz")).toBe(
			"/tmp/sandcaster-ipc-req-999-xyz.json",
		);
	});
});

// ---------------------------------------------------------------------------
// ipcTempPath
// ---------------------------------------------------------------------------

describe("ipcTempPath", () => {
	it("returns the expected temp path for a given requestId", () => {
		expect(ipcTempPath("abc-123")).toBe("/tmp/sandcaster-ipc-abc-123.json.tmp");
	});

	it("interpolates any string requestId", () => {
		expect(ipcTempPath("req-999-xyz")).toBe(
			"/tmp/sandcaster-ipc-req-999-xyz.json.tmp",
		);
	});
});

// ---------------------------------------------------------------------------
// STALE_IPC_PATTERN
// ---------------------------------------------------------------------------

describe("STALE_IPC_PATTERN", () => {
	it("matches a .json IPC file", () => {
		expect(STALE_IPC_PATTERN.test("/tmp/sandcaster-ipc-abc123.json")).toBe(
			true,
		);
	});

	it("matches a .json.tmp IPC file", () => {
		expect(STALE_IPC_PATTERN.test("/tmp/sandcaster-ipc-abc123.json.tmp")).toBe(
			true,
		);
	});

	it("does not match unrelated paths", () => {
		expect(STALE_IPC_PATTERN.test("/tmp/something-else.json")).toBe(false);
	});
});
