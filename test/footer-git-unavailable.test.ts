import { stripVTControlCharacters } from "node:util";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { expect, it } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState } from "../extensions/zentui/state";

it.each([
	{ format: "", compact: undefined, width: 48 },
	{
		format: `${"oversized".repeat(40)} $git_branch`,
		compact: "$git_branch $git_status",
		width: 48,
	},
	{ format: `${"oversized".repeat(40)} $git_branch`, compact: "$git_status", width: 48 },
	{ format: "$git_status", compact: "$git_branch $git_status", width: 200 },
	{ format: "$git_branch $git_status", compact: "$git_status", width: 200 },
])(
	"renders Git failure once in the active template ($width columns, $compact)",
	({ format, compact, width }) => {
		const config = structuredClone(defaultConfig);
		const starship = config.components.footer.styles.starship;
		starship.format = format;
		if (compact !== undefined) starship.compactFormat = compact;
		const state = createInitialState(emptyGitStatus());
		state.gitUnavailable = true;
		state.tokenLabel = "123456 input / 98765 output";
		let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
		installFooter(
			{
				cwd: "/repo/long-directory-name-to-force-compact",
				getContextUsage: () => ({ percent: 12, contextWindow: 200000 }),
				sessionManager: { getSessionName: () => undefined },
				ui: {
					setFooter(value: typeof factory) {
						factory = value;
					},
				},
			} as unknown as ExtensionContext,
			state,
			() => config,
			{ setRequestRender() {}, scheduleProjectRefresh() {} },
		);
		const footer = factory?.(
			{ requestRender() {} } as never,
			{ fg: (_: string, text: string) => text } as Theme,
			{ onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() } as never,
		);
		expect(footer).toBeDefined();
		try {
			const rows = footer?.render(width) ?? [];
			expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
			const text = stripVTControlCharacters(rows.join("\n"));
			expect(text.match(/\[git n\/a\]/g), text).toHaveLength(1);
			if (width < 200) expect(text).not.toContain("oversized");
		} finally {
			footer?.dispose?.();
		}
	},
);
