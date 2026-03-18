import type {
	IRunStore,
	RunOptions,
	SandcasterEvent,
	SessionManager,
} from "@sandcaster/core";

export interface AppDeps {
	runStore?: IRunStore;
	runAgent?: (options: RunOptions) => AsyncGenerator<SandcasterEvent>;
	sessionManager?: SessionManager;
	apiKey?: string;
	version?: string;
	corsOrigins?: string[];
}
