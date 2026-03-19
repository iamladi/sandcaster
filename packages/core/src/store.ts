import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Run } from "./schemas.js";

// ---------------------------------------------------------------------------
// IRunStore interface
// ---------------------------------------------------------------------------

export interface IRunStore {
	create(
		id: string,
		prompt: string,
		model: string | null,
		filesCount?: number,
	): Run;
	complete(
		id: string,
		opts?: {
			costUsd?: number;
			numTurns?: number;
			durationSecs?: number;
			model?: string;
			branchCount?: number;
			branchWinnerId?: string;
			evaluatorType?: string;
		},
	): void;
	fail(id: string, error: string, durationSecs?: number): void;
	addFeedback(id: string, feedback: string, user: string): void;
	list(limit?: number): Run[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRunStore(opts?: {
	path?: string;
	maxEntries?: number;
}): IRunStore {
	const filePath = opts?.path ?? ".sandcaster/runs.jsonl";
	const maxEntries = opts?.maxEntries ?? 200;

	// In-memory store: ordered array (oldest → newest) + lookup map
	const order: Run[] = [];
	const index = new Map<string, Run>();

	// ------------------------------------------------------------------
	// Load from file on construction
	// ------------------------------------------------------------------
	_loadFromFile(filePath, maxEntries, order, index);

	// ------------------------------------------------------------------
	// Helpers
	// ------------------------------------------------------------------

	function appendToFile(run: Run): void {
		try {
			mkdirSync(dirname(filePath), { recursive: true });
			appendFileSync(filePath, `${JSON.stringify(run)}\n`, "utf-8");
		} catch {
			console.warn(`RunStore: failed to write to ${filePath}`);
		}
	}

	// ------------------------------------------------------------------
	// Public interface
	// ------------------------------------------------------------------

	function create(
		id: string,
		prompt: string,
		model: string | null,
		filesCount = 0,
	): Run {
		// Evict oldest non-running entry when at max capacity
		if (order.length >= maxEntries) {
			const evictIdx = order.findIndex((r) => r.status !== "running");
			if (evictIdx !== -1) {
				const [evicted] = order.splice(evictIdx, 1);
				index.delete(evicted.id);
			}
		}

		const run: Run = {
			id,
			prompt: prompt.slice(0, 100),
			status: "running",
			startedAt: new Date().toISOString(),
			filesCount,
			...(model !== null ? { model } : {}),
		};

		order.push(run);
		index.set(run.id, run);
		appendToFile(run);
		return run;
	}

	function complete(
		id: string,
		opts?: {
			costUsd?: number;
			numTurns?: number;
			durationSecs?: number;
			model?: string;
			branchCount?: number;
			branchWinnerId?: string;
			evaluatorType?: string;
		},
	): void {
		const run = index.get(id);
		if (run === undefined) {
			console.warn(`RunStore.complete: unknown run id=${id}`);
			return;
		}
		run.status = "completed";
		if (opts?.costUsd !== undefined) run.costUsd = opts.costUsd;
		if (opts?.numTurns !== undefined) run.numTurns = opts.numTurns;
		if (opts?.durationSecs !== undefined) run.durationSecs = opts.durationSecs;
		if (opts?.model !== undefined) run.model = opts.model;
		if (opts?.branchCount !== undefined) run.branchCount = opts.branchCount;
		if (opts?.branchWinnerId !== undefined)
			run.branchWinnerId = opts.branchWinnerId;
		if (opts?.evaluatorType !== undefined)
			run.evaluatorType = opts.evaluatorType;
		appendToFile(run);
	}

	function fail(id: string, error: string, durationSecs?: number): void {
		const run = index.get(id);
		if (run === undefined) {
			console.warn(`RunStore.fail: unknown run id=${id}`);
			return;
		}
		run.status = "error";
		run.error = error;
		if (durationSecs !== undefined) run.durationSecs = durationSecs;
		appendToFile(run);
	}

	function addFeedback(id: string, feedback: string, user: string): void {
		const run = index.get(id);
		if (run === undefined) {
			console.warn(`RunStore.addFeedback: unknown run id=${id}`);
			return;
		}
		run.feedback = feedback;
		run.feedbackUser = user;
		appendToFile(run);
	}

	function list(limit = 50): Run[] {
		// newest-first, up to limit, return plain copies
		const slice = order.slice(-limit).reverse();
		return slice.map((r) => ({ ...r }));
	}

	return { create, complete, fail, addFeedback, list };
}

// ---------------------------------------------------------------------------
// JSONL reload (last-write-wins by run ID)
// ---------------------------------------------------------------------------

function _loadFromFile(
	filePath: string,
	maxEntries: number,
	order: Run[],
	index: Map<string, Run>,
): void {
	if (!existsSync(filePath)) {
		return;
	}

	let raw: string;
	try {
		raw = readFileSync(filePath, "utf-8");
	} catch {
		console.warn(`RunStore: failed to read ${filePath}`);
		return;
	}

	// First pass: last-write-wins into a temp map, preserving insertion order
	const tempOrder: string[] = []; // tracks first-seen insertion order
	const tempMap = new Map<string, Run>();

	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const data = JSON.parse(trimmed) as Run;
			if (!tempMap.has(data.id)) {
				tempOrder.push(data.id);
			}
			tempMap.set(data.id, data);
		} catch {
			console.warn(`RunStore: skipping malformed line in ${filePath}`);
		}
	}

	// Second pass: load most recent maxEntries entries in original order
	const ids =
		tempOrder.length <= maxEntries
			? tempOrder
			: tempOrder.slice(tempOrder.length - maxEntries);

	for (const id of ids) {
		const run = tempMap.get(id);
		if (!run) continue;
		order.push(run);
		index.set(run.id, run);
	}
}
