import { app } from "./src/app";
for (const p of ["/api/overlay/profiles", "/api/overlay/skins"]) {
  const res = await app.handle(new Request(`http://127.0.0.1:4321${p}`));
  console.log(p, res.status);
}
