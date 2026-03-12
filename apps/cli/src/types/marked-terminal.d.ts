declare module "marked-terminal" {
	import type { MarkedExtension } from "marked";

	interface MarkedTerminalOptions {
		width?: number;
	}

	export function markedTerminal(
		options?: MarkedTerminalOptions,
	): MarkedExtension;
}
