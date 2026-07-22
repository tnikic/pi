import assert from "node:assert";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { getSearxngConfig } from "./config.ts";

const tmpConfig = join(tmpdir(), `pi-test-config-${Date.now()}.json`);

describe("getSearxngConfig", () => {
	after(() => {
		if (existsSync(tmpConfig)) unlinkSync(tmpConfig);
	});

	it("reads port and secretKey from config file", () => {
		writeFileSync(
			tmpConfig,
			JSON.stringify({ searxng: { port: 59999, secretKey: "my-dev-key" } }),
		);
		const config = getSearxngConfig(tmpConfig);
		assert.strictEqual(config.port, 59999);
		assert.strictEqual(config.secretKey, "my-dev-key");
	});

	it("respects a custom port value", () => {
		writeFileSync(
			tmpConfig,
			JSON.stringify({ searxng: { port: 12321, secretKey: "abc" } }),
		);
		assert.strictEqual(getSearxngConfig(tmpConfig).port, 12321);
	});

	it("throws when config file is missing", () => {
		const nonexistent = join(tmpdir(), "does-not-exist.json");
		assert.throws(
			() => getSearxngConfig(nonexistent),
			/config\.json not found/,
		);
	});

	it("throws when config is malformed JSON", () => {
		writeFileSync(tmpConfig, "not json");
		assert.throws(() => getSearxngConfig(tmpConfig), /malformed JSON/);
	});

	it("throws when searxng section is missing", () => {
		writeFileSync(tmpConfig, JSON.stringify({ something: "else" }));
		assert.throws(() => getSearxngConfig(tmpConfig), /missing.*searxng/i);
	});

	it("throws when searxng.port is missing", () => {
		writeFileSync(tmpConfig, JSON.stringify({ searxng: { secretKey: "abc" } }));
		assert.throws(() => getSearxngConfig(tmpConfig), /missing.*port/i);
	});

	it("throws when searxng.secretKey is missing", () => {
		writeFileSync(tmpConfig, JSON.stringify({ searxng: { port: 59999 } }));
		assert.throws(() => getSearxngConfig(tmpConfig), /missing.*secretKey/i);
	});
});
