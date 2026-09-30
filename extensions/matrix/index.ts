import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getColorMode, paintFg, type RGB, syncColorMode } from "../shared/color";

export const MATRIX_WIDGET_KEY = "sakura-matrix";
export const CONFIG_PATH = join(homedir(), ".pi", "agent", "sakura-cyberdeck-matrix.json");
const PREVIEW_MS = 5_000;
const RESET = "\x1b[0m";
const GLYPHS = [..."01ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾗﾘﾙﾚﾛﾜﾝ"];
const BG: RGB = [20, 17, 26];
const TEXT: RGB = [247, 238, 248];
const CANDY: readonly RGB[] = [
	[242, 167, 198],
	[252, 201, 185],
	[239, 195, 230],
	[199, 184, 245],
	[159, 211, 242],
	[174, 229, 197],
];

type Timer = ReturnType<typeof setTimeout>;
export type MatrixPhase = "thinking" | "working" | "tool";

export interface MatrixConfig {
	enabled: boolean;
	fps: number;
	density: number;
	height: number;
}

export interface MatrixDrop {
	x: number;
	offset: number;
	speed: number;
	length: number;
	gap: number;
	seed: number;
	color: RGB;
}

export const LIMITS = {
	fps: { min: 8, max: 18 },
	density: { min: 0.45, max: 0.95 },
	height: { min: 3, max: 6 },
} as const;

export const DEFAULT_MATRIX_CONFIG: MatrixConfig = {
	enabled: true,
	fps: 10,
	density: 0.65,
	height: 4,
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function numberOr(value: unknown, fallback: number): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Normalize any parsed JSON into a valid config; unknown/invalid fields fall back to defaults. */
export function normalizeConfig(parsed: unknown): MatrixConfig {
	const raw = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_MATRIX_CONFIG.enabled,
		fps: Math.round(
			clamp(numberOr(raw.fps, DEFAULT_MATRIX_CONFIG.fps), LIMITS.fps.min, LIMITS.fps.max),
		),
		density:
			Math.round(
				clamp(
					numberOr(raw.density, DEFAULT_MATRIX_CONFIG.density),
					LIMITS.density.min,
					LIMITS.density.max,
				) * 100,
			) / 100,
		height: Math.round(
			clamp(
				numberOr(raw.height, DEFAULT_MATRIX_CONFIG.height),
				LIMITS.height.min,
				LIMITS.height.max,
			),
		),
	};
}

/** Reads config without ever rewriting the file; a corrupt file returns defaults plus an error. */
export function loadConfig(path: string = CONFIG_PATH): { config: MatrixConfig; error?: string } {
	try {
		if (!existsSync(path)) return { config: { ...DEFAULT_MATRIX_CONFIG } };
		return { config: normalizeConfig(JSON.parse(readFileSync(path, "utf8"))) };
	} catch (error) {
		return {
			config: { ...DEFAULT_MATRIX_CONFIG },
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Atomic write: temp file + rename, parent directory created on demand. Returns an error message. */
export function saveConfig(config: MatrixConfig, path: string = CONFIG_PATH): string | undefined {
	try {
		mkdirSync(dirname(path), { recursive: true });
		const tmp = `${path}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
		renameSync(tmp, path);
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

export type MatrixCommand =
	| { type: "status" }
	| { type: "help" }
	| { type: "on" }
	| { type: "off" }
	| { type: "preview" }
	| { type: "set"; key: "fps" | "density" | "height"; value: number }
	| { type: "invalid"; message: string };

export const HELP_TEXT = [
	"/sakura-matrix status        show current settings",
	"/sakura-matrix on | off      enable or disable the rain while the agent works",
	"/sakura-matrix preview       show the rain for 5 seconds",
	`/sakura-matrix fps N         frame rate (${LIMITS.fps.min}-${LIMITS.fps.max})`,
	`/sakura-matrix density N     column density (${LIMITS.density.min}-${LIMITS.density.max})`,
	`/sakura-matrix height N      rows (${LIMITS.height.min}-${LIMITS.height.max})`,
	"/sakura-matrix help          show this help",
].join("\n");

export function parseMatrixCommand(args: string): MatrixCommand {
	const [command = "", value] = args.trim().toLowerCase().split(/\s+/);
	switch (command) {
		case "":
		case "status":
			return { type: "status" };
		case "help":
		case "?":
			return { type: "help" };
		case "on":
		case "off":
		case "preview":
			return { type: command };
		case "fps":
		case "density":
		case "height": {
			const { min, max } = LIMITS[command];
			const parsed = Number(value);
			if (value === undefined || !Number.isFinite(parsed) || parsed < min || parsed > max) {
				return { type: "invalid", message: `Usage: /sakura-matrix ${command} <${min}-${max}>` };
			}
			const rounded = command === "density" ? Math.round(parsed * 100) / 100 : Math.round(parsed);
			return { type: "set", key: command, value: rounded };
		}
		default:
			return { type: "invalid", message: `Unknown subcommand "${command}".\n${HELP_TEXT}` };
	}
}

export function describeConfig(config: MatrixConfig): string {
	return `Sakura Matrix: ${config.enabled ? "on" : "off"} · ${config.fps} FPS · ${config.height} lines · density ${config.density}`;
}

function mulberry32(seed: number): () => number {
	let value = seed >>> 0;
	return () => {
		value += 0x6d2b79f5;
		let next = value;
		next = Math.imul(next ^ (next >>> 15), next | 1);
		next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
		return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
	};
}

function mix(from: RGB, to: RGB, amount: number): RGB {
	return [
		Math.round(from[0] + (to[0] - from[0]) * amount),
		Math.round(from[1] + (to[1] - from[1]) * amount),
		Math.round(from[2] + (to[2] - from[2]) * amount),
	];
}

function colorize(char: string, color: RGB, bold = false): string {
	if (getColorMode() === "none") return char;
	const painted = paintFg(color, char);
	return bold ? `\x1b[1m${painted}\x1b[22m` : painted;
}

function stableGlyph(seed: number, row: number, timeSlice: number): string {
	let hash = Math.imul(seed ^ (row + 17), 0x45d9f3b);
	hash = Math.imul(hash ^ timeSlice, 0x45d9f3b);
	hash ^= hash >>> 16;
	return GLYPHS[Math.abs(hash) % GLYPHS.length] ?? "0";
}

export function createDrops(width: number, density: number, height: number): MatrixDrop[] {
	const random = mulberry32((width * 2654435761) ^ 0x53414b55);
	const columns = Array.from({ length: Math.ceil(width / 2) }, (_, index) => index * 2);
	const active = columns.filter(() => random() < density);
	const selected = active.length >= 8 ? active : columns.slice(0, Math.min(columns.length, 8));
	return selected.slice(0, 96).map((x, index) => {
		const length = 3 + Math.floor(random() * 5);
		const gap = 1 + Math.floor(random() * 5);
		const cycle = height + length + gap;
		return {
			x,
			offset: random() * cycle,
			speed: 5.5 + random() * 7.5,
			length,
			gap,
			seed: Math.floor(random() * 0x7fffffff) ^ (index * 7919),
			color: CANDY[index % CANDY.length] ?? [242, 167, 198],
		};
	});
}

export function renderSakuraMatrix(
	width: number,
	height: number,
	elapsedSeconds: number,
	phase: MatrixPhase,
	drops: readonly MatrixDrop[],
): string[] {
	const safeWidth = Math.max(1, width);
	const safeHeight = clamp(Math.round(height), LIMITS.height.min, LIMITS.height.max);
	const grid: string[][] = Array.from({ length: safeHeight }, () => Array(safeWidth).fill(" "));
	const timeSlice = Math.floor(elapsedSeconds * 8);
	const phaseSpeed = phase === "tool" ? 1.12 : phase === "thinking" ? 1.06 : 1;

	for (const drop of drops) {
		const cycle = safeHeight + drop.length + drop.gap;
		const head = ((drop.offset + elapsedSeconds * drop.speed * phaseSpeed) % cycle) - drop.gap;
		for (let trail = 0; trail < drop.length; trail++) {
			const row = Math.floor(head - trail);
			if (row < 0 || row >= safeHeight || drop.x >= safeWidth) continue;
			const glyph = stableGlyph(drop.seed + trail * 97, row, timeSlice);
			const color =
				trail === 0
					? mix(drop.color, TEXT, 0.58)
					: trail === 1
						? drop.color
						: mix(drop.color, BG, clamp((trail - 1) * 0.16, 0, 0.72));
			const gridRow = grid[row];
			if (gridRow) gridRow[drop.x] = colorize(glyph, color, trail <= 1);
		}
	}

	const reset = getColorMode() === "none" ? "" : RESET;
	return grid.map((row) => `${row.join("")}${reset}`);
}

/** Animations and notices only belong in the interactive terminal UI; legacy hosts expose hasUI. */
export function isInteractiveTui(
	ctx: Pick<ExtensionContext, "mode" | "hasUI"> | undefined,
): boolean {
	if (!ctx) return false;
	return typeof ctx.mode === "string" ? ctx.mode === "tui" : ctx.hasUI === true;
}

export default function sakuraMatrixExtension(pi: ExtensionAPI): void {
	const loaded = loadConfig();
	const config = loaded.config;
	// A corrupt file keeps failing loudly and is never overwritten by a save.
	const configError = loaded.error;
	let configWarning = configError
		? `Sakura Matrix: could not read ${CONFIG_PATH} (${configError}); using defaults and refusing to overwrite it.`
		: undefined;
	let activeContext: ExtensionContext | undefined;
	let phase: MatrixPhase = "working";
	let active = false;
	let previewing = false;
	let timer: Timer | undefined;
	let previewTimer: Timer | undefined;
	let startedAt = 0;
	let nextDeadline = 0;
	let lastHostUpdateAt = 0;
	let frame = 0;
	let generation = 0;
	let requestRender: (() => void) | undefined;
	let cachedKey = "";
	let cachedLines: string[] = [];
	const dropsByWidth = new Map<number, MatrixDrop[]>();

	const invalidate = () => {
		cachedKey = "";
		cachedLines = [];
	};

	const component = {
		render(width: number): string[] {
			const safeWidth = Math.max(1, width);
			const key = `${safeWidth}:${config.height}:${frame}:${phase}:${getColorMode()}`;
			if (key === cachedKey) return cachedLines;
			let drops = dropsByWidth.get(safeWidth);
			if (!drops) {
				drops = createDrops(safeWidth, config.density, config.height);
				if (dropsByWidth.size >= 4) {
					dropsByWidth.delete(dropsByWidth.keys().next().value ?? safeWidth);
				}
				dropsByWidth.set(safeWidth, drops);
			}
			cachedLines = renderSakuraMatrix(
				safeWidth,
				config.height,
				Math.max(0, performance.now() - startedAt) / 1000,
				phase,
				drops,
			);
			cachedKey = key;
			return cachedLines;
		},
		invalidate(): void {
			try {
				if (activeContext) syncColorMode(activeContext.ui.theme);
			} catch {
				/* Disposed UI. */
			}
			dropsByWidth.clear();
			invalidate();
		},
	};

	const clearTimers = () => {
		if (timer) clearTimeout(timer);
		if (previewTimer) clearTimeout(previewTimer);
		timer = undefined;
		previewTimer = undefined;
	};

	const schedule = (token: number) => {
		if (!active || token !== generation) return;
		const frameMs = 1000 / config.fps;
		const now = performance.now();
		if (now - nextDeadline > frameMs * 3) nextDeadline = now;
		nextDeadline += frameMs;
		timer = setTimeout(
			() => {
				if (!active || token !== generation) return;
				frame += 1;
				invalidate();
				// Streaming/tool updates already trigger a host render; skip a redundant one.
				try {
					if (performance.now() - lastHostUpdateAt >= frameMs) requestRender?.();
				} catch {
					stop();
					return;
				}
				schedule(token);
			},
			Math.max(16, nextDeadline - performance.now()),
		);
		timer.unref?.();
	};

	const stop = () => {
		generation += 1;
		active = false;
		previewing = false;
		clearTimers();
		const ctx = activeContext;
		activeContext = undefined;
		requestRender = undefined;
		lastHostUpdateAt = 0;
		invalidate();
		if (!ctx) return;
		try {
			ctx.ui.setWidget(MATRIX_WIDGET_KEY, undefined, { placement: "aboveEditor" });
		} catch {
			// The UI may already be disposed during shutdown; cleanup stays idempotent.
		}
	};

	/** Starts the rain; returns false when it cannot run (non-TUI or disposed UI). */
	const start = (ctx: ExtensionContext, initialPhase: MatrixPhase = "working"): boolean => {
		stop();
		if (!isInteractiveTui(ctx)) return false;
		syncColorMode(ctx.ui.theme);
		activeContext = ctx;
		active = true;
		phase = initialPhase;
		frame = 0;
		startedAt = performance.now();
		nextDeadline = startedAt;
		lastHostUpdateAt = 0;
		dropsByWidth.clear();
		invalidate();
		const token = generation;
		try {
			ctx.ui.setWidget(
				MATRIX_WIDGET_KEY,
				(tui) => {
					requestRender = () => tui.requestRender();
					return component;
				},
				{ placement: "aboveEditor" },
			);
		} catch {
			stop();
			return false;
		}
		schedule(token);
		return true;
	};

	const noteHostUpdate = () => {
		lastHostUpdateAt = performance.now();
	};

	const setPhase = (next: MatrixPhase) => {
		noteHostUpdate();
		if (!active || phase === next) return;
		phase = next;
		frame += 1;
		invalidate();
	};

	const notify = (
		ctx: ExtensionContext,
		message: string,
		type: "info" | "warning" | "error" = "info",
	) => {
		try {
			ctx.ui.notify(message, type);
		} catch {
			// A disposed UI must not take down the command path.
		}
	};

	/**
	 * Persists `candidate` before any in-memory change is applied. On failure nothing changes,
	 * so the in-memory enabled flag can never disagree with the running rain.
	 */
	const writeConfig = (ctx: ExtensionContext, candidate: MatrixConfig, done: string): boolean => {
		const currentError = loadConfig().error;
		if (currentError) {
			notify(
				ctx,
				`Sakura Matrix: ${CONFIG_PATH} is not usable (${currentError}); refusing to overwrite it. Fix or remove the file first.`,
				"error",
			);
			return false;
		}
		const error = saveConfig(candidate);
		if (error) {
			notify(ctx, `Sakura Matrix: could not save settings (${error})`, "error");
			return false;
		}
		notify(ctx, done);
		return true;
	};

	pi.on("session_start", (_event, ctx) => {
		if (!isInteractiveTui(ctx)) return;
		syncColorMode(ctx.ui.theme);
		if (configWarning) {
			notify(ctx, configWarning, "warning");
			configWarning = undefined;
		}
	});

	pi.on("agent_start", (_event, ctx) => {
		if (config.enabled) start(ctx);
	});
	pi.on("agent_end", () => stop());
	pi.on("session_before_switch", () => stop());
	pi.on("session_shutdown", () => stop());

	pi.on("message_update", (event) => {
		noteHostUpdate();
		const streamEvent = event.assistantMessageEvent as { type?: string } | undefined;
		if (!streamEvent?.type) return;
		if (streamEvent.type === "thinking_start" || streamEvent.type === "thinking_delta") {
			setPhase("thinking");
		} else if (streamEvent.type === "thinking_end" || streamEvent.type === "text_delta") {
			setPhase("working");
		}
	});

	pi.on("tool_execution_start", () => setPhase("tool"));
	pi.on("tool_execution_update", () => noteHostUpdate());
	pi.on("tool_execution_end", () => setPhase("working"));

	pi.registerCommand("sakura-matrix", {
		description:
			"Sakura Matrix rain: status | help | on | off | preview | fps N | density N | height N",
		handler: async (args, ctx) => {
			const command = parseMatrixCommand(args ?? "");
			switch (command.type) {
				case "status":
					notify(ctx, describeConfig(config));
					return;
				case "help":
					notify(ctx, HELP_TEXT);
					return;
				case "invalid":
					notify(ctx, command.message, "error");
					return;
				case "on":
					// Persist first: a failed save must not leave enabled=true in memory.
					if (writeConfig(ctx, { ...config, enabled: true }, "Sakura Matrix enabled")) {
						config.enabled = true;
						if ((!active || previewing) && !ctx.isIdle()) start(ctx);
					}
					return;
				case "off":
					if (writeConfig(ctx, { ...config, enabled: false }, "Sakura Matrix disabled")) {
						config.enabled = false;
						stop();
					}
					return;
				case "set": {
					const candidate = { ...config, [command.key]: command.value };
					if (writeConfig(ctx, candidate, describeConfig(candidate))) {
						config[command.key] = command.value;
						dropsByWidth.clear();
						invalidate();
					}
					return;
				}
				case "preview": {
					if (!isInteractiveTui(ctx)) {
						notify(ctx, "Sakura Matrix preview needs the interactive terminal UI", "warning");
						return;
					}
					// Already raining (normal run or an earlier preview): just say so instead of
					// starting a 5s timer that would cut a real run short.
					if (active) {
						notify(ctx, "Sakura Matrix is already running");
						return;
					}
					if (!start(ctx, "thinking")) {
						notify(ctx, "Sakura Matrix preview could not start", "warning");
						return;
					}
					previewing = true;
					const token = generation;
					previewTimer = setTimeout(() => {
						if (generation === token && previewing) stop();
					}, PREVIEW_MS);
					previewTimer.unref?.();
					notify(ctx, "Sakura Matrix preview: 5 seconds");
					return;
				}
			}
		},
	});
}
