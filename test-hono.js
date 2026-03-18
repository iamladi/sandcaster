const { Hono } = require("hono");
const { streamSSE } = require("hono/streaming");
const app = new Hono();
app.get("/", (c) => streamSSE(c, async (stream) => {
    c.header("X-Custom", "123");
    await stream.writeSSE({ event: "test", data: "data" });
}));
const req = new Request("http://localhost/");
app.request(req).then(res => console.log(res.headers.get("X-Custom"))).catch(e => console.error(e));
