import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

const app = new Hono();
app.get("/", (c) => streamSSE(c, async (stream) => {
    try {
        c.header("Content-Encoding", "Identity");
        await stream.writeSSE({ event: "test", data: "data" });
    } catch(e) {
        console.error("Caught error:", e.message);
    }
}));
const req = new Request("http://localhost/");
const res = await app.request(req);
console.log("Response headers:", res.headers.get("Content-Encoding"));
