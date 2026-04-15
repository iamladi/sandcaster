import type { CompositeRequest, CompositeResponse } from "../composite-ipc.js";
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
		action: CompositeRequest["action"],
		payload: Record<string, unknown>,
	): Promise<CompositeResponse> {
		const id = crypto.randomUUID();
		const message = {
			type: "composite_request",
			...payload,
			id,
			nonce: this.config.nonce,
			action,
		};

		this.deps.emit(JSON.stringify(message));

		const responsePath = ipcResponsePath(id);
		const deadline = Date.now() + this.config.pollTimeoutMs;

		while (Date.now() < deadline) {
			const raw = await this.deps.readFile(responsePath);
			if (raw !== null) {
				let response: CompositeResponse;
				try {
					response = JSON.parse(raw) as CompositeResponse;
				} catch {
					await this.deps.deleteFile(responsePath).catch(() => {});
					throw new Error(
						`IPC response parse error for request ${id}: malformed JSON`,
					);
				}
				await this.deps.deleteFile(responsePath).catch(() => {});
				return response;
			}
			await this.deps.sleep(this.config.pollIntervalMs);
		}

		throw new Error(
			`IPC timeout waiting for response to request ${id} (${this.config.pollTimeoutMs}ms)`,
		);
	}
}
