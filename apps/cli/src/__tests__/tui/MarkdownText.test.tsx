import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { MarkdownText, stripIncompleteInline } from "../../tui/MarkdownText.js";

vi.mock("ink", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ink")>();
	return {
		...actual,
		useStdoutDimensions: () => [80, 24],
	};
});

describe("stripIncompleteInline", () => {
	it("strips trailing double asterisks", () => {
		expect(stripIncompleteInline("bold text **")).toBe("bold text ");
	});

	it("strips trailing single backtick", () => {
		expect(stripIncompleteInline("code block `")).toBe("code block ");
	});

	it("strips trailing underscore", () => {
		expect(stripIncompleteInline("hello _")).toBe("hello ");
	});

	it("leaves closed markers unchanged", () => {
		expect(stripIncompleteInline("complete **text**")).toBe(
			"complete **text**",
		);
	});

	it("returns empty string unchanged", () => {
		expect(stripIncompleteInline("")).toBe("");
	});

	it("leaves plain text without markers unchanged", () => {
		expect(stripIncompleteInline("no markers")).toBe("no markers");
	});

	it("strips trailing triple backticks", () => {
		expect(stripIncompleteInline("some text ```")).toBe("some text ");
	});

	it("strips trailing double underscores", () => {
		expect(stripIncompleteInline("bold text __")).toBe("bold text ");
	});
});

describe("MarkdownText", () => {
	it("renders plain text content", () => {
		const { lastFrame } = render(<MarkdownText content="Hello world" />);
		expect(lastFrame()).toContain("Hello world");
	});

	it("renders empty content without error", () => {
		expect(() => render(<MarkdownText content="" />)).not.toThrow();
	});

	it("applies stripIncompleteInline when streaming is true", () => {
		const { lastFrame } = render(
			<MarkdownText content="hello **" streaming={true} />,
		);
		const frame = lastFrame() ?? "";
		expect(frame).not.toContain("**");
	});

	it("does not strip markers when streaming is false", () => {
		const { lastFrame } = render(
			<MarkdownText content="**bold**" streaming={false} />,
		);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("bold");
	});
});
