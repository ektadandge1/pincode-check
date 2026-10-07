BEGIN TRANSACTION;

CREATE TABLE "new_ImportError" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "importJobId" INTEGER NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawRow" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportError_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Discard historical orphans: their owning shop can no longer be determined.
INSERT INTO "new_ImportError" ("id", "importJobId", "rowNumber", "rawRow", "reason", "createdAt")
SELECT "id", "importJobId", "rowNumber", "rawRow", "reason", "createdAt"
FROM "ImportError"
WHERE EXISTS (SELECT 1 FROM "ImportJob" WHERE "ImportJob"."id" = "ImportError"."importJobId");

DROP TABLE "ImportError";
ALTER TABLE "new_ImportError" RENAME TO "ImportError";
CREATE INDEX "ImportError_importJobId_idx" ON "ImportError"("importJobId");

COMMIT;
