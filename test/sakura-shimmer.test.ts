import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import {
	colorSweep,
	estimateOutputTokens,
	estimateTextTokens,
	fitWorkingMessage,
	formatActiveSubagentStatus,
	formatTokenCount,
	getSubagentStatusLabel,
	isSubagentToolName,
	reportedOutputTokens,
} from "../extensions/claude-shimmer/index";

import { paintFg, setColorMode } from "../extensions/shared/color";

afterEach(() => setColorMode("truecolor"));

describe("Sakura Claude Shimmer working status width", () => {
	const parts = { effort: "HIGH", tokens: "↓ ~128 tokens", elapsed: "00:12" };
	const renderStatus = (columns?: number) =>
		stripVTControlCharacters(fitWorkingMessage("✻", "Working...", parts, columns));

	it("retains the complete HUD when it fits, then drops effort and elapsed time", () => {
		expect(renderStatus(80)).toBe("✻ Working... ( HIGH · ↓ ~128 tokens · 00:12 )");
		expect(renderStatus(56)).toBe("✻ Working... ( ↓ ~128 tokens · 00:12 )");
		expect(renderStatus(49)).toBe("✻ Working... ( ↓ ~128 tokens )");
		expect(renderStatus(41)).toBe("✻ Working.… ( ↓ ~128 tokens )");
	});

	it("keeps only the spinner and truncated status when even the token HUD cannot fit", () => {
		expect(renderStatus(22)).toBe("✻ Working…");
		expect(renderStatus(13)).toBe("✻");
		for (const columns of [-1, 0, 1, 12]) expect(renderStatus(columns)).toBe("");
	});

	it("uses an 80-column fallback when terminal width is unavailable or invalid", () => {
		expect(renderStatus()).toBe(renderStatus(80));
		expect(renderStatus(Number.NaN)).toBe(renderStatus(80));
		expect(renderStatus(Number.POSITIVE_INFINITY)).toBe(renderStatus(80));
	});

	it("keeps tokens and time when no effort tag is available", () => {
		expect(
			stripVTControlCharacters(
				fitWorkingMessage("✻", "Working...", { ...parts, effort: undefined }, 50),
			),
		).toBe("✻ Working... ( ↓ ~128 tokens · 00:12 )");
	});

	it.each(["truecolor", "256color", "none"] as const)(
		"fits ANSI and wide grapheme labels at every width in %s mode",
		(mode) => {
			setColorMode(mode);
			const glyph = paintFg([255, 143, 163], "✻");
			const text = colorSweep("Subagents (2): 检查中文 👩‍💻 é · 审阅结果 🇨🇳", 5, false);
			const coloredParts = {
				effort: paintFg([255, 143, 163], parts.effort),
				tokens: paintFg([153, 200, 255], parts.tokens),
				elapsed: parts.elapsed,
			};
			for (let columns = 0; columns <= 160; columns++) {
				const output = fitWorkingMessage(glyph, text, coloredParts, columns);
				const plain = stripVTControlCharacters(output);
				expect(visibleWidth(output)).toBeLessThanOrEqual(Math.max(0, columns - 12));
				expect(plain.isWellFormed()).toBe(true);
				if (plain.includes("↓")) {
					expect(plain).toMatch(/\( (?:HIGH · )?↓ ~128 tokens(?: · 00:12)? \)$/);
				}
				if (mode === "none") expect(output).not.toContain("\x1b");
			}
		},
	);
});

describe("Sakura Claude Shimmer token formatting", () => {
	it("formats singular, grouped, and compact token counts", () => {
		expect(formatTokenCount(1)).toBe("1 token");
		expect(formatTokenCount(1_234)).toBe("1.2k tokens");
		expect(formatTokenCount(-10)).toBe("0 tokens");
	});

	it("uses final provider usage only when zero output is confirmed", () => {
		expect(reportedOutputTokens({ usage: { output: 17 } })).toBe(17);
		expect(reportedOutputTokens({ usage: { output: 0 } })).toBeNull();
		expect(reportedOutputTokens({ usage: { output: 0, input: 42 } }, true)).toBe(0);
		expect(reportedOutputTokens({ usage: { output: -1 } }, true)).toBeNull();
	});

	it("estimates ASCII, CJK, emoji, thinking, and tool output", () => {
		expect(estimateTextTokens("abcd")).toBe(1);
		expect(estimateTextTokens("你好")).toBe(2);
		expect(estimateTextTokens("😀")).toBe(2);
		expect(
			estimateOutputTokens({
				content: [
					{ type: "text", text: "abcd" },
					{ type: "thinking", thinking: "你好" },
					{ type: "toolCall", name: "read", arguments: { path: "a.ts" } },
				],
			}),
		).toBeGreaterThanOrEqual(4);
	});

	it("recognizes official subagent tool names without matching ordinary agent tools", () => {
		expect(isSubagentToolName("subagent")).toBe(true);
		expect(isSubagentToolName("Sub Agents")).toBe(true);
		expect(isSubagentToolName("sub-agent")).toBe(true);
		expect(isSubagentToolName("agent")).toBe(false);
		expect(isSubagentToolName("research-agent")).toBe(false);
		expect(isSubagentToolName("subagent-helper")).toBe(false);
		expect(isSubagentToolName("subagent/run")).toBe(false);
	});

	it("extracts safe, bounded subagent labels from supported arguments", () => {
		expect(
			getSubagentStatusLabel("subagent", {
				agent: "scout\n",
				objective: "  map   the\ttool lifecycle  ",
			}),
		).toBe("scout: map the tool lifecycle");
		expect(getSubagentStatusLabel("subagents", { scope: "review tests" })).toBe("review tests");
		expect(getSubagentStatusLabel("read", { task: "not a subagent" })).toBeUndefined();
		expect(getSubagentStatusLabel("subagent", { task: ["invalid"] })).toBeUndefined();
		expect(getSubagentStatusLabel("subagent", { description: "x".repeat(200) })).toHaveLength(88);
	});

	it("formats parallel subagent statuses with a count and bounded useful labels", () => {
		expect(formatActiveSubagentStatus([])).toBeUndefined();
		expect(formatActiveSubagentStatus(["scout: inspect"])).toBe("Subagent: scout: inspect");
		expect(
			formatActiveSubagentStatus(["scout: inspect", "worker: implement", "tester: verify"]),
		).toBe("Subagents (3): scout: inspect · worker: implement +1");
		expect(formatActiveSubagentStatus(["x".repeat(88), "y".repeat(88)])).toHaveLength(128);
	});
});
