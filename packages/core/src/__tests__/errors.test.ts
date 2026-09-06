import { describe, expect, it } from "vitest";
import { SandcasterError } from "../errors.js";
import { SandboxError } from "../sandbox.js";

describe("SandcasterError", () => {
	it("has correct name", () => {
		const err = new SandcasterError("something went wrong");
		expect(err.name).toBe("SandcasterError");
	});

	it("has correct message", () => {
		const err = new SandcasterError("something went wrong");
		expect(err.message).toBe("something went wrong");
	});

	it("has no code when omitted", () => {
		const err = new SandcasterError("something went wrong");
		expect(err.code).toBeUndefined();
	});

	it("accepts an optional code", () => {
		const err = new SandcasterError("something went wrong", "MY_CODE");
		expect(err.code).toBe("MY_CODE");
	});

	it("is instanceof Error", () => {
		const err = new SandcasterError("something went wrong");
		expect(err).toBeInstanceOf(Error);
	});
});

describe("SandboxError", () => {
	it("has correct name", () => {
		const err = new SandboxError("sandbox crashed", "create");
		expect(err.name).toBe("SandboxError");
	});

	it("has SANDBOX_ERROR code", () => {
		const err = new SandboxError("sandbox crashed", "create");
		expect(err.code).toBe("SANDBOX_ERROR");
	});

	it("is instanceof SandcasterError", () => {
		const err = new SandboxError("sandbox crashed", "exec");
		expect(err).toBeInstanceOf(SandcasterError);
	});

	it("is instanceof Error", () => {
		const err = new SandboxError("sandbox crashed", "cleanup");
		expect(err).toBeInstanceOf(Error);
	});
});
