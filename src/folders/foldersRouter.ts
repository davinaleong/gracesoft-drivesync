import { Router } from "express";
import { z } from "zod";
import type { FolderService } from "./folderService.js";

const connectFolderSchema = z.object({
  folderId: z
    .string()
    .trim()
    .min(1, "folderId is required")
    .regex(/^[a-zA-Z0-9_-]+$/, "folderId doesn't look like a Google Drive file ID"),
});

function accessFailureMessage(
  reason: "not-found-or-not-shared" | "not-a-folder",
  serviceAccountEmail: string,
): string {
  if (reason === "not-a-folder") {
    return "That ID points to a file, not a folder. Paste the ID of a Drive folder instead.";
  }
  return `Folder not found or not accessible yet. Share it with ${serviceAccountEmail} (Viewer access is enough) and try again.`;
}

export function createFoldersRouter(folderService: FolderService, serviceAccountEmail: string): Router {
  const router = Router();

  router.post("/folders", async (req, res) => {
    const parsed = connectFolderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid request" });
      return;
    }

    const result = await folderService.connectFolder(req.account!.id, parsed.data.folderId);
    if (!result.ok) {
      res.status(422).json({ error: accessFailureMessage(result.reason, serviceAccountEmail) });
      return;
    }

    res.status(201).json({ folder: result.folder });
  });

  router.get("/folders", async (req, res) => {
    const folders = await folderService.listFolders(req.account!.id);
    res.json({ folders });
  });

  router.post("/folders/:id/verify", async (req, res) => {
    const result = await folderService.verifyFolder(req.account!.id, req.params.id!);

    if (!result.ok) {
      if (result.reason === "not-found") {
        res.status(404).json({ error: "folder not found" });
        return;
      }
      res.status(200).json({
        folder: result.folder,
        error: accessFailureMessage(result.reason, serviceAccountEmail),
      });
      return;
    }

    res.status(200).json({ folder: result.folder });
  });

  return router;
}
