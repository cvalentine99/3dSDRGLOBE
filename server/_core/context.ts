import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getLocalOwner } from "./localAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await getLocalOwner();
  } catch (error) {
    console.warn("[Auth] Could not load local owner:", error);
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
