import { createDb, scores } from "@roxysu/db/client.node";
import Realm from "realm";

const db = createDb(process.env.DB_PATH ?? "../server/data.sqlite");

console.log("realm-reader starting up, DB connected via @roxysu/db");

const path = "/home/yonluc/.local/share/osu/client.realm";

if (!path) {
  console.error("Usage: node test-realm.js <path-to-realm>");
  process.exit(1);
}

try {
  // Let Realm use the schema version embedded in the file (osu! = 51).
  const realm = new Realm({
    path,
    readOnly: true,
  });

  console.log("✅ Realm opened successfully");
  console.log("Path:", realm.path);
  console.log("Schemas:", realm.schema.map((s) => s.name).join(", "));

  realm.close();
} catch (err) {
  console.error("❌ Failed to open Realm");
  console.error(err);
}
