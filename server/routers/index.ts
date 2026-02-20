import { router } from "../_core/trpc";
import { systemRouter } from "../_core/systemRouter";
import { authRouter } from "./auth";
import { receiverRouter } from "./receiver";
import { tdoaRouter } from "./tdoa";
import { targetsRouter } from "./targets";
import { recordingsRouter } from "./recordings";
import { uptimeRouter } from "./uptime";
import { sharingRouter } from "./sharing";
import { fingerprintsRouter } from "./fingerprints";
import { anomaliesRouter } from "./anomalies";
import { analyticsRouter } from "./analytics";
import { ucdpRouter } from "./ucdp";
import { geofenceRouter } from "./geofence";
import { chatRouter } from "./chat";

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  receiver: receiverRouter,
  tdoa: tdoaRouter,
  targets: targetsRouter,
  recordings: recordingsRouter,
  uptime: uptimeRouter,
  sharing: sharingRouter,
  fingerprints: fingerprintsRouter,
  anomalies: anomaliesRouter,
  analytics: analyticsRouter,
  ucdp: ucdpRouter,
  geofence: geofenceRouter,
  chat: chatRouter,
});

export type AppRouter = typeof appRouter;
