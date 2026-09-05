import { BashExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { stripAnsi } from "../extensions/zentui/tool-body-polish";
import { installToolExecutionStyle } from "../extensions/zentui/tool-execution";

initTheme("dark", false);
const ui = { requestRender() {} } as TUI;

describe("Sakura Bash frame", () => {
	it.each([false, true])(
		"closes native !/!! frames (excluded: %s) without repainting output",
		(excluded) => {
			const bash = new BashExecutionComponent("ls", ui, excluded);
			const cleanup = installToolExecutionStyle(
				() => undefined,
				() => true,
			);
			try {
				bash.appendOutput(`${"─".repeat(12)}\n$ literal output\nRunning...\n中文🙂 end`);
				for (const [exitCode, cancelled, label] of [
					[undefined, false, "RUNNING"],
					[0, false, "COMPLETE"],
					[1, false, "FAILED"],
					[0, true, "CANCELLED"],
				] as const) {
					if (exitCode !== undefined) bash.setComplete(exitCode, cancelled);
					for (const width of [5, 24, 80]) {
						const lines = bash.render(width).map(stripAnsi);
						expect(lines[0]?.trim()).toBe("");
						expect(lines[1]).toMatch(/^╭.*╮$/);
						expect(lines.at(-1)).toMatch(/^╰─+╯$/);
						for (const line of lines.slice(1)) expect(visibleWidth(line)).toBe(width);
						for (const line of lines.slice(2, -1)) expect(line).toMatch(/^│.*│$/);
						if (width === 80) {
							expect(lines[1]).toContain(label);
							expect(lines.filter((line) => line.includes("BASH"))).toHaveLength(1);
							expect(lines.join("\n")).toContain("$ literal output");
							expect(lines.join("\n")).toContain("─".repeat(12));
							expect(lines.join("\n")).toContain("中文🙂 end");
						}
					}
				}
			} finally {
				bash.setComplete(0, false);
				cleanup();
			}
		},
	);

	it("keeps native expansion, disabled rendering, and cleanup", () => {
		const bash = new BashExecutionComponent("ls", ui);
		bash.appendOutput(Array.from({ length: 40 }, (_, i) => `file-${i}`).join("\n"));
		bash.setComplete(0, false);
		const native = bash.render(80);
		let enabled = true;
		const cleanup = installToolExecutionStyle(
			() => undefined,
			() => enabled,
		);
		try {
			expect(bash.render(80).join("\n")).not.toContain("file-0");
			bash.setExpanded(true);
			const expanded = bash.render(80).map(stripAnsi);
			for (let i = 0; i < 40; i++) expect(expanded.join("\n")).toContain(`file-${i}`);
			expect(expanded.at(-1)).toMatch(/^╰─+╯$/);
			bash.setExpanded(false);
			enabled = false;
			expect(bash.render(80)).toEqual(native);
		} finally {
			cleanup();
		}
		expect(bash.render(80)).toEqual(native);
	});
});
