import prisma from "~/db.server";
import { uploadConfig } from "./env.server";
import { deleteStoredObject } from "./storage.server";

export const expireAbandonedUploads = async () => {
  const run = await prisma.cleanupRun.create({
    data: {
      retentionDays: uploadConfig.retentionDays,
      deleteObjects: uploadConfig.deleteExpiredObjects
    }
  });

  const candidates = await prisma.upload.findMany({
    where: {
      status: { in: ["uploaded", "cart", "abandoned"] },
      orderedAt: null,
      expiresAt: { lte: new Date() }
    },
    take: 250
  });

  let deletedCount = 0;
  let errorCount = 0;

  for (const upload of candidates) {
    if (uploadConfig.deleteExpiredObjects) {
      try {
        await deleteStoredObject(upload.storageKey);
        deletedCount += 1;
      } catch (error) {
        errorCount += 1;
        console.error(`Failed to delete ${upload.storageKey}`, error);
      }
    }

    await prisma.upload.update({
      where: { uploadId: upload.uploadId },
      data: {
        status: "expired",
        expiredAt: new Date()
      }
    });
  }

  return prisma.cleanupRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      expiredCount: candidates.length,
      deletedCount,
      errorCount
    }
  });
};
