import { Router } from "express";
import { z } from "zod";
import type { RetrievalService } from "./retrievalService.js";

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 50;

const querySchema = z.object({
  query: z.string().trim().min(1, "query is required"),
  topK: z.coerce.number().int().positive().max(MAX_TOP_K).optional(),
});

export function createRetrievalRouter(retrievalService: RetrievalService): Router {
  const router = Router();

  router.post("/query", async (req, res) => {
    const parsed = querySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid request" });
      return;
    }

    const results = await retrievalService.query(
      req.account!.id,
      parsed.data.query,
      parsed.data.topK ?? DEFAULT_TOP_K,
    );

    res.status(200).json({ results });
  });

  return router;
}
