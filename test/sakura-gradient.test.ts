import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { mergeConfig } from "../extensions/zentui/config";
import { buildContextDisplayLabel } from "../extensions/zentui/format";
import {
	isSakuraMacaronVisuals,
	renderSakuraFrameGradient,
	renderSakuraGradient,
	SAKURA_MACARON_STOPS,
	sampleSakuraGradient,
} from "../extensions/zentui/gradient";

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
