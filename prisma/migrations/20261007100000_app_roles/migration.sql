-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('OWNER', 'ADMIN');

-- CreateTable
CREATE TABLE "AppRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "system" "SystemRole",
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppRole_name_key" ON "AppRole"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AppRole_system_key" ON "AppRole"("system");

-- Seed the fixed roles and the two editable presets
INSERT INTO "AppRole" ("id", "name", "description", "system", "permissions", "sortOrder", "updatedAt") VALUES
  ('role_owner', 'Owner', 'Full access, including managing Owners.', 'OWNER', '{}', 0, CURRENT_TIMESTAMP),
  ('role_admin', 'Admin', 'Everything except changing the cash book and statement imports. Cannot manage Owners.', 'ADMIN', '{}', 1, CURRENT_TIMESTAMP),
  ('role_staff', 'Staff', 'Invoices, clients and system imports. Dashboard without amounts.', NULL,
    '{"dashboard":"VIEW","invoices":"EDIT","invoiceCreate":"EDIT","systemImports":"EDIT","clients":"EDIT","cashReports":"NONE","cashBook":"NONE","statementImport":"NONE","settings":"NONE"}', 2, CURRENT_TIMESTAMP),
  ('role_viewer', 'Viewer', 'Read-only invoices and clients. Dashboard without amounts.', NULL,
    '{"dashboard":"VIEW","invoices":"VIEW","invoiceCreate":"NONE","systemImports":"NONE","clients":"VIEW","cashReports":"NONE","cashBook":"NONE","statementImport":"NONE","settings":"NONE"}', 3, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "roleId" TEXT NOT NULL DEFAULT 'role_staff';

-- Backfill from the old enum: ADMIN becomes Owner
UPDATE "User" SET "roleId" = CASE "role"
  WHEN 'ADMIN' THEN 'role_owner'
  WHEN 'VIEWER' THEN 'role_viewer'
  ELSE 'role_staff'
END;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AppRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
