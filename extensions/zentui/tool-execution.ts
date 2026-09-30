import { stripVTControlCharacters as stripAnsi } from "node:util";
import {
	BashExecutionComponent,
	type Theme,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getColorMode, syncColorMode } from "../shared/color";
import {
	rgbForeground as paintFg,
	type RGB,
	SAKURA_BORDER_RGB,
	SAKURA_ERROR_RGB,
	SAKURA_MUTED_RGB,
} from "./gradient";
import { installPrototypePatch } from "./prototype-patch-registry";

/**
 * Tool card chrome: quiet border and status title + status rail around Pi's own tool rendering.
 *
 * Visible body lines are Pi's render output at `width - 3`, passed through byte-for-byte.
 * Collapsed cards show a bounded preview; expanding restores every native row without a cap.
 * Tools that draw their own shell
 * (`renderShell: "self"`, e.g. edit), image results, and hidden cards stay fully stock.
 */

type Cleanup = () => void;
type ToolStatus = "running" | "ok" | "error" | "cancelled";

/** Private ToolExecutionComponent fields read defensively (present in Pi 0.87.1 and 0.99.1). */
type ToolExecutionRuntime = {
	isPartial?: unknown;
	result?: { isError?: unknown; content?: unknown };
	toolName?: unknown;
	expanded?: unknown;
	setExpanded?: unknown;
	hideComponent?: unknown;
	getRenderShell?: unknown;
};

type MouseEventLike = {
	x: number;
	y: number;
	width: number;
	height: number;
	type?: string;
	button?: string;
};

type CardRender = {
	width: number;
	innerWidth: number;
	status: ToolStatus;
	expanded: boolean;
	// Color mode is part of the cache key: a mode switch must rebuild the frame.
	colorMode: string;
	/** Number of leading inner lines kept outside the frame (Pi's spacer row). */
	prefix: number;
	/** Exclusive native row index retained in the preview; the remaining rows are only hidden. */
	bodyEnd: number;
	inner: readonly string[];
	lines: string[];
};

// Theme-independent status hues (sakura-macaron.json roles): sky = running, mint = ok,
// coral = error, butter = cancelled (Pi's native Bash marks a user cancel as a warning, not a failure).
const STATUS_RGB: Record<ToolStatus, RGB> = {
	running: [159, 211, 242],
	ok: [174, 229, 197],
	error: SAKURA_ERROR_RGB,
	cancelled: [243, 217, 139],
};
const FRAME_RGB = SAKURA_BORDER_RGB;
const LEFT_RAIL = "┃ ";
const RIGHT_RAIL = "│";
const LEFT_COLUMNS = 2; // visible width of LEFT_RAIL
const RAIL_COLUMNS = 3; // visible width of LEFT_RAIL + RIGHT_RAIL
const MIN_WIDTH = 12;
export const TOOL_PREVIEW_ROWS = 8;

function toolStatus(runtime: ToolExecutionRuntime): ToolStatus | undefined {
	if (typeof runtime.isPartial !== "boolean") return undefined; // unknown shape: stay stock
	if (runtime.isPartial) return "running";
	return runtime.result?.isError === true ? "error" : "ok";
}

function hasImageResult(runtime: ToolExecutionRuntime): boolean {
	const content = runtime.result?.content;
	if (!Array.isArray(content)) return false;
	return content.some((item) => (item as { type?: unknown } | null)?.type === "image");
}

/** Stock rendering for shells we do not frame (self-rendered tools, images, hidden cards). */
function isFrameable(runtime: ToolExecutionRuntime): boolean {
	if (runtime.hideComponent === true) return false;
	if (typeof runtime.getRenderShell === "function") {
		try {
			if ((runtime.getRenderShell as () => unknown).call(runtime) === "self") return false;
		} catch {
			return false;
		}
	}
	return !hasImageResult(runtime);
}

function statusText(status: ToolStatus): string {
	if (status === "running") return "◆ Running";
	if (status === "error") return "× Failed";
	if (status === "cancelled") return "× Cancelled";
	return "✓ Complete";
}

/** Paint status independently from the quiet frame, including when the label is clipped. */
function statusFrame(status: ToolStatus, width: number): string {
	const label = statusText(status);
	const top = frameTop(label, width);
	const end = Math.min(3 + label.length, width - 1);
	const labelRgb =
		status === "error" || status === "cancelled" ? STATUS_RGB[status] : SAKURA_MUTED_RGB;
	return (
		paintFg(FRAME_RGB, top.slice(0, 3)) +
		paintFg(STATUS_RGB[status], top.slice(3, 4)) +
		paintFg(labelRgb, top.slice(4, end)) +
		paintFg(FRAME_RGB, top.slice(end))
	);
}

/** `╭─ label ───╮` fitted to exactly `width` cells (label clipped per character, no ellipsis). */
export function frameTop(label: string, width: number): string {
	if (width <= 1) return width === 1 ? "╭" : "";
	const inner = width - 2;
	let used = 0;
	let text = "";
	for (const char of `─ ${label} `) {
		const w = visibleWidth(char);
		if (used + w > inner) break;
		text += char;
		used += w;
	}
	return `╭${text}${"─".repeat(inner - used)}╮`;
}

export function frameBottom(width: number): string {
	if (width <= 1) return width === 1 ? "╰" : "";
	return `╰${"─".repeat(width - 2)}╯`;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	// Pi's Box/Text caches return the same string objects every frame, so this is an identity scan.
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function buildCard(
	inner: readonly string[],
	width: number,
	status: ToolStatus,
	collapse: boolean,
): { lines: string[]; prefix: number; bodyEnd: number } {
	const prefix = inner[0] === "" ? 1 : 0; // Pi's Spacer(1) row stays above the frame
	const left = paintFg(STATUS_RGB[status], LEFT_RAIL);
	const right = paintFg(FRAME_RGB, RIGHT_RAIL);
	const lines: string[] = inner.slice(0, prefix);
	lines.push(statusFrame(status, width));
	const bodyEnd = collapse ? Math.min(inner.length, prefix + TOOL_PREVIEW_ROWS) : inner.length;
	for (let i = prefix; i < bodyEnd; i++) lines.push(`${left}${inner[i]}${right}`);
	if (bodyEnd < inner.length) {
		const hint = truncateToWidth(
			`… ${inner.length - bodyEnd} more lines · expand`,
			width - RAIL_COLUMNS,
			"",
		);
		lines.push(
			`${left}${hint}${" ".repeat(Math.max(0, width - RAIL_COLUMNS - visibleWidth(hint)))}${right}`,
		);
	}
	lines.push(paintFg(FRAME_RGB, frameBottom(width)));
	return { lines, prefix, bodyEnd };
}

/**
 * Map a mouse event on the framed card back to Pi's own layout (inner width, rows without the
 * frame). Returns undefined for frame/rail cells.
 */
export function mapCardMouseEvent<T extends MouseEventLike>(
	event: T,
	card: CardRender,
): T | undefined {
	const { prefix, inner } = card;
	const bodyEnd = card.bodyEnd + 1; // exclusive rendered body row, before any preview hint
	let y: number;
	if (event.y < prefix) y = event.y;
	else if (event.y > prefix && event.y < bodyEnd) y = event.y - 1;
	else return undefined;
	const x = event.x - LEFT_COLUMNS;
	if (x < 0 || x >= card.innerWidth) return undefined; // rail cells
	return { ...event, y, x, width: card.innerWidth, height: inner.length };
}

export function installToolExecutionStyle(
	getTheme: () => Theme | undefined,
	isEnabled: () => boolean,
): Cleanup {
	const cards = new WeakMap<object, CardRender>();

	const cleanupRender = installPrototypePatch(
		ToolExecutionComponent.prototype,
		"render",
		"tool-execution-render",
		({ predecessor, receiver, args }) => {
			const width = args[0];
			const runtime = receiver as ToolExecutionRuntime;
			const status = toolStatus(runtime);
			if (
				!isEnabled() ||
				runtime.toolName === "edit" ||
				typeof width !== "number" ||
				width < MIN_WIDTH ||
				status === undefined ||
				!isFrameable(runtime)
			) {
				cards.delete(receiver as object);
				return Reflect.apply(predecessor, receiver, args);
			}

			const innerWidth = width - RAIL_COLUMNS;
			const inner = Reflect.apply(predecessor, receiver, [innerWidth, ...args.slice(1)]);
			if (
				!Array.isArray(inner) ||
				!inner.every((line) => typeof line === "string") ||
				inner.length === 0
			) {
				cards.delete(receiver as object);
				return inner;
			}

			const lines = inner as string[];
			if (
				lines.some(
					(line) =>
						visibleWidth(line) > innerWidth || line.includes("_G") || line.includes("]1337;File="),
				)
			) {
				cards.delete(receiver as object);
				return Reflect.apply(predecessor, receiver, args);
			}
			const expanded = runtime.expanded === true;
			// Keep the shared mode in step with the host theme (no owner/source coupling).
			syncColorMode(getTheme());
			const colorMode = getColorMode();
			const cached = cards.get(receiver as object);
			if (
				cached &&
				cached.width === width &&
				cached.status === status &&
				cached.expanded === expanded &&
				cached.colorMode === colorMode &&
				sameLines(cached.inner, lines)
			) {
				return cached.lines;
			}

			const card = buildCard(
				lines,
				width,
				status,
				runtime.expanded === false && typeof runtime.setExpanded === "function",
			);
			cards.set(receiver as object, {
				width,
				innerWidth,
				status,
				expanded,
				colorMode,
				prefix: card.prefix,
				bodyEnd: card.bodyEnd,
				inner: lines,
				lines: card.lines,
			});
			return card.lines;
		},
	);

	// Fullscreen click-to-expand: Pi hit-tests with its own row/column layout, so translate
	// events from the framed card back to it (skip the title row, strip the rail columns).
	let cleanupMouse: Cleanup | undefined;
	let cleanupBash: Cleanup | undefined;
	try {
		if (typeof ToolExecutionComponent.prototype.handleMouse === "function")
			cleanupMouse = installPrototypePatch(
				ToolExecutionComponent.prototype,
				"handleMouse",
				"tool-execution-mouse",
				({ predecessor, receiver, args }) => {
					const event = args[0] as MouseEventLike | undefined;
					const card = cards.get(receiver as object);
					if (
						!isEnabled() ||
						!card ||
						!event ||
						typeof event.x !== "number" ||
						typeof event.y !== "number" ||
						event.width !== card.width
					) {
						return Reflect.apply(predecessor, receiver, args);
					}
					// The preview hint has no native counterpart. Expand through Pi's own state
					// transition; never forward it as a click on a hidden output row.
					if (card.bodyEnd < card.inner.length && event.y === card.bodyEnd + 1) {
						const runtime = receiver as ToolExecutionRuntime;
						if (
							event.type === "click" &&
							event.button === "left" &&
							event.x >= LEFT_COLUMNS &&
							event.x < LEFT_COLUMNS + card.innerWidth &&
							typeof runtime.setExpanded === "function"
						) {
							runtime.setExpanded(true);
							cards.delete(receiver as object);
							return { handled: true, render: true };
						}
						return undefined;
					}
					const mapped = mapCardMouseEvent(event, card);
					if (!mapped) return undefined;
					return Reflect.apply(predecessor, receiver, [mapped, ...args.slice(1)]);
				},
			);

		// Bash uses its own component — share status chrome, keep streaming body.
		cleanupBash = installPrototypePatch(
			BashExecutionComponent.prototype,
			"render",
			"bash-execution-render",
			({ predecessor, receiver, args }) => {
				const width = args[0];
				if (!isEnabled() || typeof width !== "number" || width < MIN_WIDTH) {
					return Reflect.apply(predecessor, receiver, args);
				}
				// Reserve side rails before Pi wraps output; let Pi own collapse/expand.
				const rendered = Reflect.apply(predecessor, receiver, [
					width - RAIL_COLUMNS,
					...args.slice(1),
				]);
				if (!Array.isArray(rendered) || !rendered.every((line) => typeof line === "string")) {
					return rendered;
				}
				const lines = rendered as string[];
				// Very narrow native components may exceed their requested width. Do not crop content.
				if (lines.some((line) => visibleWidth(line) > width - RAIL_COLUMNS)) {
					return Reflect.apply(predecessor, receiver, args);
				}
				const plains = lines.map(stripAnsi);
				const top = plains.findIndex((line) => line.trim() !== "");
				const bottom = plains.findLastIndex((line) => line.trim() !== "");
				// Native DynamicBorder uses identical horizontal rules at both ends.
				// Only replace outer borders, never border-like command output.
				if (
					top < 0 ||
					bottom <= top ||
					!/^([─═]+|[╭┌╔].*[╮┐╗])$/.test(plains[top]?.trim() ?? "") ||
					!/^([─═]+|[╰└╚].*[╯┘╝])$/.test(plains[bottom]?.trim() ?? "")
				) {
					return Reflect.apply(predecessor, receiver, args);
				}
				const status = (receiver as { status?: string }).status;
				if (!["running", "error", "cancelled", "complete"].includes(status ?? "")) {
					return Reflect.apply(predecessor, receiver, args);
				}
				const cardStatus: ToolStatus =
					status === "running" || status === "error" || status === "cancelled" ? status : "ok";
				syncColorMode(getTheme());
				const left = paintFg(STATUS_RGB[cardStatus], LEFT_RAIL);
				const right = paintFg(FRAME_RGB, RIGHT_RAIL);
				return lines.map((line, index) => {
					if (index < top || index > bottom) return line;
					if (index === top) return statusFrame(cardStatus, width);
					if (index === bottom) return paintFg(FRAME_RGB, frameBottom(width));
					// Preserve native ANSI, indentation and content; the predecessor wrapped at width - RAIL_COLUMNS.
					return `${left}${line}${" ".repeat(Math.max(0, width - RAIL_COLUMNS - visibleWidth(line)))}${right}`;
				});
			},
		);
	} catch (error) {
		cleanupMouse?.();
		cleanupRender();
		throw error;
	}
	return () => {
		cleanupBash?.();
		cleanupMouse?.();
		cleanupRender();
	};
}
