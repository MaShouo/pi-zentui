import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep every read/write in memory so tests never touch the real user config.
const fsState = vi.hoisted(() => ({
	files: new Map<string, string>(),
	failWrite: false,
	failRename: false,
	writes: 0,
}));

vi.mock("node:fs", () => ({
	existsSync: (path: string) => fsState.files.has(path),
	readFileSync: (path: string) => {
		const value = fsState.files.get(path);
		if (value === undefined) throw new Error(`ENOENT: ${path}`);
		return value;
	},
	writeFileSync: (path: string, data: string) => {
		if (fsState.failWrite) throw new Error("disk full");
		fsState.writes += 1;
		fsState.files.set(path, data);
	},
	mkdirSync: () => {},
	renameSync: (from: string, to: string) => {
		if (fsState.failRename) throw new Error("rename failed");
		const value = fsState.files.get(from);
		if (value === undefined) throw new Error(`ENOENT: ${from}`);
		fsState.files.set(to, value);
		fsState.files.delete(from);
	},
}));

import {
	DEFAULT_MATRIX_CONFIG,
	describeConfig,
	HELP_TEXT,
	LIMITS,
	loadConfig,
	normalizeConfig,
	parseMatrixCommand,
	saveConfig,
} from "../extensions/matrix/index";

beforeEach(() => {
	fsState.files.clear();
	fsState.failWrite = false;
	fsState.failRename = false;
	fsState.writes = 0;
});

describe("Sakura Matrix config normalization", () => {
	it("keeps the local defaults: rain on, unchanged ranges", () => {
		expect(DEFAULT_MATRIX_CONFIG).toEqual({ enabled: true, fps: 10, density: 0.65, height: 4 });
		expect(LIMITS.fps).toEqual({ min: 8, max: 18 });
		expect(LIMITS.density).toEqual({ min: 0.45, max: 0.95 });
		expect(LIMITS.height).toEqual({ min: 3, max: 6 });
	});

	it("clamps out-of-range values and falls back on invalid fields", () => {
		expect(normalizeConfig({})).toEqual({ ...DEFAULT_MATRIX_CONFIG });
		expect(normalizeConfig({ enabled: false, fps: 99, density: 0.1, height: 42 })).toEqual({
			enabled: false,
			fps: 18,
			density: 0.45,
			height: 6,
		});
		expect(normalizeConfig({ fps: "abc", density: null, height: -1 })).toEqual({
			...DEFAULT_MATRIX_CONFIG,
		});
		expect(normalizeConfig("garbage")).toEqual({ ...DEFAULT_MATRIX_CONFIG });
		expect(normalizeConfig({ fps: 12.6 }).fps).toBe(13);
		// Existing users keep their saved opt-in/opt-out.
		expect(normalizeConfig({ enabled: true }).enabled).toBe(true);
		expect(normalizeConfig({ enabled: false }).enabled).toBe(false);
	});
});

describe("Sakura Matrix config load/save", () => {
	it("loads defaults for a missing file without writing anything", () => {
		expect(loadConfig("/home/missing.json")).toEqual({ config: { ...DEFAULT_MATRIX_CONFIG } });
		expect(fsState.files.size).toBe(0);
		expect(fsState.writes).toBe(0);
	});

	it("reports corrupt config and never rewrites the user's file on load", () => {
		const path = "/home/matrix.json";
		fsState.files.set(path, "{ not json");
		const loaded = loadConfig(path);
		expect(loaded.config).toEqual({ ...DEFAULT_MATRIX_CONFIG });
		expect(loaded.error).toBeTruthy();
		expect(fsState.files.get(path)).toBe("{ not json");
		expect(fsState.writes).toBe(0);
	});

	it("saves atomically through a temp file and creates the parent directory", () => {
		const path = "/home/.pi/agent/matrix.json";
		const config = { enabled: false, fps: 12, density: 0.5, height: 5 };

		expect(saveConfig(config, path)).toBeUndefined();
		expect(loadConfig(path).config).toEqual(config);
		// No `.tmp` file is left behind after the rename.
		expect([...fsState.files.keys()]).toEqual([path]);
	});

	it("reports write failures instead of throwing and leaves the old file intact", () => {
		const path = "/home/matrix.json";
		fsState.files.set(path, "old");
		fsState.failWrite = true;

		expect(typeof saveConfig({ ...DEFAULT_MATRIX_CONFIG }, path)).toBe("string");
		expect(fsState.files.get(path)).toBe("old");
	});

	it("reports rename failures and does not replace the target", () => {
		const path = "/home/matrix.json";
		fsState.files.set(path, "old");
		fsState.failRename = true;

		expect(typeof saveConfig({ ...DEFAULT_MATRIX_CONFIG }, path)).toBe("string");
		expect(fsState.files.get(path)).toBe("old");
	});
});

describe("Sakura Matrix command parsing", () => {
	it("parses status, help, toggles and the height setting", () => {
		expect(parseMatrixCommand("")).toEqual({ type: "status" });
		expect(parseMatrixCommand("  STATUS ")).toEqual({ type: "status" });
		expect(parseMatrixCommand("help")).toEqual({ type: "help" });
		expect(parseMatrixCommand("?")).toEqual({ type: "help" });
		expect(parseMatrixCommand("on")).toEqual({ type: "on" });
		expect(parseMatrixCommand("off")).toEqual({ type: "off" });
		expect(parseMatrixCommand("preview")).toEqual({ type: "preview" });
		expect(parseMatrixCommand("fps 12")).toEqual({ type: "set", key: "fps", value: 12 });
		expect(parseMatrixCommand("density 0.777")).toEqual({
			type: "set",
			key: "density",
			value: 0.78,
		});
		expect(parseMatrixCommand("height 5")).toEqual({ type: "set", key: "height", value: 5 });
	});

	it("rejects invalid ranges and unknown subcommands with the help text", () => {
		for (const bad of ["fps", "fps 2", "fps x", "density 1.5", "height 9", "wat"]) {
			expect(parseMatrixCommand(bad).type).toBe("invalid");
		}
		const unknown = parseMatrixCommand("wat");
		expect(unknown.type === "invalid" && unknown.message.includes("/sakura-matrix height N")).toBe(
			true,
		);
	});

	it("describes state and exposes every documented subcommand in help", () => {
		expect(describeConfig({ ...DEFAULT_MATRIX_CONFIG })).toBe(
			"Sakura Matrix: on · 10 FPS · 4 lines · density 0.65",
		);
		expect(HELP_TEXT).toContain("/sakura-matrix height N");
		expect(HELP_TEXT).toContain("/sakura-matrix help");
	});
});
