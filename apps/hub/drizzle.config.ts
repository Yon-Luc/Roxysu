import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "../../packages/db/src/hub/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./data/hub.sqlite",
  },
});
