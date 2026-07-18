import { createDb, scores } from "./client.bun";

const db = createDb("./test.sqlite");

db.insert(scores)
  .values({
    beatmapId: "12345",
    accuracy: 9850,
    playedAt: new Date(),
  })
  .run();

console.log(db.select().from(scores).all());
