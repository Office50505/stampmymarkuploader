import { expireAbandonedUploads } from "../app/lib/cleanup.server";
import prisma from "../app/db.server";

try {
  const run = await expireAbandonedUploads();
  console.log(
    JSON.stringify(
      {
        cleanupRunId: run.id,
        expiredCount: run.expiredCount,
        deletedCount: run.deletedCount,
        errorCount: run.errorCount
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
