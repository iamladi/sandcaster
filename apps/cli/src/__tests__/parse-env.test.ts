import { describe, expect, it } from "vitest";
import { parseEnvFile } from "../parse-env.js";

describe("parseEnvFile", () => {
	it("parses simple KEY=value pairs", () => {
		expect(parseEnvFile("FOO=bar")).toEqual({ FOO: "bar" });
	});

	it("strips double quotes from values", () => {
		expect(parseEnvFile('KEY="quoted-value"')).toEqual({
			KEY: "quoted-value",
		});
	});

	it("strips single quotes from values", () => {
		expect(parseEnvFile("KEY='quoted-value'")).toEqual({
			KEY: "quoted-value",
		});
	});

	it("does not strip mismatched quotes", () => {
		expect(parseEnvFile(`KEY="mismatched'`)).toEqual({
			KEY: `"mismatched'`,
		});
	});

	it("skips empty lines and comments", () => {
		const input = `
# comment
FOO=bar

# another
BAZ=qux
`;
		expect(parseEnvFile(input)).toEqual({ FOO: "bar", BAZ: "qux" });
	});

	it("skips lines without =", () => {
		expect(parseEnvFile("INVALID_LINE\nFOO=bar")).toEqual({ FOO: "bar" });
	});

	it("handles values with = in them", () => {
		expect(parseEnvFile("KEY=a=b=c")).toEqual({ KEY: "a=b=c" });
	});
});
