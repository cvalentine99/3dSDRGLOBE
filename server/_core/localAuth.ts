/**
 * Single-user auth: whoever can reach the server is the owner.
 *
 * The app originally used Manus OAuth. It is now meant to run as a
 * personal instance, so every request is attributed to one local admin
 * account. Do not expose the server to the internet without putting
 * authentication (e.g. a reverse proxy with a password) in front of it.
 */
import type { User } from "../../drizzle/schema";
import * as db from "../db";

export const LOCAL_OWNER_OPEN_ID = "local-owner";

/** Used when no database is configured, so public pages still work. */
const OFFLINE_OWNER: User = {
  id: 1,
  openId: LOCAL_OWNER_OPEN_ID,
  name: "Owner",
  email: null,
  loginMethod: "local",
  role: "admin",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSignedIn: new Date(0),
};

let cachedOwner: User | null = null;
let pending: Promise<User> | null = null;

async function loadOwner(): Promise<User> {
  const existing = await db.getUserByOpenId(LOCAL_OWNER_OPEN_ID);
  if (existing) return existing;

  await db.upsertUser({
    openId: LOCAL_OWNER_OPEN_ID,
    name: "Owner",
    loginMethod: "local",
    role: "admin",
    lastSignedIn: new Date(),
  });
  return (await db.getUserByOpenId(LOCAL_OWNER_OPEN_ID)) ?? OFFLINE_OWNER;
}

/** Returns the local owner, creating the DB row on first use. */
export async function getLocalOwner(): Promise<User> {
  if (cachedOwner) return cachedOwner;
  if (!(await db.getDb())) return OFFLINE_OWNER;

  pending ??= loadOwner()
    .then((owner) => {
      // Only cache a real DB row; retry later if we fell back.
      if (owner !== OFFLINE_OWNER) cachedOwner = owner;
      return owner;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
