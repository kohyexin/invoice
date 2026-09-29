-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "subtype" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "typeId" TEXT;

-- AlterTable
ALTER TABLE "Owner" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "InvoiceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Starting defaults (editable in Settings)
UPDATE "Owner" SET "isDefault" = true WHERE "name" = 'Jason Lin';

UPDATE "InvoiceItem" i SET "typeId" = t."id", "subtype" = m.subtype
FROM (VALUES
  ('Channel Development Fee', 'New Acquirer', ''),
  ('PCI Scanning Service Fee', 'PCI Audit', '{month}'),
  ('Merchant Integration Fee', 'Merchant', ''),
  ('Client Inquiry Support', 'Support Fee', 'Monthly'),
  ('Maintenance Fee', 'Whitelabel', 'Monthly'),
  ('Setup Fee', 'Setup Fee', 'One Time'),
  ('Merchant Support & Integration Services', 'Merchant', 'Monthly'),
  ('Servers Fee per IP (Refer to IP List)', 'Server Fee', '{month}'),
  ('PCI ASV Fee', 'PCI Audit', '{month}'),
  ('Feature Development Fee', 'New Feature', ''),
  ('Referral Fee', 'Referral Fee', ''),
  ('PCI DSS Consultancy Service Fee', 'PCI Audit', ''),
  ('Consultancy Fee', 'Other Fee', ''),
  ('Other Fee', 'Other Fee', '')
) AS m(label, type, subtype)
JOIN "InvoiceType" t ON t."name" = m.type
WHERE i."labelEn" = m.label;
