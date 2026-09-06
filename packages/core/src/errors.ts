export type { SandboxErrorCode } from "./sandbox-provider.js";
export { SandboxOperationError } from "./sandbox-provider.js";

export class SandcasterError extends Error {
	constructor(
		message: string,
		public readonly code?: string,
	) {
		super(message);
		this.name = "SandcasterError";
	}
}
