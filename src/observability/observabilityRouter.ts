import { Router } from "express";
import type { ObservabilityService } from "./observabilityService.js";

export function createObservabilityRouter(service: ObservabilityService): Router {
  const router = Router();

  router.get("/status", async (req, res) => {
    const folders = await service.getStatus(req.account!.id);
    res.status(200).json({ folders });
  });

  router.get("/audit", async (req, res) => {
    const audit = await service.getAudit(req.account!.id);
    res.status(200).json(audit);
  });

  return router;
}
