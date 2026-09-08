import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent,
	type ExtensionContext,
	initTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, type MarkdownTheme, Spacer, Text } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThinkingStepsComponentConfig } from "../extensions/zentui/config";
import { ZENTUI_PROTOTYPE_PATCH_REGISTRY } from "../extensions/zentui/prototype-patch-registry";
import { ThinkingExperimentalController } from "../extensions/zentui/thinking-experimental";
import { installThinkingMessageStyle } from "../extensions/zentui/thinking-message";

initTheme("dark", false);

const prototype = AssistantMessageComponent.prototype as unknown as {
	updateContent: (message: unknown, isStreaming?: boolean) => unknown;
	render: (width: number) => unknown;
};
const originalUpdateContent = prototype.updateContent;
const originalRender = prototype.render;
const originalDescriptor = Object.getOwnPropertyDescriptor(prototype, "updateContent");
const identity = (text: string) => text;
const markdownTheme = Object.fromEntries(
	[
		"heading",
		"link",
		"linkUrl",
		"code",
		"codeBlock",
		"codeBlockBorder",
		"quote",
		"quoteBorder",
		"hr",
		"listBullet",
		"bold",
		"italic",
		"strikethrough",
		"underline",
	].map((key) => [key, identity]),
) as unknown as MarkdownTheme;

const controllers = new Set<ThinkingExperimentalController>();
const sakuraCleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of sakuraCleanups) cleanup();
	sakuraCleanups.length = 0;
	for (const controller of controllers) controller.shutdown();
	controllers.clear();
	if (originalDescriptor) Object.defineProperty(prototype, "updateContent", originalDescriptor);
	else prototype.updateContent = originalUpdateContent;
	prototype.render = originalRender;
	delete (prototype as unknown as Record<PropertyKey, unknown>)[ZENTUI_PROTOTYPE_PATCH_REGISTRY];
	vi.useRealTimers();
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

function installSakura(): () => void {
	const cleanup = installThinkingMessageStyle(theme, () => true);
	sakuraCleanups.push(cleanup);
	return cleanup;
}

function message(thinking: string, timestamp = 1_000, answer?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{ type: "thinking", thinking },
			...(answer ? [{ type: "text" as const, text: answer }] : []),
		],
		api: "test",
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

function plain(lines: string[]): string[] {
	return lines.map((line) =>
		line
			.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
			.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
			.trimEnd(),
	);
}

function context() {
	let inputHandler: ((data: string) => { consume?: boolean } | undefined) | undefined;
	const stopInput = vi.fn();
	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			onTerminalInput(handler: typeof inputHandler) {
				inputHandler = handler;
				return stopInput;
			},
		},
		sessionManager: { getEntries: () => [] },
	} as unknown as ExtensionContext;
	return {
		ctx,
		input: (data: string) => inputHandler?.(data),
		stopInput,
	};
}

function component(hideThinkingBlock = false): AssistantMessageComponent {
	return new AssistantMessageComponent(
		undefined,
		hideThinkingBlock,
		markdownTheme,
		"Thinking...",
		1,
		[],
	);
}

function childrenOf(assistant: AssistantMessageComponent): Component[] {
	return (
		(assistant as unknown as { contentContainer?: { children?: Component[] } }).contentContainer
			?.children ?? []
	);
}

function hasHandleMouse(
	child: Component,
): child is Component & { handleMouse: (event: object) => unknown } {
	return typeof (child as { handleMouse?: unknown }).handleMouse === "function";
}

/** Pi 0.85 Container only dispatches handleMouse to direct children. */
function clickDirectThinkingChild(assistant: AssistantMessageComponent): unknown {
	const clickable = childrenOf(assistant).filter(hasHandleMouse);
	expect(clickable).toHaveLength(1);
	return clickable[0]?.handleMouse({
		type: "click",
		button: "left",
		x: 0,
		y: 0,
		screenX: 0,
		screenY: 0,
		width: 80,
		height: 8,
		shift: false,
		alt: false,
		ctrl: false,
	});
}

class HostMouseRegion implements Component {
	child: Component;
	handleMouse: (event: { type: string; button?: string }) => { handled: true } | undefined;

	constructor(
		child: Component,
		onMouse: (event: { type: string; button?: string }) => { handled: true } | undefined,
	) {
		this.child = child;
		this.handleMouse = (event) => {
			if (event.type !== "click" || event.button !== "left") return undefined;
			return onMouse(event);
		};
	}

	render(width: number): string[] {
		return this.child.render(width);
	}

	invalidate(): void {
		this.child.invalidate();
	}
}

function coalescedThinkingTexts(value: AssistantMessage): string[] {
	const texts: string[] = [];
	for (let index = 0; index < value.content.length; index += 1) {
		const content = value.content[index];
		if (content?.type !== "thinking") continue;
		const blocks: string[] = [];
		for (; index < value.content.length; index += 1) {
			const next = value.content[index];
			if (next?.type !== "thinking") break;
			const source = next.thinking.trim();
			if (source) blocks.push(source);
		}
		index -= 1;
		if (blocks.length) texts.push(blocks.join("\n\n"));
	}
	return texts;
}

function thinkingMouseRegions(assistant: AssistantMessageComponent): HostMouseRegion[] {
	return childrenOf(assistant).filter(
		(child): child is HostMouseRegion => child instanceof HostMouseRegion,
	);
}

function installPi85ThinkingRenderer(): void {
	const native = originalDescriptor?.value as (this: unknown, ...args: unknown[]) => unknown;
	const constructors = new Map<string, object>([
		["Markdown", Markdown.prototype],
		["Spacer", Spacer.prototype],
		["Text", Text.prototype],
	]);
	Object.defineProperty(prototype, "updateContent", {
		...originalDescriptor,
		value: function pi85Thinking(
			this: {
				contentContainer?: { children?: Component[] };
				hideThinkingBlock?: boolean;
				thinkingVisibilityOverrides?: Map<number, boolean>;
			},
			...args: unknown[]
		) {
			const value = args[0] as AssistantMessage;
			const isStreaming = args[1] as boolean | undefined;
			const result = Reflect.apply(native, this, args);
			const children = this.contentContainer?.children;
			if (!Array.isArray(children)) return result;
			for (const child of children) {
				const expected = constructors.get(child.constructor.name);
				if (expected && Object.getPrototypeOf(child) !== expected)
					Object.setPrototypeOf(child, expected);
			}
			if (!(this.thinkingVisibilityOverrides instanceof Map)) {
				this.thinkingVisibilityOverrides = new Map();
			}
			const texts = coalescedThinkingTexts(value);
			let runIndex = 0;
			for (let index = 0; index < children.length; index += 1) {
				const child = children[index];
				if (!child) continue;
				const markdownText =
					Object.getPrototypeOf(child) === Markdown.prototype
						? (child as unknown as { text?: string }).text
						: undefined;
				const isThinkingMarkdown =
					typeof markdownText === "string" && texts[runIndex] === markdownText;
				const isHiddenThinkingText =
					Object.getPrototypeOf(child) === Text.prototype &&
					runIndex < texts.length &&
					this.hideThinkingBlock === true;
				if (!isThinkingMarkdown && !isHiddenThinkingText) continue;
				const capturedRun = runIndex;
				const hidden =
					this.thinkingVisibilityOverrides.get(capturedRun) ?? this.hideThinkingBlock === true;
				runIndex += 1;
				const inner = hidden
					? new Text("Thinking...", 1, 0)
					: isThinkingMarkdown
						? child
						: new Markdown(texts[capturedRun] ?? "", 1, 0, markdownTheme, {
								color: identity,
								italic: true,
							});
				children[index] = new HostMouseRegion(inner, (event) => {
					if (event.type !== "click" || event.button !== "left") return undefined;
					this.thinkingVisibilityOverrides?.set(capturedRun, !hidden);
					Reflect.apply(prototype.updateContent, this, [value, isStreaming]);
					return { handled: true };
				});
			}
			return result;
		},
	});
}

function bridgeSourceLoadedMarkdownIdentity(): void {
	const native = originalDescriptor?.value as (this: unknown, ...args: unknown[]) => unknown;
	const constructors = new Map<string, object>([
		["Markdown", Markdown.prototype],
		["Spacer", Spacer.prototype],
		["Text", Text.prototype],
	]);
	Object.defineProperty(prototype, "updateContent", {
		...originalDescriptor,
		value: function sourceLoadedIdentityBridge(this: unknown, ...args: unknown[]) {
			const result = Reflect.apply(native, this, args);
			const children = (this as { contentContainer?: { children?: object[] } }).contentContainer
				?.children;
			for (const child of children ?? []) {
				const expected = constructors.get(child.constructor.name);
				if (expected && Object.getPrototypeOf(child) !== expected)
					Object.setPrototypeOf(child, expected);
			}
			return result;
		},
	});
}

function controller(config: ThinkingStepsComponentConfig): ThinkingExperimentalController {
	const value = new ThinkingExperimentalController(
		() => config,
		() => {},
		() => 8_100,
	);
	controllers.add(value);
	return value;
}

function startExperimentalThenSakura(config: ThinkingStepsComponentConfig) {
	const host = context();
	const value = controller(config);
	expect(value.startSession(host.ctx)).toEqual({ applied: true });
	installSakura();
	return { host, value };
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
		const thinkingMessage = { content: [{ type: "thinking", thinking: "reasoning" }] };
		prototype.updateContent.call(instance, thinkingMessage);
		const wrapped = instance.contentContainer.children[1];
		prototype.updateContent.call(instance, thinkingMessage);

		expect(instance.contentContainer.children[1]).toBe(wrapped);
		expect(stripAnsi((wrapped as Component).render(80).join("\n"))).toContain("Thought trail");
		expect(prototype.render.call(instance, 80)).not.toEqual(["Thinking..."]);

		cleanup();
		expect(prototype.updateContent).toBe(predecessor);
		expect(prototype.render).toBe(renderPredecessor);
	});
});

describe("Sakura + Thinking (Experimental) MouseRegion composition", () => {
	it("keeps the Pi 0.85 MouseRegion as the direct child and expands Streaming from top-level click, Ctrl+T, live rerender, and dispose", () => {
		installPi85ThinkingRenderer();
		vi.useFakeTimers();
		const { host, value } = startExperimentalThenSakura({ enabled: true, mode: "streaming" });
		const assistant = component();
		const reasoning = Array.from({ length: 8 }, (_, index) => `click row ${index + 1}  `).join(
			"\n",
		);
		const current = message(reasoning, 7_000, "Final **answer**");
		(current as { stopReason: string }).stopReason = "pending";
		assistant.updateContent(current, true);
		expect(value.state).toMatchObject({ active: true, displaced: false });

		const regions = thinkingMouseRegions(assistant);
		expect(regions).toHaveLength(1);
		expect(childrenOf(assistant).filter(hasHandleMouse)).toHaveLength(1);
		expect(regions[0]).toBe(childrenOf(assistant).find(hasHandleMouse));
		const folded = plain(assistant.render(40)).join("\n");
		expect(folded).toContain("Thought trail");
		expect(folded).toContain("Thinking 0.0s");
		expect(folded).not.toContain("click row 1");

		expect(clickDirectThinkingChild(assistant)).toEqual({ handled: true });
		const expanded = plain(assistant.render(40)).join("\n");
		expect(expanded).toContain("Thought trail");
		expect(expanded).toContain("click row 1");
		expect(thinkingMouseRegions(assistant)).toHaveLength(1);

		expect(host.input("\x14")).toEqual({ consume: true });
		expect(plain(assistant.render(40)).join("\n")).toContain("Thinking 0.0s");
		expect(thinkingMouseRegions(assistant)).toHaveLength(1);

		vi.advanceTimersByTime(1_000);
		const afterTimer = plain(assistant.render(40)).join("\n");
		expect(afterTimer).toContain("Thought trail");
		expect(afterTimer).toContain("Thinking");
		expect(clickDirectThinkingChild(assistant)).toEqual({ handled: true });
		expect(plain(assistant.render(40)).join("\n")).toContain("click row 1");

		value.shutdown();
		const native = plain(assistant.render(40)).join("\n");
		expect(native).toContain("Thought trail");
		expect(native).toContain("click row 1");
		expect(thinkingMouseRegions(assistant)).toHaveLength(1);
		expect(clickDirectThinkingChild(assistant)).toEqual({ handled: true });
		expect(plain(assistant.render(40)).join("\n")).toContain("Thinking...");
		expect(plain(assistant.render(40)).join("\n")).not.toContain("click row 1");
	});

	it.each(["rail", "tree"] as const)(
		"keeps %s native MouseRegion click on the direct child under Sakura",
		(mode) => {
			installPi85ThinkingRenderer();
			const { value } = startExperimentalThenSakura({ enabled: true, mode });
			const assistant = component();
			const current = message("# Visible\n# Latest", 81_000);
			assistant.updateContent(current, true);
			expect(value.state).toMatchObject({ active: true, displaced: false });
			expect(thinkingMouseRegions(assistant)).toHaveLength(1);
			const shown = plain(assistant.render(80)).join("\n");
			expect(shown).toContain("Thought trail");
			expect(shown).toContain(mode === "rail" ? "│ • Latest" : "└─ • Latest");

			expect(clickDirectThinkingChild(assistant)).toEqual({ handled: true });
			const hidden = plain(assistant.render(80)).join("\n");
			expect(hidden).not.toContain("Visible");
			expect(hidden).toContain("Thinking...");
			expect(thinkingMouseRegions(assistant)).toHaveLength(1);
		},
	);

	it("still wraps Pi 0.84 bare Markdown without installing a MouseRegion", () => {
		bridgeSourceLoadedMarkdownIdentity();
		startExperimentalThenSakura({ enabled: true, mode: "tree" });
		const assistant = component();
		assistant.updateContent(message("# Bare markdown", 1_000), true);
		expect(thinkingMouseRegions(assistant)).toHaveLength(0);
		expect(childrenOf(assistant).filter(hasHandleMouse)).toHaveLength(0);
		const output = plain(assistant.render(80)).join("\n");
		expect(output).toContain("Thought trail");
		expect(output).toContain("Bare markdown");
	});
});
