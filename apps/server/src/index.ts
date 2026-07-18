import { app } from "./app";
import { db } from "./db";
import { startPollLoop } from "./sse";

app.listen(3000);
startPollLoop(db);

console.log(
  `🦊 Roxysu running at http://${app.server?.hostname}:${app.server?.port}`,
);

export type { App } from "./app";
