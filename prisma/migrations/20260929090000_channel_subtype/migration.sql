-- Channel Development Fee lines record the channel in their detail ("Channel : Alipay"); the ledger subtype is that channel.
UPDATE "InvoiceItem" SET "subtype" = '{detail}' WHERE "labelEn" = 'Channel Development Fee' AND "subtype" = '';
