import { ensureDb, scores } from "./client.bun";

const db = ensureDb("./test.sqlite");

db.insert(scores)
  .values({
    id: "00000000-0000-0000-0000-000000000001",
    onlineId: 0,
    legacyOnlineId: 0,
    beatmapId: null,
    accuracy: 0.985,
    playedAt: new Date(),
    totalScore: 1_000_000,
  })
  .run();

console.log(db.select().from(scores).all());
