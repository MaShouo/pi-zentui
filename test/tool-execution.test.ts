import assert from "node:assert/strict";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { type Component, Text, visibleWidth } from "@earendil-works/pi-tui";
import { afterAll as after, beforeAll as before, test } from "vitest";
import { installToolExecutionStyle, TOOL_PREVIEW_ROWS } from "../extensions/zentui/tool-execution";

type AnyRecord = Record<string, unknown>;

const strip = (s: string) =>
	s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

// Snapshot the stock prototype methods before any patch is installed.
const stockToolRender = ToolExecutionComponent.prototype.render;

let cleanups: Array<() => void> = [];
before(() => {
	initTheme("dark", false);
	cleanups = [
		installToolExecutionStyle(
			() => undefined,
			() => true,
		),
	];
});
after(() => {
	for (const cleanup of cleanups.reverse()) cleanup();
	assert.equal(ToolExecutionComponent.prototype.render, stockToolRender);
});

const ui = { requestRender() {} } as never;

function textComponent(text: string): Component {
	return new Text(text, 0, 0);
}

const TRICKY_BODY = [
	"ok looks like a status word",
	"Successfully sounds like success",
	"error: this is just output",
	"read_file is not a title",
	"    indented/path/like.ts",
	"\x1b[31mcolored\x1b[39m and trailing dots ...",
	"┌──────────┐",
	"───",
	"漢字かな交じり 🌸🎉 emoji",
].join("\n");

function makeTool(
	options: { body?: string; call?: string; renderShell?: "default" | "self"; name?: string } = {},
) {
	const body = options.body ?? TRICKY_BODY;
	return new ToolExecutionComponent(
		options.name ?? "read_file",
		"call-1",
		{ path: "a.ts" },
		{},
		{
			renderShell: options.renderShell,
			renderCall: (args: AnyRecord) => textComponent(options.call ?? `read ${args.path}`),
			renderResult: () => textComponent(body),
		},
		ui,
		"/tmp",
	);
}

function finish(tool: ToolExecutionComponent, isError: boolean, text = "done") {
	tool.updateResult({ content: [{ type: "text", text }], isError }, false);
}

test("expanded tool card passes Pi's body lines through byte-for-byte inside the frame", () => {
	const tool = makeTool();
	finish(tool, false);
	tool.setExpanded(true);
	const width = 60;
	const inner = stockToolRender.call(tool, width - 3);
	const out = tool.render(width);

	assert.equal(out[0], "", "Pi's spacer row stays above the frame");
	assert.equal(out.length, inner.length + 2, "only a title row and a bottom row are added");
	assert.match(strip(out[1] ?? ""), /^╭─ ✓ READ FILE ─+╮$/);
	assert.match(strip(out.at(-1) ?? ""), /^╰─+╯$/);
	for (let i = 1; i < inner.length; i++) {
		const line = out[i + 1] ?? "";
		assert.ok(line.includes(inner[i] ?? ""), `body line ${i} unchanged`);
		assert.equal(strip(line), `┃ ${strip(inner[i] ?? "")}│`);
	}
	const plainBody = out.map(strip).join("\n");
	for (const expected of [
		"ok looks like",
		"Successfully sounds",
		"error: this is",
		"    indented/path",
		"trailing dots ...",
		"┌──────────┐",
	]) {
		assert.ok(plainBody.includes(expected), `kept: ${expected}`);
	}
	assert.ok(!/[✓×›]\s*(?:ok|Successfully|error)/.test(plainBody), "no injected status glyphs");
});

test("tool status comes from component state, not body text", () => {
	const failed = makeTool({ body: "Successfully wrote everything" });
	finish(failed, true);
	assert.match(strip(failed.render(50)[1] ?? ""), /× READ FILE · FAILED/);

	const ok = makeTool({ body: "error: looks bad but is fine" });
	finish(ok, false);
	assert.match(strip(ok.render(50)[1] ?? ""), /✓ READ FILE/);

	const running = makeTool();
	assert.match(strip(running.render(50)[1] ?? ""), /◆ READ FILE · RUNNING/);
	running.updateResult({ content: [{ type: "text", text: "partial" }], isError: false }, true);
	assert.match(strip(running.render(50)[1] ?? ""), /RUNNING/);
});

test("expanded tool output is not capped", () => {
	const long = Array.from({ length: 450 }, (_, i) => `line ${i}`).join("\n");
	const tool = makeTool({ body: long });
	finish(tool, false);
	(tool as unknown as { setExpanded(v: boolean): void }).setExpanded(true);
	const inner = stockToolRender.call(tool, 77);
	const out = tool.render(80);
	assert.equal(out.length, inner.length + 2);
	assert.ok(strip(out.join("\n")).includes("line 449"));
});

test("settled tool card is cached (same array while nothing changed)", () => {
	const tool = makeTool();
	finish(tool, false);
	const first = tool.render(70);
	assert.equal(tool.render(70), first);
	assert.notEqual(tool.render(71), first);
	finish(tool, true);
	const failed = tool.render(71);
	assert.match(strip(failed[1] ?? ""), /FAILED/);
});

test("self-rendered tools stay stock", () => {
	const tool = makeTool({ renderShell: "self" });
	finish(tool, false);
	assert.deepEqual(tool.render(60), stockToolRender.call(tool, 60));
});

test("tool cards never exceed the requested width (CJK/emoji)", () => {
	const tool = makeTool({ body: `${"漢🌸".repeat(40)}\n${"x".repeat(200)}` });
	finish(tool, false);
	for (let width = 12; width <= 90; width += 7) {
		for (const line of tool.render(width)) assert.ok(visibleWidth(line) <= width, `tool @${width}`);
	}
});

test("fullscreen click on the framed body still toggles expansion; frame rows are inert", () => {
	const tool = makeTool({ body: Array.from({ length: 30 }, (_, i) => `row ${i}`).join("\n") });
	finish(tool, false);
	const width = 60;
	const out = tool.render(width);
	const state = tool as unknown as { expanded: boolean };
	const event = (y: number, x = 10) => ({
		type: "click" as const,
		button: "left" as const,
		x,
		y,
		screenX: x,
		screenY: y,
		width,
		height: out.length,
		shift: false,
		alt: false,
		ctrl: false,
	});

	assert.equal(tool.handleMouse(event(1)), undefined, "title row");
	assert.equal(tool.handleMouse(event(out.length - 1)), undefined, "bottom row");
	assert.equal(tool.handleMouse(event(4, 0)), undefined, "rail column");
	assert.equal(state.expanded, false);

	const row = out.findIndex((line) => strip(line).includes("row 3"));
	assert.ok(row > 1);
	const result = tool.handleMouse(event(row));
	assert.ok(result, "click handled by Pi's result region");
	assert.equal(state.expanded, true);
});

for (const name of ["codemode", "bash", "write"]) {
	test(`${name} long calls fold to a short ANSI-preserving preview and fully expand`, () => {
		// A single logical line can wrap into hundreds of rows, as in the reported codemode card.
		const call = `${name}\n    \x1b[32m${"await write({text: '你好 🌸'}); ".repeat(900)}\x1b[39m END-OF-CALL`;
		const tool = makeTool({ name, call, body: "RESULT-MARKER" });
		for (const settled of [false, true]) {
			if (settled) finish(tool, false);
			for (const width of [12, 40, 120]) {
				tool.setExpanded(false);
				const native = stockToolRender.call(tool, width - 3);
				const collapsed = tool.render(width);
				assert.equal(collapsed.length, TOOL_PREVIEW_ROWS + 4);
				assert.ok(collapsed.every((line) => visibleWidth(line) <= width));
				assert.ok(!strip(collapsed.join("\n")).includes("END-OF-CALL"));
				for (let i = 1; i <= TOOL_PREVIEW_ROWS; i++) {
					assert.ok((collapsed[i + 1] ?? "").includes(native[i] ?? ""), `native preview row ${i}`);
				}
				// Pi's normal tool expansion (keyboard/global shortcut) removes the preview cap.
				tool.setExpanded(true);
				const expandedNative = stockToolRender.call(tool, width - 3);
				const expanded = tool.render(width);
				assert.equal(expanded.length, expandedNative.length + 2);
				assert.ok(expanded.length > 200);
				for (let i = 1; i < expandedNative.length; i++) {
					assert.ok((expanded[i + 1] ?? "").includes(expandedNative[i] ?? ""));
				}
				tool.setExpanded(false);
				assert.deepEqual(tool.render(width), collapsed);
			}
		}
	});
}

test("preview hint expands on left click; rails, bottom frame, wheel and right click stay inert", () => {
	const tool = makeTool({ name: "codemode", call: "long command\n".repeat(100), body: "result" });
	finish(tool, false);
	const width = 60;
	const rows = tool.render(width);
	const hintRow = rows.length - 2;
	const event = (y: number, x = 10) => ({
		type: "click" as const,
		button: "left" as const,
		x,
		y,
		screenX: x,
		screenY: y,
		width,
		height: rows.length,
		shift: false,
		alt: false,
		ctrl: false,
	});
	assert.match(strip(rows[hintRow] ?? ""), /more lines · expand/);
	assert.equal(tool.handleMouse(event(rows.length - 1)), undefined);
	assert.equal(tool.handleMouse(event(hintRow, 0)), undefined);
	assert.equal(tool.handleMouse(event(hintRow, width - 1)), undefined);
	assert.equal(tool.handleMouse({ ...event(hintRow), button: "right" }), undefined);
	assert.equal(tool.handleMouse({ ...event(hintRow), type: "wheel", wheelDelta: 1 }), undefined);
	assert.equal(tool.render(width), rows);
	assert.deepEqual(tool.handleMouse(event(hintRow)), { handled: true, render: true });
	assert.equal(tool.render(width).length, stockToolRender.call(tool, width - 3).length + 2);
	assert.ok(tool.render(width).length > 100);
});

test("short collapsed cards remain byte-for-byte native inside the frame", () => {
	const tool = makeTool({ body: "    original indentation\n\x1b[31merror: just text\x1b[39m" });
	finish(tool, false);
	const native = stockToolRender.call(tool, 77);
	const out = tool.render(80);
	assert.equal(out.length, native.length + 2);
	for (let i = 1; i < native.length; i++) assert.ok((out[i + 1] ?? "").includes(native[i] ?? ""));
});
