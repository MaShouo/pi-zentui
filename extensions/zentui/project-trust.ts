/** Older Pi hosts do not expose project trust; preserve their existing behavior. */
export function isProjectTrusted(ctx: { isProjectTrusted?: () => boolean }): boolean {
	try {
		return typeof ctx.isProjectTrusted !== "function" || ctx.isProjectTrusted() === true;
	} catch {
		return false;
	}
}
