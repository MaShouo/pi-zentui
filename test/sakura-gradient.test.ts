import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setColorMode } from "../extensions/shared/color";
import { mergeConfig } from "../extensions/zentui/config";
import { buildContextDisplayLabel } from "../extensions/zentui/format";
import {
	gradientCacheSize,
	isSakuraMacaronVisuals,
	renderMacaronGauge,
	renderSakuraFrameGradient,
	renderSakuraGradient,
	renderSakuraSolid,
	rgbForeground,
	SAKURA_MACARON_STOPS,
	sampleSakuraGradient,
	splitGraphemes,
} from "../extensions/zentui/gradient";

// Pin the shared color mode: these assertions must not depend on the ambient terminal env.
beforeEach(() => setColorMode("truecolor"));
afterEach(() => setColorMode("truecolor"));

describe("Sakura gradient", () => {
	it("preserves display width and reaches both linear endpoints", () => {
		const rendered = renderSakuraGradient("abc");
		expect(visibleWidth(rendered)).toBe(3);
		expect(rendered).toContain("\x1b[38;2;242;167;198ma");
		expect(rendered).toContain("\x1b[38;2;159;211;242mc");
		expect(sampleSakuraGradient(0)).toEqual(SAKURA_MACARON_STOPS[0]);
		expect(sampleSakuraGradient(1)).toEqual(SAKURA_MACARON_STOPS.at(-1));
	});

	it("accepts the gradient marker as an explicit color configuration", () => {
		expect(
			mergeConfig({ colors: { editorBorder: "sakura-macaron-gradient" } }).colors.editorBorder,
		).toBe("sakura-macaron-gradient");
	});

	it("activates from the bundled theme name or an explicit marker", () => {
		expect(isSakuraMacaronVisuals(undefined, { name: "sakura-macaron" })).toBe(true);
		expect(isSakuraMacaronVisuals("sakura-macaron-gradient", { name: "dark" })).toBe(true);
		expect(isSakuraMacaronVisuals("borderMuted", { name: "sakura-macaron" })).toBe(false);
		expect(isSakuraMacaronVisuals(undefined, { name: "dark" })).toBe(false);
	});

	it("renders a width-stable macaron context gauge", () => {
		const rendered = buildContextDisplayLabel({
			percent: 75,
			contextWindow: 100_000,
			style: "text+gauge",
			sakura: true,
			phase: 0.25,
			tier: "warning",
		});
		expect(rendered).toContain("\x1b[38;2;");
		expect(visibleWidth(rendered)).toBe(21);
		expect(rendered).toContain("75%/100k");
	});

	it("returns the sakura color to both frame edges", () => {
		const rendered = renderSakuraFrameGradient("-----");
		expect(visibleWidth(rendered)).toBe(5);
		expect(rendered.startsWith("\x1b[38;2;242;167;198m-")).toBe(true);
		expect(rendered).toContain("\x1b[38;2;242;167;198m-");
	});
});

const TECHNOLOGIST = "\u{1F469}\u200D\u{1F4BB}";
const E_ACUTE = "e\u0301";

describe("Sakura gradient graphemes and cache", () => {
	it("splits into user-perceived characters, not code points", () => {
		expect(splitGraphemes("abc")).toEqual(["a", "b", "c"]);
		expect(splitGraphemes(`${TECHNOLOGIST}${E_ACUTE}`)).toEqual([TECHNOLOGIST, E_ACUTE]);
	});

	it("paints emoji and combining clusters as single units", () => {
		const rendered = renderSakuraGradient(`${TECHNOLOGIST}${E_ACUTE}x`);
		expect(rendered).toContain(TECHNOLOGIST);
		expect(rendered).toContain(E_ACUTE);
		// One color open per grapheme (3), not per code point (5).
		expect(rendered.match(/\x1b\[38;2;/g)?.length).toBe(3);
	});

	it("caches static renders but never animated frames", () => {
		const key = "static-cache-probe";
		const first = renderSakuraGradient(key);
		expect(renderSakuraGradient(key)).toBe(first);
		const size = gradientCacheSize();
		for (let frame = 1; frame < 400; frame++) renderSakuraGradient(key, frame / 400);
		expect(gradientCacheSize()).toBe(size);
		expect(renderSakuraGradient(key)).toBe(first);
	});

	it("invalidates cached gradients when the color mode changes", () => {
		const key = "mode-switch-probe";
		expect(renderSakuraGradient(key)).toMatch(/\x1b\[38;2;/);
		setColorMode("256color");
		const indexed = renderSakuraGradient(key);
		expect(indexed).toMatch(/\x1b\[38;5;\d+m/);
		expect(indexed).not.toContain("38;2;");
		setColorMode("truecolor");
		expect(renderSakuraGradient(key)).toMatch(/\x1b\[38;2;/);
	});
});

describe("Sakura gradient color modes", () => {
	it("uses indexed foreground in 256-color mode", () => {
		setColorMode("256color");
		const gradient = renderSakuraGradient("abc");
		expect(gradient).toMatch(/\x1b\[38;5;\d+m/);
		expect(gradient).not.toContain("38;2;");
		expect(renderSakuraSolid("│")).toMatch(/^\x1b\[38;5;\d+m│\x1b\[39m$/);
		const gauge = renderMacaronGauge(50, 6);
		expect(gauge).toMatch(/\x1b\[38;5;\d+m█/);
		expect(gauge).not.toContain("38;2;");
	});

	it("emits no color under NO_COLOR for gradient, solid and gauge", () => {
		setColorMode("none");
		expect(renderSakuraGradient("abc")).toBe("abc");
		expect(renderSakuraFrameGradient("-----")).toBe("-----");
		expect(renderSakuraSolid("│")).toBe("│");
		const gauge = renderMacaronGauge(50, 8);
		expect(gauge).not.toContain("\x1b[");
		expect(gauge).toContain("█");
		expect(gauge).toContain("░");
	});

	it("keeps fg/bold resets narrow so surrounding styles resume", () => {
		const plain = rgbForeground([1, 2, 3], "x");
		expect(plain).toBe("\x1b[38;2;1;2;3mx\x1b[39m");
		expect(plain.endsWith("\x1b[0m")).toBe(false);
		const bold = rgbForeground([1, 2, 3], "x", true);
		expect(bold).toBe("\x1b[1m\x1b[38;2;1;2;3mx\x1b[22m\x1b[39m");
		// The gauge relies on per-cell fg resets, never a full SGR reset.
		expect(renderMacaronGauge(60, 6)).not.toContain("\x1b[0m");
	});
});

it("uses only the monotonic pink-to-sky stops", () => {
	expect(SAKURA_MACARON_STOPS).toEqual([
		[242, 167, 198],
		[239, 195, 230],
		[199, 184, 245],
		[159, 211, 242],
	]);
});
