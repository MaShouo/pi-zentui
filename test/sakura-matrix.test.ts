import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setColorMode } from "../extensions/shared/color";

const isolatedHome = vi.hoisted(() => {
	const fs = process.getBuiltinModule("node:fs");
	const os = process.getBuiltinModule("node:os");
	return fs.mkdtempSync(`${os.tmpdir()}/pi-sakura-matrix-`);
});

vi.mock("node:os", () => ({ homedir: () => isolatedHome }));

import sakuraMatrix, {
	createDrops,
	MATRIX_WIDGET_KEY,
	renderSakuraMatrix,
} from "../extensions/matrix/index";

type Handler = (event: unknown, context: unknown) => void | Promise<void>;

// The shared color mode is process-global: pin it so ANSI assertions stay stable.
beforeEach(() => setColorMode("truecolor"));
afterEach(() => setColorMode("truecolor"));

describe("Sakura Matrix renderer", () => {
	it("creates deterministic bounded drops and fixed-height ANSI frames", () => {
		const first = createDrops(72, 0.65, 4);
		const second = createDrops(72, 0.65, 4);

		expect(first).toEqual(second);
		expect(first.length).toBeGreaterThanOrEqual(8);
		expect(first.length).toBeLessThanOrEqual(36);
		expect(first.every((drop) => drop.x >= 0 && drop.x < 72 && drop.x % 2 === 0)).toBe(true);

		const frame = renderSakuraMatrix(72, 4, 1.25, "thinking", first);
		expect(frame).toHaveLength(4);
		expect(frame.every((line) => line.endsWith("\x1b[0m"))).toBe(true);
		expect(frame.join("")).toContain("\x1b[38;2;");
	});

	it("keeps every row inside the requested width and height", () => {
		for (const width of [1, 7, 40, 213]) {
			const drops = createDrops(width, 0.65, 4);
			const lines = renderSakuraMatrix(width, 4, 1.3, "working", drops);
			expect(lines).toHaveLength(4);
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("renders indexed colors in 256-color mode and no escapes under NO_COLOR", () => {
		const drops = createDrops(40, 0.65, 4);

		setColorMode("256color");
		const indexed = renderSakuraMatrix(40, 4, 1.3, "working", drops).join("");
		expect(indexed).toMatch(/\x1b\[38;5;\d+m/);
		expect(indexed).not.toContain("38;2;");

		setColorMode("none");
		const plain = renderSakuraMatrix(40, 4, 1.3, "working", drops).join("");
		expect(plain).not.toContain("\x1b[");
		expect(plain.length).toBeGreaterThan(0);
	});
});

describe("Sakura Matrix widget ownership", () => {
	it("installs and cleans up only an above-editor widget", async () => {
		const handlers = new Map<string, Handler[]>();
		const widgets: Array<[string, unknown, unknown]> = [];
		const setWorkingMessage = vi.fn();
		const setWorkingIndicator = vi.fn();

		sakuraMatrix({
			on(eventName: string, handler: Handler) {
				handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler]);
			},
			registerCommand() {},
		} as never);

		const context = {
			mode: "tui",
			ui: {
				setWidget(key: string, content: unknown, options: unknown) {
					widgets.push([key, content, options]);
				},
				setWorkingMessage,
				setWorkingIndicator,
			},
		};

		await handlers.get("agent_start")?.[0]?.({}, context);
		await handlers.get("agent_end")?.[0]?.({}, context);

		expect(widgets).toEqual([
			[MATRIX_WIDGET_KEY, expect.any(Function), { placement: "aboveEditor" }],
			[MATRIX_WIDGET_KEY, undefined, { placement: "aboveEditor" }],
		]);
		expect(setWorkingMessage).not.toHaveBeenCalled();
		expect(setWorkingIndicator).not.toHaveBeenCalled();
	});
});
