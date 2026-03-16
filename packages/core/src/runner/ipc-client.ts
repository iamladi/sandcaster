import type { CompositeResponse } from "../composite-ipc.js";
import { ipcResponsePath } from "../composite-ipc.js";

export interface IpcClientDeps {
	emit: (line: string) => void;
	readFile: (path: string) => Promise<string | null>;
	deleteFile: (path: string) => Promise<void>;
	sleep: (ms: number) => Promise<void>;
}

export interface IpcClientConfig {
	nonce: string;
	pollIntervalMs: number;
	pollTimeoutMs: number;
}

export class IpcClient {
	constructor(
		private readonly deps: IpcClientDeps,
		private readonly config: IpcClientConfig,
	) {}

	async request(
		action: string,
		payload: Record<string, unknown>,
	): Promise<CompositeResponse> {
		const id = crypto.randomUUID();
		const message = {
			type: "composite_request",
			id,
			nonce: this.config.nonce,
			action,
			...payload,
		};

		this.deps.emit(JSON.stringify(message));

		const responsePath = ipcResponsePath(id);
		const deadline = Date.now() + this.config.pollTimeoutMs;

		while (Date.now() < deadline) {
			const raw = await this.deps.readFile(responsePath);
			if (raw !== null) {
				const response = JSON.parse(raw) as CompositeResponse;
				await this.deps.deleteFile(responsePath);
				return response;
			}
			await this.deps.sleep(this.config.pollIntervalMs);
		}

		throw new Error(
			`IPC timeout waiting for response to request ${id} (${this.config.pollTimeoutMs}ms)`,
		);
	}
}
