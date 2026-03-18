import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionRecord } from "../schemas.js";
import type { ISessionStore } from "./types.js";

// ---------------------------------------------------------------------------
// Active session statuses
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = new Set(["initializing", "active", "running"]);
const EVICTABLE_STATUSES = new Set(["expired", "ended", "failed"]);

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSessionStore(opts?: {
	path?: string;
	maxEntries?: number;
}): ISessionStore {
	const filePath = opts?.path ?? ".sandcaster/sessions.jsonl";
	const maxEntries = opts?.maxEntries ?? 100;

	// In-memory store: ordered array (oldest → newest) + lookup map
	const order: SessionRecord[] = [];
	const index = new Map<string, SessionRecord>();

	// ------------------------------------------------------------------
	// Load from file on construction
	// ------------------------------------------------------------------
	_loadFromFile(filePath, maxEntries, order, index);

	// Ensure directory exists once (not per-write)
	try {
		mkdirSync(dirname(filePath), { recursive: true });
	} catch {
		// ignore — will fail on first write if truly broken
	}

	// ------------------------------------------------------------------
	// Helpers
	// ------------------------------------------------------------------

	function appendToFile(record: SessionRecord): void {
		try {
			appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf-8");
		} catch {
			console.warn(`SessionStore: failed to write to ${filePath}`);
		}
	}

	// ------------------------------------------------------------------
	// Public interface
	// ------------------------------------------------------------------

	function create(record: SessionRecord): void {
		// Evict oldest expired/ended/failed session when at max capacity
		if (order.length >= maxEntries) {
			const evictIdx = order.findIndex((r) => EVICTABLE_STATUSES.has(r.status));
			if (evictIdx !== -1) {
				const [evicted] = order.splice(evictIdx, 1);
				index.delete(evicted.id);
			} else {
				throw new Error("Session capacity limit reached");
			}
		}

		order.push(record);
		index.set(record.id, record);
		appendToFile(record);
	}

	function get(id: string): SessionRecord | undefined {
		return index.get(id);
	}

	function update(id: string, updates: Partial<SessionRecord>): void {
		const record = index.get(id);
		if (record === undefined) {
			console.warn(`SessionStore.update: unknown session id=${id}`);
			return;
		}
		Object.assign(record, updates, {
			lastActivityAt: new Date().toISOString(),
		});
		appendToFile(record);
	}

	function list(limit = 50): SessionRecord[] {
		// newest-first, up to limit, return plain copies
		const slice = order.slice(-limit).reverse();
		return slice.map((r) => ({ ...r }));
	}

	function del(id: string): void {
		const record = index.get(id);
		if (record === undefined) return;
		const idx = order.indexOf(record);
		if (idx !== -1) order.splice(idx, 1);
		index.delete(id);
	}

	function getActiveRecords(): SessionRecord[] {
		return order.filter((r) => ACTIVE_STATUSES.has(r.status));
	}

	function activeCount(): number {
		return order.filter((r) => ACTIVE_STATUSES.has(r.status)).length;
	}

	return {
		create,
		get,
		update,
		list,
		delete: del,
		getActiveRecords,
		activeCount,
	};
}

// ---------------------------------------------------------------------------
// JSONL reload (last-write-wins by session ID)
// ---------------------------------------------------------------------------

function _loadFromFile(
	filePath: string,
	maxEntries: number,
	order: SessionRecord[],
	index: Map<string, SessionRecord>,
): void {
	if (!existsSync(filePath)) {
		return;
	}

	let raw: string;
	try {
		raw = readFileSync(filePath, "utf-8");
	} catch {
		console.warn(`SessionStore: failed to read ${filePath}`);
		return;
	}

	// First pass: last-write-wins into a temp map, preserving insertion order
	const tempOrder: string[] = [];
	const tempMap = new Map<string, SessionRecord>();

	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const data = JSON.parse(trimmed) as SessionRecord;
			if (!tempMap.has(data.id)) {
				tempOrder.push(data.id);
			}
			tempMap.set(data.id, data);
		} catch {
			console.warn(`SessionStore: skipping malformed line in ${filePath}`);
		}
	}

	// Second pass: load most recent maxEntries entries in original order
	const ids =
		tempOrder.length <= maxEntries
			? tempOrder
			: tempOrder.slice(tempOrder.length - maxEntries);

	for (const id of ids) {
		const record = tempMap.get(id);
		if (!record) continue;
		order.push(record);
		index.set(record.id, record);
	}
}
