-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('HOUSE', 'APARTMENT', 'LAND');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('SALE', 'RENT');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('ACTIVE', 'PENDING', 'SOLD', 'RENTED', 'OFF_MARKET');

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "listing_type" "ListingType" NOT NULL,
    "type" "PropertyType" NOT NULL,
    "address" TEXT NOT NULL,
    "bedrooms" INTEGER,
    "baths" DECIMAL(3,1),
    "square_feet" INTEGER,
    "lot_size" INTEGER NOT NULL,
    "list_price" INTEGER NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "properties_listing_type_status_idx" ON "properties"("listing_type", "status");
