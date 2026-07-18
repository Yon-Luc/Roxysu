import { createDb, scores } from "@roxysu/db/client.node";

const db = createDb(process.env.DB_PATH ?? "../server/data.sqlite");

console.log("realm-reader starting up, DB connected via @roxysu/db");

// TODO: open Realm read-only, subscribeForNotifications, map + insert into `scores`
// import Realm from "realm";
