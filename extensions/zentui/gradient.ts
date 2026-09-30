import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { fgAnsi, getColorMode, paintFg } from "../shared/color";

export type RGB = readonly [number, number, number];

export const SAKURA_MACARON_GRADIENT = "sakura-macaron-gradient";

export function isSakuraMacaronGradient(value: string | undefined): boolean {
	return value === SAKURA_MACARON_GRADIENT;
}

export function isSakuraMacaronVisuals(
	value: string | undefined,
	theme?: { readonly name?: string },
): boolean {
	return value === undefined ? theme?.name === "sakura-macaron" : isSakuraMacaronGradient(value);
}

export const SAKURA_MACARON_STOPS: readonly RGB[] = [
	[242, 167, 198], // sakura pink  #F2A7C6
	[239, 195, 230], // petal        #EFC3E6
	[199, 184, 245], // lavender     #C7B8F5
	[159, 211, 242], // sky macaron  #9FD3F2
];

export const SAKURA_ERROR_RGB: RGB = [255, 107, 122]; // #FF6B7A
export const SAKURA_BORDER_RGB: RGB = [110, 88, 120]; // #6E5878
export const SAKURA_MUTED_RGB: RGB = [169, 155, 174]; // #A99BAE

const RESET = "\x1b[39m";
const GRADIENT_CACHE_LIMIT = 256;
/** LRU of static (phase 0) gradients; animated frames are never cached. */
const gradientCache = new Map<string, string>();
let gradientCacheMode = getColorMode();

/** Soft period for footer shimmer / pulse (ms). */
export const FOOTER_PULSE_PERIOD_MS = 1800;

export function mix(from: RGB, to: RGB, amount: number): RGB {
	const t = Math.max(0, Math.min(1, amount));
	return [
		Math.round(from[0] + (to[0] - from[0]) * t),
		Math.round(from[1] + (to[1] - from[1]) * t),
		Math.round(from[2] + (to[2] - from[2]) * t),
	];
}

/** Continuous 0..1 phase from wall clock. */
export function pulsePhase(now = Date.now(), periodMs = FOOTER_PULSE_PERIOD_MS): number {
	const p = periodMs > 0 ? periodMs : FOOTER_PULSE_PERIOD_MS;
	return (((now % p) + p) % p) / p;
}

export function sampleSakuraGradient(position: number, phase = 0): RGB {
	const stops = SAKURA_MACARON_STOPS;
	// Keep phase shimmer as a true 0..1 wrap; bare position=1 must hit the last stop
	// (do not use `1 % 1 === 0`, which snapped the right edge back to sakura).
	let normalized = Math.max(0, Math.min(1, position));
	if (phase !== 0) {
		normalized = (((normalized + phase) % 1) + 1) % 1;
	}
	const scaled = normalized * (stops.length - 1);
	const index = Math.min(stops.length - 2, Math.floor(scaled));
	const from = stops[index] ?? SAKURA_MACARON_STOPS[0] ?? [242, 167, 198];
	const to = stops[index + 1] ?? from;
	return mix(from, to, scaled - index);
}

const graphemeSegmenter =
	typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: undefined;

/** Split into user-perceived characters; ASCII fast path avoids the segmenter. */
export function splitGraphemes(text: string): string[] {
	if (/^[\x00-\x7f]*$/.test(text) || !graphemeSegmenter) return [...text];
	return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

function cacheGet(key: string): string | undefined {
	const mode = getColorMode();
	if (mode !== gradientCacheMode) {
		// A color-mode change invalidates every cached string (they embed SGR sequences).
		gradientCache.clear();
		gradientCacheMode = mode;
		return undefined;
	}
	const cached = gradientCache.get(key);
	if (cached !== undefined) {
		// Refresh recency (Map preserves insertion order).
		gradientCache.delete(key);
		gradientCache.set(key, cached);
	}
	return cached;
}

function cacheSet(key: string, value: string): void {
	if (gradientCache.size >= GRADIENT_CACHE_LIMIT) {
		const oldest = gradientCache.keys().next().value;
		if (oldest !== undefined) gradientCache.delete(oldest);
	}
	gradientCache.set(key, value);
}

/** Test helper: current number of cached gradient strings. */
export function gradientCacheSize(): number {
	return gradientCache.size;
}

/** Foreground-colored text that restores only the foreground afterwards. */
export function rgbForeground(color: RGB, text: string, bold = false): string {
	// Prefer fg/bold resets over a full SGR reset so surrounding theme styles can resume.
	const open = fgAnsi(color);
	if (!open) return text;
	return bold ? `\x1b[1m${open}${text}\x1b[22m\x1b[39m` : `${open}${text}\x1b[39m`;
}

function paintPositions(text: string, colorAt: (position: number) => RGB): string {
	if (getColorMode() === "none") return text;
	const chars = splitGraphemes(text);
	if (chars.length === 0) return text;
	const span = Math.max(1, chars.length - 1);
	let rendered = "";
	for (let index = 0; index < chars.length; index++) {
		const char = chars[index] ?? "";
		rendered += char === " " ? char : `${fgAnsi(colorAt(index / span))}${char}`;
	}
	return `${rendered}${RESET}`;
}

/** Render Sakura → sky gradient. Optional phase shifts the stops for shimmer. */
export function renderSakuraGradient(text: string, phase = 0): string {
	if (!text) return text;
	// Animated frames change every tick: never let them evict the static working set.
	if (phase !== 0) return paintPositions(text, (pos) => sampleSakuraGradient(pos, phase));
	const cached = cacheGet(text);
	if (cached !== undefined) return cached;
	const rendered = paintPositions(text, (pos) => sampleSakuraGradient(pos));
	cacheSet(text, rendered);
	return rendered;
}

/**
 * Box-frame gradient: sakura at BOTH ends, macaron spectrum through the middle.
 * Avoids the linear L→R look where the right corner jumps to sky cyan.
 */
export function renderSakuraFrameGradient(text: string): string {
	if (!text) return text;
	const cacheKey = `\0frame\0${text}`;
	const cached = cacheGet(cacheKey);
	if (cached !== undefined) return cached;
	const rendered = paintPositions(text, (pos) =>
		sampleSakuraGradient(pos <= 0.5 ? pos * 2 : (1 - pos) * 2),
	);
	cacheSet(cacheKey, rendered);
	return rendered;
}

/** Solid sakura stop — vertical rails / corners that must match the frame ends. */
export function renderSakuraSolid(text: string, position = 0): string {
	return rgbForeground(sampleSakuraGradient(position), text);
}

/** Context / quota fill palettes — stay macaron, shift with severity. */
export type GaugeTier = "normal" | "warning" | "error";

const GAUGE_STOPS: Record<GaugeTier, readonly RGB[]> = {
	// healthy: sakura → petal → lavender → sky
	normal: SAKURA_MACARON_STOPS,
	// warning: stay warm (peach → butter). Do NOT end on sakura or it looks "healthy".
	warning: [
		[252, 201, 185], // peach
		[248, 210, 160],
		[243, 217, 139], // butter
		[230, 190, 100], // deeper butter
	],
	// error: saturated red family, distinct from the sakura accent
	error: [[255, 135, 145], SAKURA_ERROR_RGB, [240, 90, 108]],
};

const GAUGE_TRACK: RGB = [180, 168, 184]; // soft lilac track, readable on light + dark

function sampleStops(stops: readonly RGB[], position: number, phase = 0): RGB {
	const n =
		phase === 0
			? Math.max(0, Math.min(1, position))
			: (((Math.max(0, Math.min(1, position)) + phase) % 1) + 1) % 1;
	const scaled = n * (stops.length - 1);
	const index = Math.min(stops.length - 2, Math.floor(scaled));
	const from = stops[index] ?? stops[0] ?? [242, 167, 198];
	const to = stops[index + 1] ?? from;
	return mix(from, to, scaled - index);
}

/**
 * Macaron gauge. Fill walks a tier palette; soft hotspot with phase.
 * Empty track is soft lilac (readable on light + dark).
 */
export function renderMacaronGauge(
	percent: number,
	width = 10,
	options: { ascii?: boolean; phase?: number; frame?: boolean; tier?: GaugeTier } = {},
): string {
	const cells = Math.max(1, Math.floor(width));
	const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
	const filled = Math.round((clamped / 100) * cells);
	const phase = options.phase ?? 0;
	const tier = options.tier ?? "normal";
	const stops = GAUGE_STOPS[tier] ?? GAUGE_STOPS.normal;
	const on = options.ascii ? "#" : "█";
	const off = options.ascii ? "-" : "░";
	const body: string[] = [];
	for (let i = 0; i < cells; i++) {
		if (i < filled) {
			let base: RGB;
			if (tier === "warning") {
				// solid butter — no pink end that looks "healthy" at high fill
				base = [243, 217, 139];
			} else if (tier === "error") {
				base = SAKURA_ERROR_RGB; // solid error red
			} else {
				const pos = cells <= 1 ? 0 : i / Math.max(1, filled - 1);
				base = sampleStops(stops, pos, phase * 0.2);
			}
			const wave = 0.5 + 0.5 * Math.sin((i / cells + phase) * Math.PI * 2);
			const lit = mix(base, [255, 252, 250], wave * 0.15);
			body.push(rgbForeground(lit, on));
		} else {
			// Soft track — not black-grey hole on light themes
			body.push(paintFg(GAUGE_TRACK, off));
		}
	}
	const bar = body.join("");
	if (options.frame === false) return bar;
	const edge = sampleStops(stops, phase === 0 ? 0 : phase, 0);
	return `${rgbForeground(edge, "▕")}${bar}${rgbForeground(edge, "▏")}`;
}

/** Full-width hairline that shimmers across the footer. */
export function renderGradientHairline(width: number, phase = 0, glyph = "━"): string {
	if (width <= 0) return "";
	const chars = glyph.repeat(width);
	return renderSakuraGradient(chars, phase);
}

/** Dim / brighten an RGB by mixing toward black or white. */
export function toneRgb(color: RGB, amount: number): RGB {
	if (amount >= 0) return mix(color, [255, 255, 255], Math.min(1, amount));
	return mix(color, [20, 16, 28], Math.min(1, -amount));
}

/**
 * Side rails + body. Always keep left/right chrome fully visible.
 * Never append "..." — outer truncate defaults to "..." and looks like junk on every row.
 */
export function renderBoxedLine(
	line: string,
	width: number,
	leftRail: string,
	rightRail: string,
): string {
	if (width <= 0) return "";
	const leftWidth = visibleWidth(leftRail);
	const rightWidth = visibleWidth(rightRail);
	// If rails alone exceed width, prefer left rail only.
	if (leftWidth + rightWidth > width) {
		return truncateToWidth(leftRail, width, "");
	}
	const innerWidth = Math.max(0, width - leftWidth - rightWidth);
	// Never use default truncate ellipsis ("...") — empty string only.
	// Also drop only a pure trailing ... marker from prior truncators (not mid-line).
	let plainish = line;
	if (/(?:…|\.\.\.)\s*$/u.test(plainish) && visibleWidth(plainish) >= innerWidth) {
		plainish = plainish.replace(/(?:…|\.\.\.)\s*$/u, "");
	}
	let content = truncateToWidth(plainish, innerWidth, "");
	// Hard-fit: SGR / width drift can leave content 1 cell over.
	let guard = 0;
	while (visibleWidth(content) > innerWidth && content.length > 0 && guard++ < 8) {
		content = truncateToWidth(content, Math.max(0, visibleWidth(content) - 1), "");
	}
	const pad = Math.max(0, innerWidth - visibleWidth(content));
	const out = `${leftRail}${content}${" ".repeat(pad)}${rightRail}`;
	// Final clamp without ellipsis if still over (should be rare).
	if (visibleWidth(out) > width) {
		return truncateToWidth(out, width, "");
	}
	return out;
}
