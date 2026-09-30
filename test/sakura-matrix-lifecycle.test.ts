import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep config reads/writes in memory: the lifecycle tests must never touch user files.
const fsState = vi.hoisted(() => ({
	files: new Map<string, string>(),
	failWrite: false,
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
		const value = fsState.files.get(from);
		if (value === undefined) throw new Error(`ENOENT: ${from}`);
		fsState.files.set(to, value);
		fsState.files.delete(from);
	},
}));

import sakuraMatrix, {
	CONFIG_PATH,
	isInteractiveTui,
	MATRIX_WIDGET_KEY,
} from "../extensions/matrix/index";

type Handler = (event: unknown, context: unknown) => void | Promise<void>;
type MatrixConfigJson = { enabled: boolean; fps: number; density: number; height: number };

const DISABLED: MatrixConfigJson = { enabled: false, fps: 10, density: 0.65, height: 4 };

interface HarnessOptions {
	mode?: "tui" | "rpc" | undefined;
	hasUI?: boolean;
	isIdle?: () => boolean;
	config?: MatrixConfigJson | "corrupt";
}

function harness(options: HarnessOptions = {}) {
	const handlers = new Map<string, Handler[]>();
	const widgets: Array<[string, unknown, unknown?]> = [];
	const notices: Array<[string, string | undefined]> = [];
	let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;

	fsState.files.clear();
	fsState.failWrite = false;
	fsState.writes = 0;
	if (options.config === "corrupt") fsState.files.set(CONFIG_PATH, "{ not json");
	else if (options.config) fsState.files.set(CONFIG_PATH, JSON.stringify(options.config));

	sakuraMatrix({
		on(eventName: string, handler: Handler) {
			handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler]);
		},
		registerCommand(
			_name: string,
			value: { handler: (args: string, ctx: unknown) => Promise<void> },
		) {
			command = value;
		},
	} as never);

	const ui = {
		theme: { getColorMode: () => "truecolor" },
		setWidget(key: string, content: unknown, opts?: unknown) {
			widgets.push([key, content, opts]);
		},
		notify(message: string, type?: string) {
			notices.push([message, type]);
		},
	};
	const ctx = {
		mode: options.mode ?? "tui",
		hasUI: options.hasUI ?? true,
		isIdle: options.isIdle ?? (() => false),
		ui,
	};

	const emit = async (name: string, event: Record<string, unknown> = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx);
	};
	const run = (args: string) => {
		if (!command) throw new Error("command was not registered");
		return command.handler(args, ctx);
	};
	const lastWidget = () => widgets.at(-1);
	const saved = () =>
		JSON.parse(fsState.files.get(CONFIG_PATH) ?? "null") as MatrixConfigJson | null;

	return { emit, run, ctx, ui, notices, widgets, lastWidget, saved };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("Sakura Matrix lifecycle", () => {
	it("animates only an above-editor widget during work and cleans up on agent_end", async () => {
		const h = harness();
		await h.emit("agent_start");
		expect(h.widgets).toEqual([
			[MATRIX_WIDGET_KEY, expect.any(Function), { placement: "aboveEditor" }],
		]);
		expect(vi.getTimerCount()).toBeGreaterThan(0);

		await h.emit("agent_end");
		expect(h.lastWidget()).toEqual([MATRIX_WIDGET_KEY, undefined, { placement: "aboveEditor" }]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("stays idle while disabled and only starts on the next enabled run", async () => {
		const h = harness({ config: DISABLED });
		await h.emit("agent_start");
		expect(h.widgets).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("on during work starts immediately and persists enabled", async () => {
		const h = harness({ config: DISABLED });
		await h.emit("agent_start");
		expect(h.widgets).toHaveLength(0);

		await h.run("on");
		expect(h.lastWidget()?.[1]).toEqual(expect.any(Function));
		expect(h.saved()).toEqual({ ...DISABLED, enabled: true });

		await h.emit("agent_end");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("on while idle persists and defers the rain to the next run", async () => {
		const h = harness({ config: DISABLED, isIdle: () => true });
		await h.run("on");
		expect(h.widgets).toHaveLength(0);
		expect(h.saved()).toEqual({ ...DISABLED, enabled: true });

		await h.emit("agent_start");
		expect(h.lastWidget()?.[1]).toEqual(expect.any(Function));
	});

	it("off stops the rain and persists disabled", async () => {
		const h = harness();
		await h.emit("agent_start");
		await h.run("off");
		expect(h.lastWidget()?.[1]).toBeUndefined();
		expect(h.saved()?.enabled).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("Sakura Matrix preview", () => {
	it("runs for 5s while disabled without persisting enabled, then stops", async () => {
		const h = harness({ config: DISABLED });
		await h.emit("agent_start");
		expect(h.widgets).toHaveLength(0);

		await h.run("preview");
		expect(h.lastWidget()?.[1]).toEqual(expect.any(Function));
		expect(h.notices.at(-1)?.[0]).toContain("preview: 5 seconds");
		expect(fsState.writes).toBe(0);
		expect(h.saved()).toEqual(DISABLED);

		vi.advanceTimersByTime(5_000);
		expect(h.lastWidget()?.[1]).toBeUndefined();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not cut a running rain short after 5s (already active just notifies)", async () => {
		const h = harness();
		await h.emit("agent_start");
		const widgetCount = h.widgets.length;

		await h.run("preview");
		expect(h.notices.at(-1)?.[0]).toContain("already running");
		expect(h.widgets).toHaveLength(widgetCount);

		vi.advanceTimersByTime(5_000);
		expect(h.lastWidget()?.[1]).toEqual(expect.any(Function));
		expect(vi.getTimerCount()).toBeGreaterThan(0);

		await h.emit("session_shutdown");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("reports that preview needs the interactive terminal UI in RPC", async () => {
		const h = harness({ mode: "rpc", hasUI: true });
		await h.run("preview");
		expect(h.notices.at(-1)?.[0]).toContain("needs the interactive terminal UI");
		expect(h.widgets).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("Sakura Matrix TUI guard", () => {
	it("prefers ctx.mode and falls back to hasUI for legacy hosts", () => {
		expect(isInteractiveTui({ mode: "tui", hasUI: true })).toBe(true);
		expect(isInteractiveTui({ mode: "rpc", hasUI: true })).toBe(false);
		expect(isInteractiveTui({ mode: undefined as never, hasUI: true })).toBe(true);
		expect(isInteractiveTui({ mode: undefined as never, hasUI: false })).toBe(false);
		expect(isInteractiveTui(undefined)).toBe(false);
	});

	it("still animates on a legacy host that only exposes hasUI", async () => {
		const h = harness({ mode: undefined, hasUI: true });
		await h.emit("agent_start");
		expect(h.lastWidget()?.[1]).toEqual(expect.any(Function));
		await h.emit("session_shutdown");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("never installs widgets or timers in RPC, even with hasUI", async () => {
		const h = harness({ mode: "rpc", hasUI: true });
		await h.emit("session_start");
		await h.emit("agent_start");
		await h.emit("tool_execution_start");
		vi.advanceTimersByTime(5_000);
		expect(h.widgets).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("Sakura Matrix persistence failures", () => {
	it("keeps memory and running state consistent when enabling cannot be saved", async () => {
		const h = harness({ config: DISABLED });
		fsState.failWrite = true;

		await h.run("on");
		expect(h.notices.at(-1)?.[1]).toBe("error");
		expect(h.widgets).toHaveLength(0);
		expect(h.saved()).toEqual(DISABLED);

		await h.run("status");
		expect(h.notices.at(-1)?.[0]).toContain("off");

		await h.emit("agent_start");
		expect(h.widgets).toHaveLength(0);
	});

	it("does not persist a setting that fails to save", async () => {
		const h = harness({ config: DISABLED });
		fsState.failWrite = true;
		await h.run("fps 15");
		expect(h.notices.at(-1)?.[1]).toBe("error");
		await h.run("status");
		expect(h.notices.at(-1)?.[0]).toContain("10 FPS");
	});

	it("reports corrupt config, refuses to overwrite, and never silently rewrites on load", async () => {
		const h = harness({ config: "corrupt" });
		expect(fsState.files.get(CONFIG_PATH)).toBe("{ not json");

		await h.emit("session_start");
		expect(h.notices.at(-1)?.[1]).toBe("warning");
		expect(h.notices.at(-1)?.[0]).toContain("refusing to overwrite");

		await h.run("off");
		expect(h.notices.at(-1)?.[1]).toBe("error");
		expect(fsState.writes).toBe(0);
		expect(fsState.files.get(CONFIG_PATH)).toBe("{ not json");
	});
});

describe("Sakura Matrix commands", () => {
	it("persists fps, density and height and reports invalid usage", async () => {
		const h = harness();
		await h.run("fps 12");
		expect(h.saved()?.fps).toBe(12);
		await h.run("density 0.8");
		expect(h.saved()?.density).toBe(0.8);
		await h.run("height 5");
		expect(h.saved()?.height).toBe(5);

		await h.run("fps 99");
		expect(h.notices.at(-1)?.[1]).toBe("error");
		expect(h.notices.at(-1)?.[0]).toContain("Usage: /sakura-matrix fps <8-18>");

		await h.run("help");
		expect(h.notices.at(-1)?.[0]).toContain("/sakura-matrix height N");

		await h.run("wat");
		expect(h.notices.at(-1)?.[1]).toBe("error");

		await h.run("status");
		expect(h.notices.at(-1)?.[0]).toContain("Sakura Matrix: on");
	});
});

describe("Sakura Matrix shutdown", () => {
	it("clears animation and preview timers on session_shutdown", async () => {
		const h = harness({ config: DISABLED });
		await h.run("preview");
		expect(vi.getTimerCount()).toBeGreaterThan(0);

		await h.emit("session_shutdown");
		expect(h.lastWidget()?.[1]).toBeUndefined();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("fails open when the UI throws during preview or cleanup", async () => {
		const h = harness({ config: DISABLED });
		h.ui.setWidget = () => {
			throw new Error("disposed");
		};

		await h.run("preview");
		expect(h.notices.at(-1)?.[0]).toContain("could not start");
		expect(vi.getTimerCount()).toBe(0);
	});
});
