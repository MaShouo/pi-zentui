import assert from "node:assert/strict";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { type Component, Text, visibleWidth } from "@earendil-works/pi-tui";
import { afterAll as after, beforeAll as before, test } from "vitest";
import { installToolExecutionStyle } from "../extensions/zentui/tool-execution";

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
	options: { body?: string; renderShell?: "default" | "self"; name?: string } = {},
) {
	const body = options.body ?? TRICKY_BODY;
	return new ToolExecutionComponent(
		options.name ?? "read_file",
		"call-1",
		{ path: "a.ts" },
		{},
		{
			renderShell: options.renderShell,
			renderCall: (args: AnyRecord) => textComponent(`read ${args.path}`),
			renderResult: () => textComponent(body),
		},
		ui,
		"/tmp",
	);
}

function finish(tool: ToolExecutionComponent, isError: boolean, text = "done") {
	tool.updateResult({ content: [{ type: "text", text }], isError }, false);
}

test("tool card passes Pi's body lines through byte-for-byte inside the frame", () => {
	const tool = makeTool();
	finish(tool, false);
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
