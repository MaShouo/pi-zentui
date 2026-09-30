import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { fgAnsi, getColorMode, type RGB, syncColorMode } from "../shared/color";

const SAKURA: RGB = [242, 167, 198];
const PEACH: RGB = [246, 188, 154];
const LAVENDER: RGB = [199, 184, 245];
const SKY: RGB = [159, 211, 242];
const LABEL = "◈  SAKURA CYBERDECK  ◈";
/** Fixed blank rows above the artwork. Deliberately independent of terminal height. */
export const TOP_PADDING = 1;

// Restore only the foreground and bold weight so whatever background is active around
// the header (theme, selection, host styles) survives. Never emit a full SGR reset.
const FG_RESET = "\x1b[39m";
const BOLD_ON = "\x1b[1m";
const BOLD_OFF = "\x1b[22m";

function gradient(text: string, from: RGB, to: RGB, bold = false): string {
	if (getColorMode() === "none") return text;
	const chars = [...text];
	if (chars.length === 0) return text;
	const span = Math.max(1, chars.length - 1);
	let rendered = "";
	for (let index = 0; index < chars.length; index++) {
		const char = chars[index] ?? "";
		if (char === " ") {
			rendered += char;
			continue;
		}
		const t = index / span;
		const color: RGB = [
			Math.round(from[0] + (to[0] - from[0]) * t),
			Math.round(from[1] + (to[1] - from[1]) * t),
			Math.round(from[2] + (to[2] - from[2]) * t),
		];
		rendered += `${fgAnsi(color)}${char}`;
	}
	return bold ? `${BOLD_ON}${rendered}${BOLD_OFF}${FG_RESET}` : `${rendered}${FG_RESET}`;
}

const ANIME_ART = [
	"⠀⠀⠂⠈⣿⣷⣿⣿⣿⡅⡹⢿⠆⠙⠋⠉⠻⠿⣿⣿⣿⣿⣿⣿⣮⠻⣦⡙⢷⡑⠘⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣌⠡⠌⠂⣙⠻⣛⠻⠷⠐⠈⠛⢱⣮⠁⠐⠀",
	"⠀⠂⠈⣿⡇⢿⢹⣿⣶⠐⠁⠀⣀⣠⣤⠄⠀⠀⠈⠙⠻⣿⣿⣿⣦⣵⣌⠻⣷⢝⠦⠚⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⢟⣻⣿⣊⡃⠀⣙⠿⣿⣿⣿⣎⢮⡀⢮⣽⠁⠐",
	"⠂⠈⣿⣿⣧⡸⡎⡛⡩⠖⠀⣴⣿⣿⣿⠀⠀⠀⠀⠸⠇⠀⠙⢿⣿⣿⣿⣷⣌⢷⣑⢷⣄⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⣫⠶⠛⠉⠀⠁⠀⠈⠈⠀⠠⠜⠻⣿⣆⢿⣼⣿⣿⠁",
	" ⠈⣿⣿⣿⣧⢧⣧⢻⣦⢀⣹⣿⣿⣿⣇⠀⠄⠀⠀⠀⡀⠀⠈⢻⣿⣿⣿⣿⣷⣝⢦⡹⠷⡙⢿⣿⣿⣿⣿⣿⣿⣿⣿⠈⠁⠀⠀⠀⠁⠀⠀⠀⠱⣶⣄⡀⠀⠈⠛⠜⣿⣿⣿⣿",
	"⠀⠊⢫⣿⣏⣿⡌⣼⣄⢫⡌⣿⣿⣿⣿⣿⣦⡈⠲⣄⣤⣤⡡⢀⣠⣿⣿⣿⣿⣿⣿⣷⣼⣍⢬⣦⡙⣿⣿⣿⣿⣿⣯⢁⡄⠀⡀⡀⠀⠄⢈⣠⢪⠀⣿⣿⣿⣦⠀⢉⢂⠹⡿⣿⣿",
	"⠀⠀⠄⢹⢃⢻⣟⠙⣿⣦⠱⢻⣿⣿⣿⣿⣿⣿⣷⣬⣍⣭⣥⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⡙⢿⣼⡿⣿⣿⣿⣿⣿⣷⣄⠘⣱⢦⣤⡴⡿⢈⣼⣿⣿⣿⣇⣴⣶⣮⣅⢻⣿⡏",
	"⠀⠀⠈⠹⣇⢡⢿⡆⠻⣿⣷⠀⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣍⡻⣿⣟⣻⣿⣿⣿⣿⣷⣦⣥⣬⣤⣴⣾⣿⣿⣿⣿⣷⣿⣿⣿⣿⣷⡜⠃",
	"⠀⠀⠀⢀⣘⠈⢂⠃⣧⡹⣿⣷⡄⠙⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣮⣅⡙⢿⣟⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠋⡕⠂",
	"⠀⠀⠀⠀⠀⠀⠛⢷⣜⢷⡌⠻⣿⣿⣦⣝⣻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣯⣹⣷⣦⣹⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠉⠃⠀",
] as const;

const ART_WIDTH = Math.max(...ANIME_ART.map((line) => visibleWidth(line)));

/** Centered left padding with an optical nudge, never pushing content past `width`. */
function centerPad(width: number, contentWidth: number, nudge = 0): string {
	const pad = Math.floor((width - contentWidth) / 2) + nudge;
	return " ".repeat(Math.max(0, Math.min(width - contentWidth, pad)));
}

/**
 * Clip uncolored text with pi-tui's ANSI/wide-char-safe helper. `truncateToWidth`
 * appends a full `\x1b[0m` reset when it cuts; drop it so we can paint afterwards
 * without clearing the surrounding background.
 */
function clipPlain(text: string, maxWidth: number, ellipsis = ""): string {
	return truncateToWidth(text, maxWidth, ellipsis).replace(/\x1b\[0m/g, "");
}

/**
 * Header lines. Every line fits within `width` display columns and the height is fixed:
 * it never depends on the terminal's row count.
 */
export function renderHeader(width: number): string[] {
	const w = Math.floor(width);
	if (!Number.isFinite(w) || w <= 0) return [];

	const artWidth = Math.min(w, ART_WIDTH);
	const artPad = centerPad(w, artWidth, -2);
	const art = ANIME_ART.map(
		(line) => `${artPad}${gradient(clipPlain(line, artWidth), SAKURA, SKY)}`,
	);

	// Keep the divider visually subordinate: inset it symmetrically from the artwork.
	const railInset = artWidth >= 8 ? Math.max(2, Math.round(artWidth * 0.15)) : 0;
	const railWidth = Math.max(1, artWidth - railInset * 2);
	const rail = `${centerPad(w, railWidth, 1)}${gradient("━".repeat(railWidth), SAKURA, SKY)}`;

	const label = gradient(clipPlain(LABEL, w, "…"), LAVENDER, PEACH, true);
	const labelLine = `${centerPad(w, visibleWidth(label), 1)}${label}`;

	return [...Array<string>(TOP_PADDING).fill(""), ...art, "", rail, labelLine, ""];
}

/** TUI-only guard: prefer the explicit mode, fall back to hasUI on older Pi hosts. */
export function isInteractiveTui(
	ctx: Pick<ExtensionContext, "mode" | "hasUI"> | undefined,
): boolean {
	if (!ctx) return false;
	return typeof ctx.mode === "string" ? ctx.mode === "tui" : ctx.hasUI === true;
}

export default function sakuraCyberdeckHeader(pi: ExtensionAPI): void {
	let installed = false;

	pi.on("session_start", (_event, ctx) => {
		if (!isInteractiveTui(ctx)) return;
		try {
			syncColorMode(ctx.ui.theme);
			let cachedKey = "";
			let cachedLines: string[] = [];
			const header = {
				render(width: number): string[] {
					// Key on width *and* color mode: a mode switch must repaint the SGR sequences.
					const key = `${width}:${getColorMode()}`;
					if (key !== cachedKey) {
						cachedLines = renderHeader(width);
						cachedKey = key;
					}
					return cachedLines;
				},
				invalidate(): void {
					cachedKey = "";
					try {
						// Follow the live theme (Pi calls invalidate on theme/color changes).
						syncColorMode(ctx.ui.theme);
					} catch {
						// Disposed or replaced context: keep the last known color mode.
					}
				},
			};
			ctx.ui.setHeader(() => header);
			installed = true;
		} catch {
			// Fail open: a broken setHeader must never break session startup, and we must
			// not claim ownership of a header we failed to install.
			installed = false;
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (!installed) return;
		installed = false;
		try {
			ctx.ui.setHeader(undefined);
		} catch {
			// UI may already be disposed.
		}
	});
}
