import { readFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import {
	BashExecutionComponent,
	initTheme,
	type Theme,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fgAnsi, hexToRgb, paintFg, setColorMode } from "../extensions/shared/color";
import { mergeConfig } from "../extensions/zentui/config";
import {
	renderSakuraFrameGradient,
	SAKURA_BORDER_RGB,
	SAKURA_ERROR_RGB,
} from "../extensions/zentui/gradient";
import { patchSelectorBorderStyle } from "../extensions/zentui/selector-border";
import { installToolExecutionStyle } from "../extensions/zentui/tool-execution";
import { renderUserMessageStyle } from "../extensions/zentui/user-message-styles";

initTheme("dark", false);
afterEach(() => {
	vi.unstubAllEnvs();
	setColorMode("truecolor");
});

const ui = { requestRender() {} } as never;

describe.each(["truecolor", "256color", "none"] as const)(
	"Sakura visual hierarchy (%s)",
	(mode) => {
		it("uses identical status-only titles and rails for normal and Bash cards", () => {
			vi.stubEnv("NO_COLOR", mode === "none" ? "1" : "");
			const theme = { getColorMode: () => mode } as Theme;
			const cleanup = installToolExecutionStyle(
				() => theme,
				() => true,
			);
			const bash = new BashExecutionComponent("echo hello", ui);
			const tool = new ToolExecutionComponent(
				"read",
				"call",
				{},
				{},
				{
					renderCall: () => new Text("read path", 0, 0),
					renderResult: () => new Text("native body", 0, 0),
				},
				ui,
				"/tmp",
			);
			try {
				for (const [status, symbol, label, rgb] of [
					["running", "◆", "Running", [159, 211, 242]],
					["ok", "✓", "Complete", [174, 229, 197]],
					["error", "×", "Failed", SAKURA_ERROR_RGB],
				] as const) {
					if (status !== "running") {
						tool.updateResult(
							{ content: [{ type: "text", text: "done" }], isError: status === "error" },
							false,
						);
						bash.setComplete(status === "error" ? 1 : 0, false);
					}
					const normal = tool.render(60);
					const shell = bash.render(60);
					expect(shell[1]).toBe(normal[1]);
					for (const lines of [normal, shell]) {
						expect(lines[1]).toContain(paintFg(rgb, symbol));
						expect(stripVTControlCharacters(lines[1] ?? "")).toContain(`${symbol} ${label}`);
						expect(lines[1]).toContain(paintFg(SAKURA_BORDER_RGB, "╭─ "));
						expect(lines[2]?.startsWith(paintFg(rgb, "┃ "))).toBe(true);
						expect(lines[2]?.endsWith(paintFg(SAKURA_BORDER_RGB, "│"))).toBe(true);
						if (status === "error")
							expect(lines[1]).toContain(paintFg(SAKURA_ERROR_RGB, " Failed"));
						if (mode === "none") expect(lines[1]).not.toContain("\x1b[");
					}
				}
				// A user cancel is a warning (butter), matching Pi's native Bash, not a failure.
				const butter = [243, 217, 139] as const;
				bash.setComplete(0, true);
				const cancelled = bash.render(60);
				expect(cancelled[1]).toContain(paintFg(butter, "×"));
				expect(cancelled[1]).toContain(paintFg(butter, " Cancelled"));
				if (mode !== "none") expect(cancelled[1]).not.toContain(paintFg(SAKURA_ERROR_RGB, "×"));
				expect(cancelled[2]?.startsWith(paintFg(butter, "┃ "))).toBe(true);
			} finally {
				bash.setComplete(0, false);
				cleanup();
			}
		});

		it("keeps gradient message frames while subduing selector borders", () => {
			setColorMode(mode);
			const config = mergeConfig({ icons: { mode: "nerd" } });
			const snapshot = structuredClone(config);
			const theme = { name: "sakura-macaron", fg: (_color: string, text: string) => text } as Theme;
			const lines = renderUserMessageStyle({ text: "hello", width: 30, theme, config });
			expect(lines[0]).toBe(renderSakuraFrameGradient(`╭${"─".repeat(28)}╮`));
			expect(lines.at(-1)).toBe(renderSakuraFrameGradient(`╰${"─".repeat(28)}╯`));
			expect(lines[1]?.endsWith(renderSakuraFrameGradient("│"))).toBe(true);
			const quietRule = paintFg(SAKURA_BORDER_RGB, "─".repeat(30));
			if (mode !== "none") expect(lines[0]).not.toBe(quietRule);
			const selector = {
				render: (width: number) => ["─".repeat(width), "native body", "─".repeat(width)],
			};
			const native = selector.render;
			const cleanup = patchSelectorBorderStyle(
				selector,
				() => theme,
				() => config,
			);
			try {
				expect(selector.render(30)).toEqual([quietRule, "native body", quietRule]);
				expect(config).toEqual(snapshot);
				config.components.selectorBorders.colors = { border: "" };
				expect(selector.render(30)[0]).toBe("─".repeat(30));
			} finally {
				cleanup();
			}
			expect(selector.render).toBe(native);
			expect(fgAnsi(SAKURA_BORDER_RGB)).toEqual(
				mode === "none" ? "" : expect.stringContaining(mode === "truecolor" ? "38;2;" : "38;5;"),
			);
		});

		it("keeps gradients for an explicit sakura-macaron-gradient marker", () => {
			setColorMode(mode);
			const config = mergeConfig({
				icons: { mode: "nerd" },
				components: {
					userMessages: { colors: { border: "sakura-macaron-gradient" } },
					selectorBorders: { colors: { border: "sakura-macaron-gradient" } },
				},
			});
			// Another theme: only the explicit marker opts into Sakura visuals.
			const theme = { name: "dark", fg: (_color: string, text: string) => text } as Theme;
			const rule = renderSakuraFrameGradient("─".repeat(30));
			const lines = renderUserMessageStyle({ text: "hello", width: 30, theme, config });
			expect(lines[0]).toBe(renderSakuraFrameGradient(`╭${"─".repeat(28)}╮`));
			const selector = {
				render: (width: number) => ["─".repeat(width), "native body", "─".repeat(width)],
			};
			const cleanup = patchSelectorBorderStyle(
				selector,
				() => theme,
				() => config,
			);
			try {
				expect(selector.render(30)).toEqual([rule, "native body", rule]);
			} finally {
				cleanup();
			}
			if (mode !== "none") expect(rule).not.toBe(paintFg(SAKURA_BORDER_RGB, "─".repeat(30)));
		});
	},
);

it("keeps error red distinct from decorative rose and above WCAG 4.5 on the Sakura background", () => {
	const theme = JSON.parse(
		readFileSync(new URL("../themes/sakura-macaron.json", import.meta.url), "utf8"),
	);
	const error = hexToRgb(theme.vars[theme.colors.error]);
	expect(error).toEqual(SAKURA_ERROR_RGB);
	expect(theme.vars.rose).toBe("#FF8FA3");
	expect(theme.colors.thinkingMax).toBe("rose");
	expect(theme.colors.thinkingText).toBe("muted");
	const luminance = (rgb: readonly number[]) =>
		rgb.reduce((total, value, i) => {
			const c = value / 255;
			return (
				total +
				(c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) *
					([0.2126, 0.7152, 0.0722][i] ?? 0)
			);
		}, 0);
	const ratio = (luminance(error) + 0.05) / (luminance(hexToRgb(theme.vars.bg)) + 0.05);
	expect(ratio).toBeGreaterThanOrEqual(4.5);
});
