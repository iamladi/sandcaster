import { describe, expect, it } from "vitest";
import type { SandcasterEvent } from "../../schemas.js";
import {
	type BroadcastClient,
	EventBroadcaster,
} from "../../session/broadcaster.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockClient(
	id: string,
): BroadcastClient & { events: Array<SandcasterEvent & { id?: number }> } {
	const events: Array<SandcasterEvent & { id?: number }> = [];
	return {
		id,
		events,
		send: (event) => {
			events.push(event);
			return true;
		},
	};
}

const BASE_EVENT: SandcasterEvent = { type: "system", content: "hello" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventBroadcaster", () => {
	// -------------------------------------------------------------------------
	// 1. addClient stores client
	// -------------------------------------------------------------------------

	it("addClient registers a client so broadcast reaches it", () => {
		const broadcaster = new EventBroadcaster();
		const client = createMockClient("c1");
		broadcaster.addClient(client);
		broadcaster.broadcast(BASE_EVENT);
		expect(client.events).toHaveLength(1);
	});

	// -------------------------------------------------------------------------
	// 2. broadcast sends event to all clients
	// -------------------------------------------------------------------------

	it("broadcast sends event to all connected clients", () => {
		const broadcaster = new EventBroadcaster();
		const c1 = createMockClient("c1");
		const c2 = createMockClient("c2");
		broadcaster.addClient(c1);
		broadcaster.addClient(c2);
		broadcaster.broadcast(BASE_EVENT);
		expect(c1.events).toHaveLength(1);
		expect(c2.events).toHaveLength(1);
	});

	// -------------------------------------------------------------------------
	// 3. broadcast assigns sequential IDs
	// -------------------------------------------------------------------------

	it("broadcast assigns sequential numeric IDs starting from 1", () => {
		const broadcaster = new EventBroadcaster();
		const client = createMockClient("c1");
		broadcaster.addClient(client);
		broadcaster.broadcast(BASE_EVENT);
		broadcaster.broadcast(BASE_EVENT);
		broadcaster.broadcast(BASE_EVENT);
		expect(client.events[0].id).toBe(1);
		expect(client.events[1].id).toBe(2);
		expect(client.events[2].id).toBe(3);
	});

	// -------------------------------------------------------------------------
	// 4. broadcast returns client count
	// -------------------------------------------------------------------------

	it("broadcast returns the number of clients that received the event", () => {
		const broadcaster = new EventBroadcaster();
		broadcaster.addClient(createMockClient("c1"));
		broadcaster.addClient(createMockClient("c2"));
		broadcaster.addClient(createMockClient("c3"));
		const count = broadcaster.broadcast(BASE_EVENT);
		expect(count).toBe(3);
	});

	// -------------------------------------------------------------------------
	// 5. removeClient stops delivery
	// -------------------------------------------------------------------------

	it("removeClient prevents future events from reaching the client", () => {
		const broadcaster = new EventBroadcaster();
		const client = createMockClient("c1");
		broadcaster.addClient(client);
		broadcaster.removeClient("c1");
		broadcaster.broadcast(BASE_EVENT);
		expect(client.events).toHaveLength(0);
	});

	// -------------------------------------------------------------------------
	// 6. clientCount reflects connected clients
	// -------------------------------------------------------------------------

	it("clientCount reflects the current number of connected clients", () => {
		const broadcaster = new EventBroadcaster();
		broadcaster.addClient(createMockClient("c1"));
		broadcaster.addClient(createMockClient("c2"));
		expect(broadcaster.clientCount).toBe(2);
		broadcaster.removeClient("c1");
		expect(broadcaster.clientCount).toBe(1);
	});

	// -------------------------------------------------------------------------
	// 7. close ends all streams
	// -------------------------------------------------------------------------

	it("close removes all clients so no events are delivered after close", () => {
		const broadcaster = new EventBroadcaster();
		const c1 = createMockClient("c1");
		const c2 = createMockClient("c2");
		broadcaster.addClient(c1);
		broadcaster.addClient(c2);
		broadcaster.close();
		broadcaster.broadcast(BASE_EVENT);
		expect(c1.events).toHaveLength(0);
		expect(c2.events).toHaveLength(0);
		expect(broadcaster.clientCount).toBe(0);
	});

	// -------------------------------------------------------------------------
	// 8. replay on connect with lastEventId
	// -------------------------------------------------------------------------

	it("replays missed events when a client connects with lastEventId", () => {
		const broadcaster = new EventBroadcaster();
		// Broadcast 5 events before client connects
		const dummy = createMockClient("dummy");
		broadcaster.addClient(dummy);
		for (let i = 0; i < 5; i++) {
			broadcaster.broadcast({ type: "system", content: `msg-${i + 1}` });
		}

		// Connect new client with lastEventId=3 → should receive events 4 and 5
		const late = createMockClient("late");
		broadcaster.addClient(late, 3);
		expect(late.events).toHaveLength(2);
		expect(late.events[0].id).toBe(4);
		expect(late.events[1].id).toBe(5);
	});

	// -------------------------------------------------------------------------
	// 9. replay with unknown / zero lastEventId delivers all buffered
	// -------------------------------------------------------------------------

	it("replays all buffered events when lastEventId is 0 (before first event)", () => {
		const broadcaster = new EventBroadcaster();
		const dummy = createMockClient("dummy");
		broadcaster.addClient(dummy);
		for (let i = 0; i < 3; i++) {
			broadcaster.broadcast({ type: "system", content: `msg-${i + 1}` });
		}

		const late = createMockClient("late");
		broadcaster.addClient(late, 0);
		expect(late.events).toHaveLength(3);
		expect(late.events[0].id).toBe(1);
		expect(late.events[2].id).toBe(3);
	});

	// -------------------------------------------------------------------------
	// 10. replay buffer is a ring buffer
	// -------------------------------------------------------------------------

	it("ring buffer evicts oldest events when full", () => {
		const broadcaster = new EventBroadcaster({ replayBufferSize: 3 });
		const dummy = createMockClient("dummy");
		broadcaster.addClient(dummy);
		// Broadcast 5 events; ring buffer holds only last 3
		for (let i = 0; i < 5; i++) {
			broadcaster.broadcast({ type: "system", content: `msg-${i + 1}` });
		}

		// Connect with lastEventId=1 → events 1 and 2 have been evicted
		// Only events 3, 4, 5 are in the ring buffer
		const late = createMockClient("late");
		broadcaster.addClient(late, 1);
		expect(late.events).toHaveLength(3);
		expect(late.events[0].id).toBe(3);
		expect(late.events[1].id).toBe(4);
		expect(late.events[2].id).toBe(5);
	});

	// -------------------------------------------------------------------------
	// 11. slow client backpressure — dead client removed
	// -------------------------------------------------------------------------

	it("removes a dead client (send returns false) during broadcast", () => {
		const broadcaster = new EventBroadcaster();
		let callCount = 0;
		const deadClient: BroadcastClient = {
			id: "dead",
			send: () => {
				callCount++;
				return false; // signals dead
			},
		};
		broadcaster.addClient(deadClient);
		broadcaster.broadcast(BASE_EVENT);

		// After sending once and getting false, dead client should be removed
		expect(broadcaster.clientCount).toBe(0);
		// Second broadcast should not call dead client's send again
		broadcaster.broadcast(BASE_EVENT);
		expect(callCount).toBe(1);
	});

	// -------------------------------------------------------------------------
	// 12. broadcast to zero clients returns 0
	// -------------------------------------------------------------------------

	it("broadcast to zero clients returns 0", () => {
		const broadcaster = new EventBroadcaster();
		expect(broadcaster.broadcast(BASE_EVENT)).toBe(0);
	});
});
