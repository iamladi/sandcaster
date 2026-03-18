import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
const app = new Hono();
app.get("/", (c) => streamSSE(c, async (stream) => {
    c.header("X-Custom", "123");
    await stream.writeSSE({ event: "test", data: "data" });
}));
const req = new Request("http://localhost/");
const res = await app.request(req);
console.log(res.headers.get("X-Custom"));
