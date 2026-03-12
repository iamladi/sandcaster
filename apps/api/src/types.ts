import type { IRunStore, RunOptions, SandcasterEvent } from "@sandcaster/core";

export interface AppDeps {
	runStore?: IRunStore;
	runAgent?: (options: RunOptions) => AsyncGenerator<SandcasterEvent>;
	apiKey?: string;
	webhookSecret?: string;
	version?: string;
	corsOrigins?: string[];
}
