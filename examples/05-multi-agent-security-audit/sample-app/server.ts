import { execSync } from "node:child_process";
import fs from "node:fs";
import express from "express";

const app = express();
app.use(express.json());

// VULN: Hardcoded secret
const _JWT_SECRET = "super-secret-key-12345";
const _DB_PASSWORD = "admin123";

// VULN: Command injection — user input passed directly to shell
app.get("/api/ping", (req, res) => {
	const host = req.query.host as string;
	const result = execSync(`ping -c 1 ${host}`).toString();
	res.send(result);
});

// VULN: Path traversal — no sanitization on file path
app.get("/api/files", (req, res) => {
	const filePath = req.query.path as string;
	const content = fs.readFileSync(filePath, "utf-8");
	res.send(content);
});

// VULN: XSS — user input reflected without escaping
app.get("/api/greet", (req, res) => {
	const name = req.query.name;
	res.send(`<html><body><h1>Hello ${name}!</h1></body></html>`);
});

// VULN: No CORS headers, no helmet, no rate limiting
app.listen(3000);
