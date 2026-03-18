import type { SandcasterEvent } from "../schemas.js";

// ---------------------------------------------------------------------------
// BroadcastClient interface
// ---------------------------------------------------------------------------

/**
 * A connected client that can receive events.
 * `send` returns `false` when the client is dead/disconnected — the broadcaster
 * will automatically remove it on the next delivery attempt.
 */
export interface BroadcastClient {
	id: string;
	send: (event: SandcasterEvent & { id?: number }) => boolean;
}

// ---------------------------------------------------------------------------
// EventBroadcaster
// ---------------------------------------------------------------------------

export interface EventBroadcasterOptions {
	/** Maximum number of events to keep in the replay ring buffer. Default: 100. */
	replayBufferSize?: number;
}

/**
 * Multi-client event broadcaster with replay support.
 *
 * - Sequential numeric IDs are assigned to every broadcast event.
 * - A ring buffer of the last `replayBufferSize` events is maintained for
 *   late-connecting clients that provide a `lastEventId`.
 * - Dead clients (whose `send` returns `false`) are evicted automatically.
 */
export class EventBroadcaster {
	private readonly replayBufferSize: number;

	/** Ring buffer: stores the last N events in insertion order. */
	private readonly replayBuffer: Array<SandcasterEvent & { id: number }> = [];

	/** Next sequential event ID. */
	private nextId = 1;

	/** Connected clients keyed by client ID. */
	private clients = new Map<string, BroadcastClient>();

	constructor(opts?: EventBroadcasterOptions) {
		this.replayBufferSize = opts?.replayBufferSize ?? 100;
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	/**
	 * Register a client. If `lastEventId` is provided, all buffered events with
	 * an ID greater than `lastEventId` are immediately replayed to the client.
	 */
	addClient(client: BroadcastClient, lastEventId?: number): void {
		this.clients.set(client.id, client);

		if (lastEventId !== undefined) {
			for (const event of this.replayBuffer) {
				if (event.id > lastEventId) {
					client.send(event);
				}
			}
		}
	}

	/** Remove a client by ID. */
	removeClient(clientId: string): void {
		this.clients.delete(clientId);
	}

	/**
	 * Broadcast an event to all connected clients.
	 * Returns the number of clients that received the event.
	 */
	broadcast(event: SandcasterEvent): number {
		const stamped: SandcasterEvent & { id: number } = {
			...event,
			id: this.nextId++,
		};

		// Add to ring buffer (evict oldest when full)
		if (this.replayBuffer.length >= this.replayBufferSize) {
			this.replayBuffer.shift();
		}
		this.replayBuffer.push(stamped);

		let received = 0;
		const dead: string[] = [];

		for (const [id, client] of this.clients) {
			const ok = client.send(stamped);
			if (ok) {
				received++;
			} else {
				dead.push(id);
			}
		}

		// Evict dead clients
		for (const id of dead) {
			this.clients.delete(id);
		}

		return received;
	}

	/** Close the broadcaster: evict all clients and reset state. */
	close(): void {
		this.clients.clear();
		this.replayBuffer.length = 0;
		this.nextId = 1;
	}

	/** Number of currently connected clients. */
	get clientCount(): number {
		return this.clients.size;
	}
}
