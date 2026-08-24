import { app } from "./src/app";
await app.handle(new Request("http://127.0.0.1:4321/api/overlay/skins", {
  method: "PUT",
  headers: { "content-type": "application/json" },
  // octet-stream mime, like the real desktop-app export produces
  body: JSON.stringify({ mania: { v: 1 }, sprites: { "4:notes:0": "data:application/octet-stream;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" } }),
}));
const res = await app.handle(new Request("http://127.0.0.1:4321/api/overlay/skins/sprites/4%3Anotes%3A0"));
console.log("sprite:", res.status, res.headers.get("content-type"), (await res.arrayBuffer()).byteLength + "B");
