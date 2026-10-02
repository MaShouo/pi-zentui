import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { mergeConfig } from "../extensions/zentui/config";
import { renderPolishedEditorFrame, WrappedPolishedEditor } from "../extensions/zentui/ui";

const theme = { name: "sakura-macaron", fg: (_color: string, text: string) => text } as Theme;
const modelMeta = { modelLabel: "gpt-6-astra", providerLabel: "OpenAI" };

function render(width = 60, config = mergeConfig({}, {}), extra = {}) {
	return renderPolishedEditorFrame({
		width,
		editorLines: ["hello"],
		uiTheme: theme,
		config,
		modelMeta,
		thinkingLevel: "high",
		...extra,
	});
}

function expectClosedFrame(lines: string[], width: number) {
	const plain = lines.map(stripVTControlCharacters);
	expect(plain[0]).toMatch(/^╭.*╮$/);
	expect(plain.at(-1)).toMatch(/^╰.*╯$/);
	for (const line of plain.slice(1, -1)) expect(line).toMatch(/^│.*│$/);
	for (const line of lines) expect(visibleWidth(line)).toBe(width);
}

describe("Sakura rounded editor frame", () => {
	it.each(["auto", "nerd"])("joins corners and rails in %s icon mode", (mode) => {
		const config = mergeConfig({ icons: { mode } }, {});
		const snapshot = structuredClone(config);
		const lines = render(60, config);
		expectClosedFrame(lines, 60);
		expect(lines.map(stripVTControlCharacters).join("\n")).toContain("gpt-6-astra  OpenAI  high");
		expect(config).toEqual(snapshot);
	});

	it.each([3, 4, 5, 16, 30, 80, 140])("keeps corners inside a %i-column viewport", (width) => {
		expectClosedFrame(
			render(width, undefined, {
				editorLines: ["中文输入 👩‍💻", "second line"],
				viewport: { above: "123", below: "45" },
			}),
			width,
		);
	});

	it("preserves the cursor, completion payload, viewport labels and working label", () => {
		const config = mergeConfig({ components: { editor: { viewportIndicators: true } } }, {});
		config.components.editor.styles.opencode.completionMenu = "native";
		const lines = render(80, config, {
			editorLines: [`中文${CURSOR_MARKER}text`],
			autocompleteLines: ["completion payload"],
			viewport: { above: "12", below: "3" },
			workingLineFrame: "Working…",
		});
		expect(lines.at(-1)).toBe("completion payload");
		expectClosedFrame(lines.slice(0, -1), 80);
		expect(lines[2]).toContain(CURSOR_MARKER);
		const plain = lines.map(stripVTControlCharacters);
		expect(plain[0]).toContain("Working…");
		expect(plain[0]).toContain("↑ 12 more");
		expect(plain.at(-2)).toContain("↓ 3 more");
	});

	it("keeps the right corner even when a working label fills the border", () => {
		expectClosedFrame(
			render(16, undefined, {
				workingLineFrame: "a very long working label",
				viewport: { above: "12345" },
			}),
			16,
		);
	});

	it("does not change explicit ASCII, custom rails, copy-friendly or non-Sakura frames", () => {
		for (const config of [
			mergeConfig({ icons: { mode: "ascii" } }, {}),
			mergeConfig({ icons: { rail: ">" } }, {}),
			mergeConfig({ components: { editor: { style: "opencode-copy-friendly" } } }, {}),
			mergeConfig({ components: { editor: { colors: { border: "borderMuted" } } } }, {}),
		]) {
			expect(stripVTControlCharacters(render(60, config)[0] ?? "")).toBe("─".repeat(60));
		}
		expect(
			stripVTControlCharacters(
				render(60, undefined, {
					uiTheme: { ...theme, name: "dark" },
				})[0] ?? "",
			),
		).toBe("─".repeat(60));
	});

	it("fails open rather than nesting a copied predecessor frame", () => {
		const config = mergeConfig({}, {});
		const cached = render(60, config);
		const predecessor = {
			render: (_width: number) => [...cached],
			invalidate() {},
			handleInput() {},
			getText: () => "hello",
			setText() {},
		};
		const wrapped = new WrappedPolishedEditor(
			predecessor,
			theme,
			() => config,
			() => modelMeta,
			() => "high",
		);
		expect(wrapped.render(60)).toEqual(predecessor.render(60));
	});
});
