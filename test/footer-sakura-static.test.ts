import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setColorMode } from "../extensions/shared/color";
import { mergeConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState } from "../extensions/zentui/state";

afterEach(() => {
	vi.useRealTimers();
	setColorMode("truecolor");
});

describe.each(["truecolor", "256color", "none"] as const)("static Sakura Footer (%s)", (mode) => {
	it.each([42, 75, 95])("is byte-stable across time at %s%% context", (percent) => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		setColorMode(mode);
		const config = mergeConfig({
			icons: { mode: "nerd" },
			components: {
				footer: {
					styles: {
						starship: {
							responsive: true,
							compactFormat: "$cwd $context",
							segments: { time: false, sessionDuration: false },
						},
					},
				},
			},
		});
		const state = createInitialState(emptyGitStatus());
		state.branch = "main";
		let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
		installFooter(
			{
				cwd: "/repo/sakura",
				getContextUsage: () => ({ percent, contextWindow: 100_000 }),
				sessionManager: { getSessionName: () => "" },
				ui: {
					setFooter(value: typeof factory) {
						factory = value;
					},
				},
			} as unknown as ExtensionContext,
			state,
			() => config,
			{
				setRequestRender() {},
				scheduleProjectRefresh() {},
			},
		);
		const footer = factory?.(
			{ requestRender() {} } as never,
			{
				name: "sakura-macaron",
				fg: (_color: string, text: string) => text,
			} as Theme,
			{
				onBranchChange: () => () => {},
				getExtensionStatuses: () => new Map(),
			} as never,
		);
		expect(footer).toBeDefined();
		try {
			for (const width of [40, 180]) {
				const first = footer?.render(width);
				expect(first?.join("\n")).toContain("sakura");
				expect(first?.join("\n")).toContain("█");
				for (const time of [117, 713, 1799, 2_501, 86_400_111]) {
					vi.setSystemTime(time);
					footer?.invalidate();
					expect(footer?.render(width)).toEqual(first);
				}
				if (mode === "none") expect(first?.join("\n")).not.toContain("\x1b[");
				else expect(first?.join("\n")).toContain(mode === "truecolor" ? "38;2;" : "38;5;");
			}
		} finally {
			footer?.dispose?.();
		}
	});
});
