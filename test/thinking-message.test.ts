import { AssistantMessageComponent, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { installThinkingMessageStyle } from "../extensions/zentui/thinking-message";

const prototype = AssistantMessageComponent.prototype as unknown as {
	updateContent: (message: unknown) => unknown;
	render: (width: number) => unknown;
};
const originalUpdateContent = prototype.updateContent;
const originalRender = prototype.render;

afterEach(() => {
	prototype.updateContent = originalUpdateContent;
	prototype.render = originalRender;
});

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function theme(): Theme {
	return {
		fg(_color: string, text: string) {
			return text;
		},
		italic(text: string) {
			return text;
		},
	} as Theme;
}

describe("Sakura thinking message patch", () => {
	it("does not wrap a thinking child more than once and restores prototypes on cleanup", () => {
		const inner: Component = {
			render: () => ["reasoning"],
			invalidate() {},
		};
		const instance = {
			contentContainer: {
				children: [{ render: () => [], invalidate() {} } as Component, inner],
			},
			hideThinkingBlock: false,
		};
		const predecessor = function (this: typeof instance) {
			return this.contentContainer.children;
		};
		const renderPredecessor = () => ["Thinking..."];
		prototype.updateContent = predecessor as unknown as typeof prototype.updateContent;
		prototype.render = renderPredecessor;

		const cleanup = installThinkingMessageStyle(theme, () => true);
		const message = { content: [{ type: "thinking", thinking: "reasoning" }] };
		prototype.updateContent.call(instance, message);
		const wrapped = instance.contentContainer.children[1];
		prototype.updateContent.call(instance, message);

		expect(instance.contentContainer.children[1]).toBe(wrapped);
		expect(stripAnsi((wrapped as Component).render(80).join("\n"))).toContain("Thought trail");
		expect(prototype.render.call(instance, 80)).not.toEqual(["Thinking..."]);

		cleanup();
		expect(prototype.updateContent).toBe(predecessor);
		expect(prototype.render).toBe(renderPredecessor);
	});
});
