import { AssistantMessageComponent, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { type RGB, renderSakuraGradient, rgbForeground } from "./gradient";
import { installPrototypePatch } from "./prototype-patch-registry";

type Cleanup = () => void;
type AssistantContent = {
	type: string;
	text?: string;
	thinking?: string;
};
type AssistantMessageRuntime = {
	contentContainer?: { children?: Component[] };
	hideThinkingBlock?: boolean;
	lastMessage?: AssistantMessageLike;
};
type AssistantMessageLike = {
	content?: AssistantContent[];
};
// Pi 0.85 wraps thinking Markdown in MouseRegion. Duck-type so Pi 0.84 hosts
// that do not export MouseRegion still wrap the bare thinking child.
type ThinkingMouseRegion = Component & {
	child: Component;
	handleMouse(event: { type: string; button?: string }): unknown;
};

/**
 * Hybrid thinking chrome:
 * - Claude: no full-width card, dim+italic body, quiet collapse
 * - Sakura: gradient ✦ / ◇ / THINKING label, tree rails, soft body tint
 * - User request: tree rails ├─ / │ / ╰─
 */
const MAX_BODY_WIDTH = 100;
const MAX_PREVIEW_LINES = 16;
const BODY_TINT: RGB = [216, 202, 220]; // soft petal-lilac body
const HIDDEN_LABEL_PLAIN = "✦ Thought";
const THINKING_TRAIL_COMPONENT = Symbol("pi-zentui.sakura-thinking-trail");

function stripAnsi(line: string): string {
	return line.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function isBlankRenderedLine(line: string): boolean {
	return stripAnsi(line).trim().length === 0;
}

function removeTrailingPadding(line: string): string {
	return line.replace(
		/ +((?:(?:\x1b\[[0-?]*[ -/]*[@-~])|(?:\x1b\][^\x07]*(?:\x07|\x1b\\)))*)$/,
		"$1",
	);
}

function removeOutputPadding(line: string): string {
	let index = 0;
	while (index < line.length && line[index] === "\x1b") {
		if (line[index + 1] === "[") {
			const match = line.slice(index).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
			if (!match) break;
			index += match[0].length;
			continue;
		}
		if (line[index + 1] === "]") {
			const bell = line.indexOf("\x07", index + 2);
			const st = line.indexOf("\x1b\\", index + 2);
			const end = bell >= 0 && (st < 0 || bell < st) ? bell + 1 : st >= 0 ? st + 2 : -1;
			if (end < 0) break;
			index = end;
			continue;
		}
		break;
	}
	return line[index] === " " ? `${line.slice(0, index)}${line.slice(index + 1)}` : line;
}

function isVisibleContent(content: AssistantContent): boolean {
	return (
		(content.type === "text" && Boolean(content.text?.trim())) ||
		(content.type === "thinking" && Boolean(content.thinking?.trim()))
	);
}

function thinkingChildIndices(message: AssistantMessageLike): number[] {
	const content = message.content ?? [];
	let childIndex = content.some(isVisibleContent) ? 1 : 0;
	const result: number[] = [];

	for (let index = 0; index < content.length; index++) {
		const item = content[index];
		if (!item) continue;
		if (item.type === "text" && item.text?.trim()) {
			childIndex += 1;
			continue;
		}
		if (item.type !== "thinking") continue;

		let hasThinking = false;
		while (index < content.length && content[index]?.type === "thinking") {
			hasThinking ||= Boolean(content[index]?.thinking?.trim());
			index += 1;
		}
		index -= 1;
		if (!hasThinking) continue;

		result.push(childIndex);
		childIndex += 1;
		if (content.slice(index + 1).some(isVisibleContent)) childIndex += 1;
	}
	return result;
}

function themeItalic(theme: Theme, text: string): string {
	try {
		return theme.italic?.(text) ?? text;
	} catch {
		return text;
	}
}

/** Soft truecolor body — readable, macaron-adjacent, not full rainbow. */
function softBody(theme: Theme, text: string): string {
	return themeItalic(theme, rgbForeground(BODY_TINT, text));
}

function gradientBranch(text: string): string {
	return renderSakuraGradient(text);
}

/**
 *   ✦ Thought trail · 3 steps
 *   ├─ ◇ first step…
 *   │    wrap
 *   ╰─ ◇ last step…
 */
class ThinkingTrailComponent implements Component {
	readonly [THINKING_TRAIL_COMPONENT] = true;

	constructor(
		private readonly inner: Component,
		private readonly getTheme: () => Theme | undefined,
	) {}

	invalidate(): void {
		this.inner.invalidate?.();
	}

	render(width: number): string[] {
		if (width < 8) return this.inner.render(width);
		const theme = this.getTheme();
		if (!theme) return this.inner.render(width);

		// "├─ ◇ " / "│    " ≈ 6 cols
		const prefixWidth = 6;
		const contentWidth = Math.max(1, Math.min(width - prefixWidth, MAX_BODY_WIDTH));
		const rawLines = this.inner.render(contentWidth);

		const rows: Array<{ line: string; step: boolean }> = [];
		let startsStep = true;
		for (const line of rawLines) {
			if (isBlankRenderedLine(line)) {
				startsStep = true;
				continue;
			}
			rows.push({ line: removeOutputPadding(removeTrailingPadding(line)), step: startsStep });
			startsStep = false;
		}
		if (rows.length === 0) return [];

		const stepCount = rows.filter((row) => row.step).length;
		const mark = renderSakuraGradient("✦");
		// OpenCode/Claude-ish status chrome: Thought trail + step count
		const labelCore = stepCount > 1 ? ` Thought trail · ${stepCount} steps` : " Thought trail";
		const label = renderSakuraGradient(labelCore);
		const header = truncateToWidth(`  ${mark}${label}`, width, "");

		const body: string[] = [];
		let currentStep = 0;
		let emitted = 0;
		let truncated = false;

		for (const { line, step } of rows) {
			if (emitted >= MAX_PREVIEW_LINES) {
				truncated = true;
				break;
			}
			if (step) currentStep += 1;
			const isLastStep = currentStep === stepCount;
			const branchText = step ? (isLastStep ? "╰─ " : "├─ ") : isLastStep ? "   " : "│  ";
			const branch = gradientBranch(branchText);
			const marker = step ? `${renderSakuraGradient("◇")} ` : "  ";
			const plain = stripAnsi(line);
			// Already-styled (markdown etc.) keeps colors; plain → soft macaron body.
			const bodyText = line.includes("\x1b[") ? line : softBody(theme, plain);
			body.push(truncateToWidth(`  ${branch}${marker}${bodyText}`, width, ""));
			emitted += 1;
		}

		if (truncated) {
			const more = Math.max(0, rows.length - MAX_PREVIEW_LINES);
			const hint = softBody(theme, `… +${more} more · Ctrl+T collapses trail`);
			const endBranch = gradientBranch("╰─ ");
			body.push(truncateToWidth(`  ${endBranch}${hint}`, width, ""));
		}

		// No leading blank — AssistantMessage already inserts Spacer(1) before content.
		// Extra "" stacked with that Spacer and made the hole under user messages huge.
		return [header, ...body];
	}
}

function isThinkingTrailComponent(value: unknown): value is ThinkingTrailComponent {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as Record<PropertyKey, unknown>)[THINKING_TRAIL_COMPONENT] === true
	);
}

function getThinkingMouseRegion(component: Component): ThinkingMouseRegion | undefined {
	const region = component as Partial<ThinkingMouseRegion>;
	if (!region.child || typeof region.handleMouse !== "function") return undefined;
	if (typeof region.child.render !== "function") return undefined;
	return region as ThinkingMouseRegion;
}

function wrapThinkingChild(child: Component, getTheme: () => Theme | undefined): Component {
	if (isThinkingTrailComponent(child)) return child;
	const region = getThinkingMouseRegion(child);
	if (!region) return new ThinkingTrailComponent(child, getTheme);
	// Keep MouseRegion as the Container direct child so Pi 0.85 mouse dispatch
	// still reaches handleMouse. Wrap only the inner thinking surface.
	if (!isThinkingTrailComponent(region.child)) {
		try {
			region.child = new ThinkingTrailComponent(region.child, getTheme);
		} catch {
			// Leave the native MouseRegion; click handling stays on the wrapper.
		}
	}
	return child;
}

function wrapThinkingChildren(
	runtime: AssistantMessageRuntime,
	message: AssistantMessageLike | undefined,
	getTheme: () => Theme | undefined,
): void {
	const children = runtime.contentContainer?.children;
	if (!children || !message) return;
	if (runtime.hideThinkingBlock) return;
	for (const index of thinkingChildIndices(message)) {
		const child = children[index];
		if (!child) continue;
		children[index] = wrapThinkingChild(child, getTheme);
	}
}

/** Recolor collapsed "✦ Thinking" placeholders that Pi themes as plain thinkingText. */
function recolorHiddenThinkingLines(lines: string[]): string[] {
	return lines.map((line) => {
		const plain = stripAnsi(line).trim();
		let label: string | undefined;
		if (
			plain === "Thinking..." ||
			plain === "Thinking" ||
			plain === "Thought" ||
			plain === "Thought..."
		) {
			label = HIDDEN_LABEL_PLAIN;
		} else if (
			plain === HIDDEN_LABEL_PLAIN ||
			/^✦\s*(?:Thinking|Thought)(?:\s*(?:trail)?(?:\s*·\s*\d+(?:\s*steps)?)?)?$/.test(plain)
		) {
			label = plain.startsWith("✦") ? plain : `✦ ${plain}`;
		}
		if (!label) return line;
		const pad = line.match(/^\s*/)?.[0] ?? "";
		return `${pad}${renderSakuraGradient(label)}`;
	});
}

export function installThinkingMessageStyle(
	getTheme: () => Theme | undefined,
	isEnabled: () => boolean,
): Cleanup {
	const cleanupContent = installPrototypePatch(
		AssistantMessageComponent.prototype,
		"updateContent",
		"assistant-thinking-content",
		({ predecessor, receiver, args }) => {
			const result = Reflect.apply(predecessor, receiver, args);
			if (!isEnabled()) return result;
			const runtime = receiver as AssistantMessageRuntime;
			wrapThinkingChildren(runtime, args[0] as AssistantMessageLike | undefined, getTheme);
			return result;
		},
	);

	let cleanupRender: Cleanup | undefined;
	try {
		cleanupRender = installPrototypePatch(
			AssistantMessageComponent.prototype,
			"render",
			"assistant-thinking-hidden-render",
			({ predecessor, receiver, args }) => {
				const runtime = receiver as AssistantMessageRuntime;
				// Experimental rerenderTracked calls the native predecessor directly, so
				// wrap again here; first-paint wrapping in updateContent is not enough.
				if (isEnabled()) wrapThinkingChildren(runtime, runtime.lastMessage, getTheme);
				const rendered = Reflect.apply(predecessor, receiver, args);
				if (!isEnabled()) return rendered;
				if (!Array.isArray(rendered) || !rendered.every((line) => typeof line === "string")) {
					return rendered;
				}
				// Collapsed placeholders + any leftover plain "Thinking..." lines.
				return recolorHiddenThinkingLines(rendered as string[]);
			},
		);
	} catch (error) {
		cleanupContent();
		throw error;
	}

	return () => {
		cleanupRender?.();
		cleanupContent();
	};
}

export const SAKURA_HIDDEN_THINKING_LABEL = HIDDEN_LABEL_PLAIN; // "✦ Thought"
