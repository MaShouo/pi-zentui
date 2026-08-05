import { describe, expect, it } from "vitest";
import {
	estimateOutputTokens,
	estimateTextTokens,
	formatTokenCount,
	reportedOutputTokens,
} from "../extensions/claude-shimmer/index";

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
});
