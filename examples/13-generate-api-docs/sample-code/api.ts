import { Hono } from "hono";

const app = new Hono();

interface Task {
	id: string;
	title: string;
	status: "todo" | "in_progress" | "done";
	assignee?: string;
	createdAt: string;
}

const tasks: Task[] = [];

/** List all tasks, optionally filtered by status */
app.get("/api/tasks", (c) => {
	const status = c.req.query("status");
	const filtered = status ? tasks.filter((t) => t.status === status) : tasks;
	return c.json({ tasks: filtered, total: filtered.length });
});

/** Get a single task by ID */
app.get("/api/tasks/:id", (c) => {
	const task = tasks.find((t) => t.id === c.req.param("id"));
	if (!task) return c.json({ error: "Task not found" }, 404);
	return c.json(task);
});

/** Create a new task */
app.post("/api/tasks", async (c) => {
	const body = await c.req.json<{ title: string; assignee?: string }>();
	const task: Task = {
		id: crypto.randomUUID(),
		title: body.title,
		status: "todo",
		assignee: body.assignee,
		createdAt: new Date().toISOString(),
	};
	tasks.push(task);
	return c.json(task, 201);
});

/** Update a task's status */
app.patch("/api/tasks/:id", async (c) => {
	const task = tasks.find((t) => t.id === c.req.param("id"));
	if (!task) return c.json({ error: "Task not found" }, 404);
	const body = await c.req.json<{
		status?: Task["status"];
		assignee?: string;
	}>();
	if (body.status) task.status = body.status;
	if (body.assignee !== undefined) task.assignee = body.assignee;
	return c.json(task);
});

/** Delete a task */
app.delete("/api/tasks/:id", (c) => {
	const index = tasks.findIndex((t) => t.id === c.req.param("id"));
	if (index === -1) return c.json({ error: "Task not found" }, 404);
	tasks.splice(index, 1);
	return c.json({ deleted: true });
});

/** Health check */
app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
