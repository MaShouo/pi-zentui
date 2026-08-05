import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

assert.equal(manifest.name, "pi-sakura-cyberdeck");
assert.equal(manifest.keywords.includes("pi-package"), true);
assert.equal(
	manifest.pi.extensions.some((path) => path.includes("dual-quota")),
	false,
);

for (const path of [...manifest.pi.extensions, ...manifest.pi.themes]) {
	await access(resolve(root, path));
}

const theme = JSON.parse(await readFile(resolve(root, "themes/sakura-macaron.json"), "utf8"));
const requiredColors = [
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"selectedBg",
	"userMessageBg",
	"userMessageText",
	"customMessageBg",
	"customMessageText",
	"customMessageLabel",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"bashMode",
];

assert.equal(theme.name, "sakura-macaron");
for (const color of requiredColors)
	assert.ok(color in theme.colors, `missing theme color: ${color}`);

const matrix = await readFile(resolve(root, "extensions/matrix/index.ts"), "utf8");
assert.doesNotMatch(matrix, /setWorkingMessage|setWorkingIndicator/);

console.log("pi-sakura-cyberdeck package check passed");
