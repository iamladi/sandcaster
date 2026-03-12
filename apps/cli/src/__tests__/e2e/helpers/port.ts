import { createServer } from "node:net";

/**
 * Find a free port by binding to port 0 and reading the assigned port.
 */
export function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, () => {
			const addr = server.address();
			if (addr && typeof addr === "object") {
				const port = addr.port;
				server.close(() => resolve(port));
			} else {
				server.close(() => reject(new Error("Failed to get port")));
			}
		});
		server.on("error", reject);
	});
}
