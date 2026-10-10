-- CreateIndex
CREATE INDEX "Session_shop_isOnline_idx" ON "Session"("shop", "isOnline");

-- CreateIndex
CREATE INDEX "PostalCode_shop_zoneId_idx" ON "PostalCode"("shop", "zoneId");

-- CreateIndex
CREATE INDEX "PostalCodeSearchEvent_shop_available_createdAt_idx" ON "PostalCodeSearchEvent"("shop", "available", "createdAt");
