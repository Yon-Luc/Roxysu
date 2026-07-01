import { Elysia } from "elysia";

import { staticPlugin } from "@elysiajs/static";
const app = new Elysia()
  .use(
    await staticPlugin({
      assets: "public",
      prefix: "/",
      indexHTML: true,
      bunFullstack: true,
    }),
  )
  .listen(3000);
console.log("🦊 Running at http://localhost:3000/public");
console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
