ALTER TABLE "Upload"
ADD COLUMN "ipAddress" TEXT,
ADD COLUMN "ipCountryCode" TEXT,
ADD COLUMN "ipCountry" TEXT,
ADD COLUMN "ipContinentCode" TEXT,
ADD COLUMN "ipContinent" TEXT,
ADD COLUMN "ipAsn" TEXT,
ADD COLUMN "ipAsName" TEXT,
ADD COLUMN "ipAsDomain" TEXT,
ADD COLUMN "ipGeolocatedAt" TIMESTAMP(3);

CREATE INDEX "Upload_shop_ipCountryCode_idx" ON "Upload"("shop", "ipCountryCode");
