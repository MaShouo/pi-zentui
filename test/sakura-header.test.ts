import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";
import headerExtension, {
	isInteractiveTui,
	renderHeader,
	TOP_PADDING,
} from "../extensions/header/index";
import { getColorMode, setColorMode } from "../extensions/shared/color";

const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

type Handler = (event: unknown, ctx: unknown) => unknown;
type Component = { render(w: number): string[]; invalidate(): void };
type Factory = (tui?: unknown, theme?: unknown) => Component;

function captureHandlers(): Map<string, Handler> {
	const handlers = new Map<string, Handler>();
	const pi = { on: (name: string, fn: Handler) => void handlers.set(name, fn) };
	headerExtension(pi as never);
	return handlers;
}

function makeUi(theme: unknown, onSetHeader?: (factory: unknown) => void) {
	const calls: unknown[] = [];
	const ui = {
		theme,
		setHeader(factory: unknown) {
			calls.push(factory);
			onSetHeader?.(factory);
		},
	};
	return { ui, calls };
}

function install(handlers: Map<string, Handler>, ui: unknown, mode: string | undefined) {
	handlers.get("session_start")?.({}, { mode, hasUI: true, ui });
}

function componentOf(calls: unknown[]): Component {
	const factory = calls.at(-1);
	assert.equal(typeof factory, "function", "header factory was not installed");
	return (factory as Factory)();
}

const NO_COLOR = process.env.NO_COLOR;

beforeEach(() => {
	delete process.env.NO_COLOR;
	setColorMode("truecolor");
});

afterEach(() => {
	if (NO_COLOR === undefined) delete process.env.NO_COLOR;
	else process.env.NO_COLOR = NO_COLOR;
	setColorMode("truecolor");
});

// ─── Rendering ──────────────────────────────────────────────────────

describe("renderHeader", () => {
	test("every line fits the width, including very narrow terminals", () => {
		for (const width of [1, 2, 3, 5, 10, 21, 22, 40, 64, 65, 66, 80, 200]) {
			for (const line of renderHeader(width)) {
				assert.ok(
					visibleWidth(line) <= width,
					`width ${width}: line is ${visibleWidth(line)} wide`,
				);
			}
		}
		assert.deepEqual(renderHeader(0), []);
		assert.deepEqual(renderHeader(-3), []);
		assert.deepEqual(renderHeader(Number.NaN), []);
	});

	test("height is fixed and never grows with the terminal row count", () => {
		const heights = new Set([20, 40, 65, 120].map((width) => renderHeader(width).length));
		assert.equal(heights.size, 1, "header height changed with width");

		const wide = renderHeader(120);
		assert.equal(TOP_PADDING, 1);
		assert.ok(wide.slice(0, TOP_PADDING).every((line) => line === ""));
		assert.ok(wide.length <= 14, `unexpected tall header: ${wide.length} lines`);

		// A stale row count argument must not add dynamic top/bottom padding.
		const withRows = (renderHeader as unknown as (w: number, rows: number) => string[])(120, 999);
		assert.deepEqual(withRows, wide);
	});

	test("keeps the original artwork and Nerd-font label", () => {
		const text = renderHeader(120).map(strip);
		assert.ok(
			text.some((line) => line.includes("⣿")),
			"braille artwork missing",
		);
		assert.ok(
			text.some((line) => line.includes("SAKURA CYBERDECK")),
			"label missing",
		);
		assert.ok(
			text.some((line) => line.includes("◈")),
			"label glyph missing",
		);
		assert.equal(renderHeader(120).length - TOP_PADDING, text.length - TOP_PADDING);
	});

	test("truncates the label with an ellipsis at narrow widths", () => {
		const narrow = renderHeader(10).map(strip);
		assert.ok(
			narrow.some((line) => line.includes("…")),
			"no ellipsis on narrow header",
		);
		const wide = renderHeader(80).map(strip);
		assert.ok(wide.some((line) => line.includes("SAKURA CYBERDECK")));
	});
});

// ─── Color modes ────────────────────────────────────────────────────

describe("header color modes", () => {
	test("uses truecolor SGR by default", () => {
		const lines = renderHeader(80);
		assert.ok(lines.some((line) => line.includes("38;2;")));
	});

	test("uses indexed foreground in 256-color mode", () => {
		setColorMode("256color");
		const lines = renderHeader(80);
		assert.ok(lines.some((line) => /38;5;\d+m/.test(line)));
		assert.ok(lines.every((line) => !line.includes("38;2;")));
	});

	test("emits no escape sequences under NO_COLOR", () => {
		setColorMode("none");
		for (const line of renderHeader(80)) {
			assert.ok(!line.includes("\x1b["), `unexpected SGR: ${JSON.stringify(line)}`);
		}
	});

	test("resets only fg/bold, never the surrounding background", () => {
		for (const width of [1, 5, 10, 22, 80, 200]) {
			for (const line of renderHeader(width)) {
				assert.ok(
					!line.includes("\x1b[0m"),
					`full SGR reset leaked at width ${width}: ${JSON.stringify(line)}`,
				);
			}
		}
	});
});

// ─── Lifecycle ──────────────────────────────────────────────────────

describe("header lifecycle", () => {
	test("isInteractiveTui prefers mode and falls back to hasUI", () => {
		assert.equal(isInteractiveTui(undefined), false);
		assert.equal(isInteractiveTui({ mode: "tui", hasUI: true }), true);
		assert.equal(isInteractiveTui({ mode: "rpc", hasUI: true }), false);
		assert.equal(isInteractiveTui({ mode: "json", hasUI: true }), false);
		assert.equal(isInteractiveTui({ mode: "print", hasUI: false }), false);
		// Older hosts without `mode` fall back to hasUI.
		assert.equal(isInteractiveTui({ mode: undefined as never, hasUI: true }), true);
		assert.equal(isInteractiveTui({ mode: undefined as never, hasUI: false }), false);
	});

	test("only installs in TUI mode; RPC and print never install", () => {
		const handlers = captureHandlers();
		const { ui, calls } = makeUi({ getColorMode: () => "truecolor" });
		install(handlers, ui, "rpc");
		install(handlers, ui, "print");
		install(handlers, ui, "json");
		assert.equal(calls.length, 0);
		install(handlers, ui, "tui");
		assert.equal(calls.length, 1);
	});

	test("falls back to hasUI when the host omits mode", () => {
		const handlers = captureHandlers();
		const { ui, calls } = makeUi({ getColorMode: () => "truecolor" });
		handlers.get("session_start")?.({}, { hasUI: false, ui });
		assert.equal(calls.length, 0);
		handlers.get("session_start")?.({}, { hasUI: true, ui });
		assert.equal(calls.length, 1);
	});

	test("shutdown only releases a header it actually installed", () => {
		const handlers = captureHandlers();
		const never = makeUi({ getColorMode: () => "truecolor" });
		install(handlers, never.ui, "rpc");
		handlers.get("session_shutdown")?.({}, { mode: "tui", hasUI: true, ui: never.ui });
		assert.equal(never.calls.length, 0, "reset a header it never owned");

		const owned = makeUi({ getColorMode: () => "truecolor" });
		install(handlers, owned.ui, "tui");
		handlers.get("session_shutdown")?.({}, { mode: "tui", hasUI: true, ui: owned.ui });
		assert.equal(owned.calls.length, 2);
		assert.equal(owned.calls.at(-1), undefined);
	});

	test("fails open when setHeader throws on install or shutdown", () => {
		const handlers = captureHandlers();
		const broken = {
			theme: { getColorMode: () => "truecolor" },
			setHeader() {
				throw new Error("host refused");
			},
		};
		assert.doesNotThrow(() => install(handlers, broken, "tui"));
		assert.doesNotThrow(() =>
			handlers.get("session_shutdown")?.({}, { mode: "tui", hasUI: true, ui: broken }),
		);

		// Installs fine, but the release call throws: still swallowed.
		let created = 0;
		const flaky = {
			theme: { getColorMode: () => "truecolor" },
			setHeader(factory: unknown) {
				if (factory === undefined) throw new Error("already disposed");
				created++;
			},
		};
		install(handlers, flaky, "tui");
		assert.equal(created, 1);
		assert.doesNotThrow(() =>
			handlers.get("session_shutdown")?.({}, { mode: "tui", hasUI: true, ui: flaky }),
		);
	});
});

// ─── Cache ──────────────────────────────────────────────────────────

describe("header cache", () => {
	test("reuses the render for the same width and color mode", () => {
		const handlers = captureHandlers();
		const { ui, calls } = makeUi({ getColorMode: () => "truecolor" });
		install(handlers, ui, "tui");
		const header = componentOf(calls);

		const first = header.render(80);
		const second = header.render(80);
		assert.equal(first, second, "same width/mode should reuse the cached array");
		assert.notEqual(header.render(81), first, "a new width must re-render");
	});

	test("a color-mode switch invalidates the cached SGR", () => {
		const handlers = captureHandlers();
		const { ui, calls } = makeUi({ getColorMode: () => "truecolor" });
		install(handlers, ui, "tui");
		const header = componentOf(calls);

		const truecolor = header.render(80);
		assert.ok(truecolor.some((line) => line.includes("38;2;")));

		setColorMode("256color");
		const indexed = header.render(80);
		assert.ok(indexed.some((line) => /38;5;\d+m/.test(line)));
		assert.ok(indexed.every((line) => !line.includes("38;2;")));
	});

	test("invalidate clears the cache and re-follows ctx.ui.theme", () => {
		const handlers = captureHandlers();
		let mode = "256color";
		const theme = { getColorMode: () => mode };
		const { ui, calls } = makeUi(theme);
		install(handlers, ui, "tui");
		const header = componentOf(calls);

		assert.equal(getColorMode(), "256color");
		const cached = header.render(80);
		assert.equal(header.render(80), cached);

		// Theme now reports truecolor; invalidate must re-sync before the next render.
		mode = "truecolor";
		header.invalidate();
		assert.equal(getColorMode(), "truecolor");
		const repainted = header.render(80);
		assert.notEqual(repainted, cached, "invalidate must drop the cached render");
		assert.ok(repainted.some((line) => line.includes("38;2;")));
	});

	test("invalidate tolerates a disposed context", () => {
		const handlers = captureHandlers();
		let disposed = false;
		const calls: unknown[] = [];
		const ui = {
			get theme(): unknown {
				if (disposed) throw new Error("disposed");
				return { getColorMode: () => "truecolor" };
			},
			setHeader(factory: unknown) {
				calls.push(factory);
			},
		};
		install(handlers, ui, "tui");
		const header = componentOf(calls);

		disposed = true;
		assert.doesNotThrow(() => header.invalidate());
		assert.doesNotThrow(() => header.render(80));
	});
});

// ─── Theme ──────────────────────────────────────────────────────────

const theme = JSON.parse(
	readFileSync(new URL("../themes/sakura-macaron.json", import.meta.url), "utf8"),
) as {
	name: string;
	vars: Record<string, string | number>;
	colors: Record<string, string | number>;
	export?: Record<string, string | number>;
};
const schema = JSON.parse(
	readFileSync(
		new URL(
			"../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json",
			import.meta.url,
		),
		"utf8",
	),
) as { properties: { colors: { properties: Record<string, unknown>; required: string[] } } };

describe("sakura-macaron theme additions", () => {
	it("applies the requested dim/borderMuted retune and adds plum", () => {
		expect(theme.vars.dim).toBe("#877C8F");
		expect(theme.vars.borderMuted).toBe("#54465F");
		expect(theme.vars.plum).toBe("#4A2E40");
	});

	it("wires the optional scrollbar and search colors", () => {
		expect(theme.colors.scrollbarTrack).toBe("borderMuted");
		expect(theme.colors.scrollbarThumb).toBe("muted");
		expect(theme.colors.searchMatchBg).toBe("plum");
		expect(theme.colors.searchMatchText).toBe("butter");
	});

	it("keeps the original vars and every color key schema-valid", () => {
		expect(theme.vars.surfaceSoft).toBe("#251D2D");
		expect(theme.vars.sakuraIro).toBe("#FCC9B9");
		expect(theme.vars.butter).toBe("#F3D98B");
		for (const key of Object.keys(theme.colors)) {
			assert.ok(
				key in schema.properties.colors.properties,
				`color "${key}" is not in the 0.87.1 theme schema`,
			);
		}
		for (const key of schema.properties.colors.required) {
			assert.ok(key in theme.colors, `missing required color "${key}"`);
		}
	});

	it("resolves every variable reference", () => {
		const resolve = (value: string | number): string | number => {
			const seen = new Set<string>();
			let current = value;
			while (typeof current === "string" && current !== "" && !current.startsWith("#")) {
				assert.ok(!seen.has(current), `circular var reference: ${current}`);
				seen.add(current);
				assert.ok(current in theme.vars, `unknown var reference: ${current}`);
				current = theme.vars[current] as string | number;
			}
			return current;
		};
		for (const [key, value] of Object.entries(theme.colors)) {
			const resolved = resolve(value);
			if (typeof resolved === "string" && resolved.startsWith("#")) {
				assert.match(resolved, /^#[0-9a-f]{6}$/i, `colors.${key} is not a hex color`);
			}
		}
	});
});
