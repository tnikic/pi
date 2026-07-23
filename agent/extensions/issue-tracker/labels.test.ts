import assert from "node:assert";
import { describe, it } from "node:test";
import { formatLabel, fromApiColor, parseLabel, toApiColor } from "./labels.ts";

describe("formatLabel", () => {
	it("formats unscoped label for github (colon separator)", () => {
		assert.strictEqual(formatLabel({ name: "bug" }, "github"), "bug");
	});

	it("formats scoped label for github with colon", () => {
		assert.strictEqual(
			formatLabel({ name: "low", scope: "priority" }, "github"),
			"priority:low",
		);
	});

	it("formats unscoped label for forgejo (slash separator)", () => {
		assert.strictEqual(formatLabel({ name: "bug" }, "forgejo"), "bug");
	});

	it("formats scoped label for forgejo with slash", () => {
		assert.strictEqual(
			formatLabel({ name: "low", scope: "priority" }, "forgejo"),
			"priority/low",
		);
	});

	it("formats unscoped label for local (colon separator)", () => {
		assert.strictEqual(formatLabel({ name: "bug" }, "local"), "bug");
	});

	it("formats scoped label for local with colon", () => {
		assert.strictEqual(
			formatLabel({ name: "low", scope: "priority" }, "local"),
			"priority:low",
		);
	});

	it("handles label with color but no scope", () => {
		assert.strictEqual(
			formatLabel({ name: "bug", color: "#d73a4a" }, "github"),
			"bug",
		);
	});
});

describe("parseLabel", () => {
	it("parses unscoped github label", () => {
		assert.deepStrictEqual(parseLabel("bug", "github"), { name: "bug" });
	});

	it("parses scoped github label with colon", () => {
		assert.deepStrictEqual(parseLabel("priority:low", "github"), {
			scope: "priority",
			name: "low",
		});
	});

	it("parses unscoped forgejo label", () => {
		assert.deepStrictEqual(parseLabel("bug", "forgejo"), { name: "bug" });
	});

	it("parses scoped forgejo label with slash", () => {
		assert.deepStrictEqual(parseLabel("priority/low", "forgejo"), {
			scope: "priority",
			name: "low",
		});
	});

	it("parses unscoped local label", () => {
		assert.deepStrictEqual(parseLabel("bug", "local"), { name: "bug" });
	});

	it("parses scoped local label with colon", () => {
		assert.deepStrictEqual(parseLabel("priority:low", "local"), {
			scope: "priority",
			name: "low",
		});
	});

	it("handles label with multiple colons (first colon is scope separator for github)", () => {
		assert.deepStrictEqual(parseLabel("wayfinder:research:extra", "github"), {
			scope: "wayfinder",
			name: "research:extra",
		});
	});

	it("handles label with multiple slashes (first slash is scope separator for forgejo)", () => {
		assert.deepStrictEqual(parseLabel("wayfinder/research/extra", "forgejo"), {
			scope: "wayfinder",
			name: "research/extra",
		});
	});
});

describe("toApiColor", () => {
	it("strips # from color for github API", () => {
		assert.strictEqual(toApiColor("#d73a4a", "github"), "d73a4a");
	});

	it("keeps # for forgejo API", () => {
		assert.strictEqual(toApiColor("#d73a4a", "forgejo"), "#d73a4a");
	});

	it("keeps # for local", () => {
		assert.strictEqual(toApiColor("#d73a4a", "local"), "#d73a4a");
	});

	it("passes through already-unprefixed color for github", () => {
		assert.strictEqual(toApiColor("d73a4a", "github"), "d73a4a");
	});
});

describe("fromApiColor", () => {
	it("adds # to unprefixed color from github API", () => {
		assert.strictEqual(fromApiColor("d73a4a", "github"), "#d73a4a");
	});

	it("passes through already-prefixed color from forgejo API", () => {
		assert.strictEqual(fromApiColor("#d73a4a", "forgejo"), "#d73a4a");
	});

	it("passes through already-prefixed color for local", () => {
		assert.strictEqual(fromApiColor("#d73a4a", "local"), "#d73a4a");
	});

	it("handles empty string", () => {
		assert.strictEqual(fromApiColor("", "github"), "");
	});

	it("returns undefined for undefined input", () => {
		assert.strictEqual(fromApiColor(undefined, "github"), undefined);
	});
});
