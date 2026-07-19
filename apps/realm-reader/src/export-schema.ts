import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Realm from "realm";
import { platformDefaultOsuDataPath } from "./osu-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const realmPath =
  process.env.REALM_PATH ??
  path.join(platformDefaultOsuDataPath(), "client.realm");

const outPath =
  process.env.SCHEMA_OUT ??
  path.join(__dirname, "..", "schemas", "osu-client.schema.json");

function serializeProperty(prop: Realm.PropertySchema): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: prop.type,
    optional: prop.optional ?? false,
    indexed: prop.indexed ?? false,
  };
  if (prop.objectType) out.objectType = prop.objectType;
  if (prop.mapTo) out.mapTo = prop.mapTo;
  if (prop.default !== undefined) out.default = prop.default;
  return out;
}

function serializeSchema(schema: Realm.ObjectSchema) {
  return {
    name: schema.name,
    primaryKey: schema.primaryKey,
    embedded: schema.embedded ?? false,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        typeof value === "string" ? value : serializeProperty(value),
      ]),
    ),
  };
}

async function main() {
  const realm = new Realm({ path: realmPath, readOnly: true });

  try {
    const payload = {
      exportedAt: new Date().toISOString(),
      realmPath,
      schemaVersion: realm.schemaVersion,
      schema: realm.schema.map(serializeSchema),
    };

    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);

    console.log(
      `Exported ${payload.schema.length} schemas (v${payload.schemaVersion}) → ${outPath}`,
    );
    console.log(payload.schema.map((s) => s.name).join(", "));
  } finally {
    realm.close();
  }
}

main()
  .then(() => {
    // Realm's native addon keeps the event loop alive after close().
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
