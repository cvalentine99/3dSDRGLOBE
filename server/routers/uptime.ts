import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import {
  getAllReceiverStatuses,
  getReceiverHistory,
  getRecentScanCycles,
  getAggregateStats,
} from "../statusPersistence";

export const uptimeRouter = router({
  allReceivers: publicProcedure.query(async () => {
    return await getAllReceiverStatuses();
  }),

  receiverHistory: publicProcedure
    .input(
      z.object({
        receiverUrl: z.string(),
        hoursBack: z.number().min(1).max(720).default(24),
      })
    )
    .query(async ({ input }) => {
      return await getReceiverHistory(input.receiverUrl, input.hoursBack);
    }),

  recentScans: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(48),
      })
    )
    .query(async ({ input }) => {
      return await getRecentScanCycles(input.limit);
    }),

  aggregateStats: publicProcedure.query(async () => {
    return await getAggregateStats();
  }),
});
