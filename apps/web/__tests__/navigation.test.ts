import { describe, expect, it } from "vitest";
import { getDocsNavigation } from "../src/lib/navigation";

const EXPECTED_IDS = [
	"getting-started",
	"configuration",
	"api-reference",
	"sdk-reference",
	"cli-reference",
	"starters",
	"deployment",
];

describe("getDocsNavigation", () => {
	it("returns 3 sections", () => {
		const nav = getDocsNavigation();
		expect(nav).toHaveLength(3);
	});

	it("has 7 total items across all sections", () => {
		const nav = getDocsNavigation();
		const total = nav.reduce((sum, section) => sum + section.items.length, 0);
		expect(total).toBe(7);
	});

	it("items within each section are sorted by order", () => {
		const nav = getDocsNavigation();
		for (const section of nav) {
			const orders = section.items.map((item) => item.order);
			const sorted = [...orders].sort((a, b) => a - b);
			expect(orders).toEqual(sorted);
		}
	});

	it("first section title is Getting Started", () => {
		const nav = getDocsNavigation();
		expect(nav[0].title).toBe("Getting Started");
	});

	it("Getting Started section comes before Reference section", () => {
		const nav = getDocsNavigation();
		const gettingStartedIndex = nav.findIndex(
			(s) => s.title === "Getting Started",
		);
		const referenceIndex = nav.findIndex((s) => s.title === "Reference");
		expect(gettingStartedIndex).toBeGreaterThanOrEqual(0);
		expect(referenceIndex).toBeGreaterThanOrEqual(0);
		expect(gettingStartedIndex).toBeLessThan(referenceIndex);
	});

	it("all expected IDs are present", () => {
		const nav = getDocsNavigation();
		const allIds = nav.flatMap((section) =>
			section.items.map((item) => item.id),
		);
		for (const expectedId of EXPECTED_IDS) {
			expect(allIds).toContain(expectedId);
		}
	});

	it("no duplicate IDs", () => {
		const nav = getDocsNavigation();
		const allIds = nav.flatMap((section) =>
			section.items.map((item) => item.id),
		);
		const unique = new Set(allIds);
		expect(unique.size).toBe(allIds.length);
	});

	it("each entry has id, title, and order fields", () => {
		const nav = getDocsNavigation();
		for (const section of nav) {
			for (const item of section.items) {
				expect(typeof item.id).toBe("string");
				expect(typeof item.title).toBe("string");
				expect(typeof item.order).toBe("number");
			}
		}
	});
});
