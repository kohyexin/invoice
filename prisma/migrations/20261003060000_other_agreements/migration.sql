-- AlterTable
ALTER TABLE "Client" ADD COLUMN "otherAgreements" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Agreements the Jotform import parked in the fee schedule move to the new column.
UPDATE "Client"
SET "otherAgreements" = ARRAY(
      SELECT DISTINCT upper(trim(v))
      FROM (VALUES (fees->>'PCI AGREEMENT NO.'), (fees->>'OTHER AGREEMENT NO.')) AS t(v)
      WHERE coalesce(trim(v), '') <> ''
    ),
    fees = fees - 'PCI AGREEMENT NO.' - 'PCI AGREEMENT DATE' - 'OTHER AGREEMENT NO.' - 'OTHER AGREEMENT DATE'
WHERE fees ?| ARRAY['PCI AGREEMENT NO.', 'OTHER AGREEMENT NO.'];
