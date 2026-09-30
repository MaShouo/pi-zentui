import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import {
	bgAnsi,
	detectColorMode,
	fgAnsi,
	getColorMode,
	hexToRgb,
	paintFg,
	rgbTo256,
	setColorMode,
	syncColorMode,
} from "../extensions/shared/color";

// The shared mode is process-global: always restore it so a later file cannot inherit "none".
afterEach(() => setColorMode("truecolor"));

function withNoColor<T>(value: string | undefined, run: () => T): T {
	const saved = process.env.NO_COLOR;
	if (value === undefined) delete process.env.NO_COLOR;
	else process.env.NO_COLOR = value;
	try {
		return run();
	} finally {
		if (saved === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = saved;
	}
}

test("detectColorMode honors NO_COLOR, COLORTERM and falls back to 256 colors", () => {
	assert.equal(detectColorMode({ NO_COLOR: "1", COLORTERM: "truecolor" }), "none");
	assert.equal(detectColorMode({ COLORTERM: "truecolor" }), "truecolor");
	assert.equal(
		detectColorMode({ TERM_PROGRAM: "Apple_Terminal", TERM: "xterm-256color" }),
		"256color",
	);
	assert.equal(detectColorMode({ TERM: "xterm-direct" }), "truecolor");
});

test("fg/bg sequences follow the explicit color mode", () => {
	assert.equal(fgAnsi([242, 167, 198], "truecolor"), "\x1b[38;2;242;167;198m");
	assert.match(fgAnsi([242, 167, 198], "256color"), /^\x1b\[38;5;\d+m$/);
	assert.equal(bgAnsi([0, 0, 0], "none"), "");
	assert.equal(paintFg([1, 2, 3], "x", "none"), "x");
	assert.equal(fgAnsi([1, 2, 3], "none"), "");
});

test("rgbTo256 maps primaries and grays sensibly", () => {
	assert.equal(rgbTo256([255, 0, 0]), 196);
	assert.equal(rgbTo256([0, 0, 0]), 16);
	assert.equal(rgbTo256([128, 128, 128]), 244);
});

test("setColorMode drives the default used by fgAnsi/paintFg", () => {
	setColorMode("256color");
	assert.match(fgAnsi([1, 2, 3]), /^\x1b\[38;5;\d+m$/);
	setColorMode("none");
	assert.equal(fgAnsi([1, 2, 3]), "");
	assert.equal(paintFg([1, 2, 3], "x"), "x");
	setColorMode("truecolor");
	assert.equal(getColorMode(), "truecolor");
});

test("syncColorMode adopts Pi's theme mode and NO_COLOR still wins", () => {
	withNoColor(undefined, () => {
		assert.equal(syncColorMode({ getColorMode: () => "256color" }), "256color");
		assert.equal(syncColorMode({ getColorMode: () => "truecolor" }), "truecolor");
	});
	withNoColor("1", () => {
		// NO_COLOR beats whatever the host theme claims.
		assert.equal(syncColorMode({ getColorMode: () => "truecolor" }), "none");
	});
});

test("syncColorMode fails open when the host theme probe throws", () => {
	withNoColor(undefined, () => {
		const detected = detectColorMode();
		assert.equal(
			syncColorMode({
				getColorMode: () => {
					throw new Error("host theme blew up");
				},
			}),
			detected,
		);
		assert.equal(getColorMode(), detected);
	});
});

test("hexToRgb parses short and long forms", () => {
	assert.deepEqual(hexToRgb("#f2a7c6"), [242, 167, 198]);
	assert.deepEqual(hexToRgb("fff"), [255, 255, 255]);
});
