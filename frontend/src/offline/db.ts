import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { QueueItem } from "./types";

/**
 * What a technician's phone keeps for them, in one database per person (wiped when they sign out):
 *   cache   the last copy of each screen's data, to read offline
 *   outbox  changes not yet on the server, in order
 *   blobs   the photos and videos of queued uploads
 *   meta    the server's IDs for things made offline
 * Used by the app and by the service worker (which sends the queue with the app closed).
 */
interface OfflineSchema extends DBSchema {
  cache: { key: string; value: { path: string; data: unknown; savedAt: number } };
  outbox: { key: number; value: QueueItem; indexes: { id: string } };
  blobs: { key: string; value: Blob };
  meta: { key: string; value: Record<string, number> };
}

export type OfflineDB = IDBPDatabase<OfflineSchema>;

const name = (userId: number) => `mechanicpro-${userId}`;

export async function openOffline(userId: number) {
  const db: OfflineDB = await openDB<OfflineSchema>(name(userId), 1, {
    upgrade(created) {
      created.createObjectStore("cache", { keyPath: "path" });
      created.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true }).createIndex("id", "id", { unique: true });
      created.createObjectStore("blobs");
      created.createObjectStore("meta");
    },
    // Signing out in another tab deletes this database: let go of it, so that never waits.
    blocking() {
      db.close();
    },
  });
  return db;
}

export function wipeOffline(userId: number) {
  return deleteDB(name(userId));
}

export const listItems = (db: OfflineDB) => db.getAll("outbox");
export const getItem = (db: OfflineDB, seq: number) => db.get("outbox", seq);
export const putItem = (db: OfflineDB, item: QueueItem) => db.put("outbox", item);

export async function addItem(db: OfflineDB, item: QueueItem, blob?: Blob) {
  const tx = db.transaction(["outbox", "blobs"], "readwrite");
  const seq = await tx.objectStore("outbox").add(item);
  if (blob) await tx.objectStore("blobs").put(blob, item.id);
  await tx.done;
  return { ...item, seq };
}

export async function deleteItem(db: OfflineDB, item: QueueItem) {
  const tx = db.transaction(["outbox", "blobs"], "readwrite");
  if (item.seq !== undefined) await tx.objectStore("outbox").delete(item.seq);
  await tx.objectStore("blobs").delete(item.id);
  await tx.done;
}

export const getBlob = (db: OfflineDB, id: string) => db.get("blobs", id);

export const readCache = (db: OfflineDB, path: string) => db.get("cache", path);
export const writeCache = (db: OfflineDB, path: string, data: unknown) => db.put("cache", { path, data, savedAt: Date.now() });
export const clearCache = (db: OfflineDB) => db.clear("cache");

export async function readTemps(db: OfflineDB) {
  return (await db.get("meta", "temps")) ?? {};
}

export async function saveTemp(db: OfflineDB, temp: number, real: number) {
  const temps = await readTemps(db);
  temps[String(temp)] = real;
  await db.put("meta", temps, "temps");
}
