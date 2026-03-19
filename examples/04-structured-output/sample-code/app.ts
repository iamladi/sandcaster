import express from "express";

const app = express();

// TODO: add request validation middleware
app.use(express.json());

// TODO: implement proper authentication instead of this stub
function _authenticate(req: any) {
	return req.headers.authorization === "Bearer secret";
}

// TODO: add pagination support for large result sets
app.get("/api/users", (_req, res) => {
	res.json({ users: [] });
});

// TODO: add input sanitization before database queries
app.post("/api/users", (req, res) => {
	const { name, email } = req.body;
	res.json({ id: 1, name, email });
});

// TODO: implement rate limiting to prevent abuse
// TODO: add request logging for debugging
app.listen(3000, () => {
	console.log("Server running on port 3000");
});
