import assert from "node:assert";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { loadAuth, saveAuth } from "./auth.ts";
import type { AuthConfig } from "./types.ts";

const tmpAuthFile = join(tmpdir(), `pi-test-auth-${Date.now()}.json`);

describe("loadAuth", () => {
	after(() => {
		if (existsSync(tmpAuthFile)) unlinkSync(tmpAuthFile);
	});

	it("returns empty object when file doesn't exist", () => {
		const config = loadAuth(join(tmpdir(), "nonexistent-auth.json"));
		assert.deepStrictEqual(config, {});
	});

	it("reads a valid auth file", () => {
		const data: AuthConfig = {
			github: { token: "ghp_test123" },
			forgejo: {
				"codeberg.org": {
					token: "fj_token",
					instance_url: "https://codeberg.org",
				},
			},
			local: { username: "dev" },
		};
		writeFileSync(tmpAuthFile, JSON.stringify(data, null, 2));
		const config = loadAuth(tmpAuthFile);
		assert.deepStrictEqual(config, data);
	});

	it("returns empty object for malformed JSON", () => {
		writeFileSync(tmpAuthFile, "not json {{{");
		const config = loadAuth(tmpAuthFile);
		assert.deepStrictEqual(config, {});
	});
});

describe("saveAuth", () => {
	after(() => {
		if (existsSync(tmpAuthFile)) unlinkSync(tmpAuthFile);
	});

	it("writes auth config to file", () => {
		const data: AuthConfig = {
			github: { token: "ghp_saved" },
		};
		saveAuth(data, tmpAuthFile);
		const raw = JSON.parse(readFileSync(tmpAuthFile, "utf8"));
		assert.deepStrictEqual(raw, data);
	});

	it("overwrites existing file", () => {
		writeFileSync(tmpAuthFile, JSON.stringify({ old: true }));
		const data: AuthConfig = { local: { username: "newuser" } };
		saveAuth(data, tmpAuthFile);
		const raw = JSON.parse(readFileSync(tmpAuthFile, "utf8"));
		assert.deepStrictEqual(raw, data);
	});
});
