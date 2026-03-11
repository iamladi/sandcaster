import { afterEach, beforeEach, describe, expect, it } from "vitest";

// We import the module functions. Because initTelemetry uses dynamic imports
// for OTel, we can test the no-op/disabled path without OTel installed.
import {
	getTracer,
	initTelemetry,
	NoOpSpan,
	NoOpTracer,
	recordAgentExecution,
	recordError,
	recordQueueDrop,
	recordRequest,
	recordRequestDuration,
	recordSandboxCreation,
	recordWebhookEvent,
	sandboxStarted,
	sandboxStopped,
} from "../telemetry.js";

describe("telemetry (disabled)", () => {
	beforeEach(() => {
		// Ensure env var is not set
		delete process.env.SANDCASTER_TELEMETRY;
	});

	afterEach(() => {
		delete process.env.SANDCASTER_TELEMETRY;
	});

	describe("initTelemetry", () => {
		it("is a no-op when SANDCASTER_TELEMETRY is unset", () => {
			expect(() => initTelemetry()).not.toThrow();
		});

		it("is a no-op when SANDCASTER_TELEMETRY is '0'", () => {
			process.env.SANDCASTER_TELEMETRY = "0";
			expect(() => initTelemetry()).not.toThrow();
		});

		it("is a no-op when SANDCASTER_TELEMETRY is empty string", () => {
			process.env.SANDCASTER_TELEMETRY = "";
			expect(() => initTelemetry()).not.toThrow();
		});
	});

	describe("record helpers are no-ops when disabled", () => {
		it("recordRequest does not throw", () => {
			expect(() => recordRequest()).not.toThrow();
			expect(() =>
				recordRequest({ model: "gpt-4", status: "ok" }),
			).not.toThrow();
		});

		it("recordRequestDuration does not throw", () => {
			expect(() => recordRequestDuration(1.5)).not.toThrow();
			expect(() =>
				recordRequestDuration(1.5, { model: "gpt-4" }),
			).not.toThrow();
		});

		it("recordSandboxCreation does not throw", () => {
			expect(() => recordSandboxCreation(2.0)).not.toThrow();
			expect(() =>
				recordSandboxCreation(2.0, { template: "base" }),
			).not.toThrow();
		});

		it("recordAgentExecution does not throw", () => {
			expect(() => recordAgentExecution(5.0)).not.toThrow();
			expect(() =>
				recordAgentExecution(5.0, { model: "claude-3" }),
			).not.toThrow();
		});

		it("sandboxStarted does not throw", () => {
			expect(() => sandboxStarted()).not.toThrow();
		});

		it("sandboxStopped does not throw", () => {
			expect(() => sandboxStopped()).not.toThrow();
		});

		it("recordError does not throw", () => {
			expect(() => recordError()).not.toThrow();
			expect(() => recordError({ errorType: "timeout" })).not.toThrow();
		});

		it("recordQueueDrop does not throw", () => {
			expect(() => recordQueueDrop()).not.toThrow();
		});

		it("recordWebhookEvent does not throw", () => {
			expect(() => recordWebhookEvent()).not.toThrow();
			expect(() =>
				recordWebhookEvent({ eventType: "sandbox.started" }),
			).not.toThrow();
		});
	});

	describe("getTracer", () => {
		it("returns a NoOpTracer when disabled", () => {
			const tracer = getTracer();
			expect(tracer).toBeInstanceOf(NoOpTracer);
		});
	});
});

describe("NoOpTracer", () => {
	it("startAsCurrentSpan yields a NoOpSpan", () => {
		const tracer = new NoOpTracer();
		let span: unknown;
		tracer.startAsCurrentSpan("test-span", (s) => {
			span = s;
		});
		expect(span).toBeInstanceOf(NoOpSpan);
	});

	it("startAsCurrentSpan returns the callback return value", () => {
		const tracer = new NoOpTracer();
		const result = tracer.startAsCurrentSpan("test-span", () => 42);
		expect(result).toBe(42);
	});
});

describe("NoOpSpan", () => {
	let span: NoOpSpan;

	beforeEach(() => {
		span = new NoOpSpan();
	});

	it("isRecording returns false", () => {
		expect(span.isRecording()).toBe(false);
	});

	it("setAttribute does not throw", () => {
		expect(() => span.setAttribute("key", "value")).not.toThrow();
	});

	it("setStatus does not throw", () => {
		expect(() => span.setStatus("ERROR", "something failed")).not.toThrow();
	});

	it("recordException does not throw", () => {
		expect(() => span.recordException(new Error("boom"))).not.toThrow();
	});
});
