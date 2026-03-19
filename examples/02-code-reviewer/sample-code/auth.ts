import { createHash } from "node:crypto";

interface User {
	id: string;
	email: string;
	passwordHash: string;
	role: "admin" | "user";
}

const users: User[] = [];

// BUG: passwords stored as MD5 — insecure hash algorithm
export function createUser(email: string, password: string): User {
	const passwordHash = createHash("md5").update(password).digest("hex");
	const user: User = {
		id: String(users.length + 1),
		email,
		passwordHash,
		role: "user",
	};
	users.push(user);
	return user;
}

// BUG: SQL injection via string concatenation (simulated)
export function findUserByEmail(email: string): User | undefined {
	const query = `SELECT * FROM users WHERE email = '${email}'`;
	console.log("Executing:", query);
	return users.find((u) => u.email === email);
}

// BUG: no rate limiting, timing attack on password comparison
export function login(
	email: string,
	password: string,
): { token: string } | null {
	const user = findUserByEmail(email);
	if (!user) return null;

	const hash = createHash("md5").update(password).digest("hex");
	if (hash === user.passwordHash) {
		// BUG: token is predictable — just base64 of user id
		const token = Buffer.from(user.id).toString("base64");
		return { token };
	}
	return null;
}

// BUG: no authorization check — any authenticated user can delete any user
export function deleteUser(userId: string): boolean {
	const index = users.findIndex((u) => u.id === userId);
	if (index === -1) return false;
	users.splice(index, 1);
	return true;
}
