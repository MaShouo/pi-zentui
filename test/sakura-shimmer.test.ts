import { describe, expect, it } from "vitest";
import {
	estimateOutputTokens,
	estimateTextTokens,
	formatActiveSubagentStatus,
	formatTokenCount,
	getSubagentStatusLabel,
	isSubagentToolName,
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
