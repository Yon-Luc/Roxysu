import { createDb } from "@roxysu/db/client.node";
import path from "node:path";
import Realm from "realm";
import { loadOsuSchema } from "./schema";

const db = createDb(process.env.DB_PATH ?? "../server/data.sqlite");
console.log("realm-reader starting up, DB connected via @roxysu/db");

const realmPath =
  process.env.REALM_PATH ??
  path.join(process.env.HOME ?? "", ".local/share/osu/client.realm");

const { schemaVersion, schema } = loadOsuSchema();

try {
  const realm = new Realm({
    path: realmPath,
    schema,
    schemaVersion,
    readOnly: true,
  });

  console.log("✅ Realm opened successfully");
  console.log("Path:", realm.path);
  console.log("schemaVersion:", realm.schemaVersion);
  console.log(
    "Schemas:",
    realm.schema.map((s) => s.name).join(", "),
  );

  realm.close();
} catch (err) {
  console.error("❌ Failed to open Realm");
  console.error(err);
}
