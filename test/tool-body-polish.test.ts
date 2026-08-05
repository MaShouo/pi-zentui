import { describe, expect, it } from "vitest";
import {
	beautifyToolBody,
	compactToolBody,
	stripAnsi,
} from "../extensions/zentui/tool-body-polish";

describe("Sakura tool body polish", () => {
	it("restyles diff rows and preserves their statistics", () => {
		const result = beautifyToolBody(["+12 added", "-7 removed", " 8 context"]);
		expect(result.stats).toEqual({ added: 1, removed: 1 });
		expect(result.lines.map(stripAnsi)).toEqual(["+12 added", "- 7 removed", "  8 context"]);
	});

	it("caps a collapsed large payload with an expansion affordance", () => {
		const body = Array.from({ length: 20 }, (_, index) => `line ${index}`);
		const compact = compactToolBody(body);
		expect(compact.length).toBeLessThan(body.length);
		expect(compact.map(stripAnsi).join("\n")).toContain("expand");
	});
});
