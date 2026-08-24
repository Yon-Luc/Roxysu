import { app } from "./src/app";

let res = await app.handle(new Request("http://x/api/overlay/skins"));
console.log("GET:", res.status, await res.text());

res = await app.handle(new Request("http://x/api/overlay/skins", {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    mania: { version: 1 },
    sprites: { "7:notes:0": "data:image/png;base64,iVBORw0KGgo=", bad: "javascript:" },
  }),
}));
console.log("PUT:", res.status, await res.text());

res = await app.handle(new Request("http://x/api/overlay/skins"));
const body: any = await res.json();
console.log("sprite kept:", body.snapshot && "7:notes:0" in body.snapshot.sprites, "| junk dropped:", body.snapshot ? !("bad" in body.snapshot.sprites) : "-");
