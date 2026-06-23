-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

-- CreateTable
CREATE TABLE "TransitRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyword" TEXT NOT NULL,
    "transitDays" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "WeatherCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zip" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "maxTempF" REAL NOT NULL,
    "minTempF" REAL,
    "cachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "dontShipAbove" INTEGER NOT NULL DEFAULT 90,
    "icePackAbove" INTEGER NOT NULL DEFAULT 80,
    "dontShipBelow" INTEGER NOT NULL DEFAULT 35,
    "cautionBelow" INTEGER NOT NULL DEFAULT 45,
    "printLocalOrders" BOOLEAN NOT NULL DEFAULT false,
    "rolloverEnabled" BOOLEAN NOT NULL DEFAULT true,
    "delayEmailTemplate" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT
);

-- CreateTable
CREATE TABLE "TransitCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zip" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "cachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "EmailedOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "emailedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "TransitRule_keyword_key" ON "TransitRule"("keyword");

-- CreateIndex
CREATE UNIQUE INDEX "WeatherCache_zip_date_key" ON "WeatherCache"("zip", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TransitCache_zip_method_date_key" ON "TransitCache"("zip", "method", "date");

-- CreateIndex
CREATE UNIQUE INDEX "EmailedOrder_orderId_key" ON "EmailedOrder"("orderId");
