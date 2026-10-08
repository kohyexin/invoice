import "dotenv/config";
import { PrismaClient, type Currency } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { CASH_CATEGORIES, MOONLINK } from "../lib/cash-seed";

/* Starting settings, taken from the Type sheet of
   "Star SaaS Client Invoice Repayment Status v2.0.xlsm". Safe to re-run. */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }),
});

const TERMS_EN = [
  "• Kindly make the payment within 7 days from the invoice issue date.",
  "• The transfer fees are to be covered by the sender of the funds",
];
const TERMS_ZH = ["• 请在发票开具之日起7天内付款。", "• 转账费用由资金发送方承担"];

const companies = [
  {
    code: "SPARK",
    legalName: "SPARK PSP LIMITED",
    addressLines: ["Unit 1402A, 14/F The Belgian Bank Building", "No. 721- 725, Nathan Road", "Mongkok Hong Kong"],
    logoPath: "/logos/spark.png",
    defaultLang: "EN" as const,
  },
  {
    code: "STAR",
    legalName: "STAR SAAS LIMITED",
    addressLines: ["Flat 1506, 15/F Lucky Center", "No. 165-171 Wan Chai Road", "Wan Chai Hong Kong"],
    logoPath: "/logos/star.png",
    defaultLang: "EN" as const,
  },
  {
    code: "XIAMEN",
    legalName: "厦门星知付科技有限公司",
    addressLines: ["厦门市翔安区新店镇东界宋洋里156号"],
    logoPath: "/logos/star.png",
    defaultLang: "ZH" as const,
  },
];

const SCB = {
  bankName: "Standard Chartered Bank (Hong Kong) Ltd",
  bankAddress: "32nd Floor, 4-4A Des Voeux Road Central",
  bankCode: "003",
  swiftCode: "SCBLHKHH",
  accountLocation: "Hong Kong (China)",
};
const DBS = {
  bankName: "DBS Bank (Hong Kong) Limited",
  bankAddress: "11th Floor, The Center, 99 Queen’s Road Central, Central, Hong Kong",
  bankCode: "016",
  branchCode: "478",
  swiftCode: "DHBKHKHH",
  accountLocation: "Hong Kong (China)",
};
const IBC = {
  accountName: "厦门星知付科技有限公司",
  bankName: "兴业银行",
  bankAddress: "NO.78, NORTH HUBIN ROAD, XIAMEN, FUJIAN PROVINCE, 361012 P.R.CHINA",
  bankCode: "4071",
  branchCode: "厦门观音山支行",
  swiftCode: "FJIBCNBA260",
  accountLocation: "厦门",
};

type Account = {
  label: string;
  currency: Currency;
  accountName: string;
  accountNumber: string;
  bankName?: string;
  bankAddress?: string;
  bankCode?: string;
  branchCode?: string;
  swiftCode?: string;
  accountLocation?: string;
  compact?: boolean;
};

const accounts: Account[] = [
  { label: "USD (SCB Bank)", currency: "USD", accountName: "Star SaaS Limited", accountNumber: "47417790780", ...SCB, branchCode: "474" },
  { label: "HKD (SCB Bank)", currency: "HKD", accountName: "Star SaaS Limited", accountNumber: "47416857504", ...SCB, branchCode: "474" },
  { label: "EUR (SCB Bank)", currency: "EUR", accountName: "Star SaaS Limited", accountNumber: "57210157094", ...SCB, branchCode: "572" },
  { label: "USD (DBS Bank)", currency: "USD", accountName: "STAR SAAS LIMITED", accountNumber: "7983668446", ...DBS },
  { label: "HKD (DBS Bank)", currency: "HKD", accountName: "STAR SAAS LIMITED", accountNumber: "7983668446", ...DBS },
  { label: "USD (IBC Bank)", currency: "USD", accountNumber: "129961400100075317", ...IBC },
  { label: "EUR (IBC Bank)", currency: "EUR", accountNumber: "129961100100010805", ...IBC },
  { label: "CNY (IBC Bank)", currency: "CNY", accountNumber: "129960100100474016", ...IBC },
  { label: "USD (GEP)", currency: "USD", accountName: "STAR SAAS LIMITED", accountNumber: "799002738", ...DBS },
  { label: "HKD (GEP)", currency: "HKD", accountName: "STAR SAAS LIMITED", accountNumber: "799002738", ...DBS },
  { label: "EUR (GEP)", currency: "EUR", accountName: "STAR SAAS LIMITED", accountNumber: "799002738", ...DBS },
  { label: "USD (SPARK DBS)", currency: "USD", accountName: "SPARK PSP LIMITED", accountNumber: "7950125534", ...DBS },
  { label: "Airwallex Pay", currency: "USD", accountName: "Star SaaS Limited", accountNumber: "47417790780", compact: true },
];

/** [company code | null, currency | null, account label] */
const rules: [string | null, Currency | null, string][] = [
  ["SPARK", null, "USD (SPARK DBS)"],
  ["STAR", null, "USD (SCB Bank)"],
  ["STAR", "HKD", "HKD (SCB Bank)"],
  ["STAR", "EUR", "EUR (SCB Bank)"],
  ["XIAMEN", null, "CNY (IBC Bank)"],
  [null, "CNY", "CNY (IBC Bank)"],
];

const owners = ["Robert Ang", "Jason Lin", "Robin Koh", "江总"];

/** `WL & Server` is folded into Whitelabel; every other type is unchanged. */
const types: [string, string | null][] = [
  ["Merchant", null],
  ["Whitelabel", null],
  ["Acquirer Comm.", null],
  ["Setup Fee", null],
  ["New Acquirer", "Acquirer name"],
  ["PCI Audit", null],
  ["New Feature", "What the feature is"],
  ["Referral Fee", null],
  ["Support Fee", null],
  ["Server Fee", null],
  ["Other Fee", null],
  ["Gateway", null],
  ["Self Onboarding", null],
];

/** [English, Chinese, detail hint, client fee field]. Chinese labels are only
 *  the ones the workbook already uses; blank falls back to English. */
const items: [string, string, string | null, string | null][] = [
  ["Channel Development Fee", "渠道对接费", "Channel :", null],
  ["PCI Scanning Service Fee", "", "Service Period : 1 Year", "PCI SCANNING SERVICE FEE"],
  ["Merchant Integration Fee", "", "Month :", null],
  ["Client Inquiry Support", "", "Month :", "CLIENT INQUIRY FEE"],
  ["Maintenance Fee", "维护费", "Month :", "MAINTENANCE FEE"],
  ["Setup Fee", "设置费", "One Time", "SETUP FEE"],
  ["Merchant Support & Integration Services", "", "Monthly:", null],
  ["Servers Fee per IP (Refer to IP List)", "", null, "SERVER FEE"],
  ["PCI ASV Fee", "", null, null],
  ["Feature Development Fee", "", "Feature:", null],
  ["Referral Fee", "", null, null],
  ["PCI DSS Consultancy Service Fee", "PCI DSS 咨询服务费", null, null],
  ["Consultancy Fee", "顾问费用", null, null],
  ["Other Fee", "", null, null],
];

/** USD per unit. CNY follows the 6.7 used on the Chinese invoice templates. */
const fx: [Currency, number][] = [
  ["HKD", 1 / 7.8],
  ["CNY", 1 / 6.7],
  ["EUR", 1.08],
  ["SGD", 0.74],
  ["CNH", 1 / 6.7],
];

async function main() {
  const companyIds: Record<string, string> = {};
  for (const [i, c] of companies.entries()) {
    const row = await prisma.company.upsert({
      where: { code: c.code },
      update: {},
      create: { ...c, termsEn: TERMS_EN, termsZh: TERMS_ZH, sortOrder: i },
    });
    companyIds[c.code] = row.id;
  }

  const accountIds: Record<string, string> = {};
  for (const [i, a] of accounts.entries()) {
    const row = await prisma.bankAccount.upsert({
      where: { label: a.label },
      update: {},
      create: { ...a, sortOrder: i },
    });
    accountIds[a.label] = row.id;
  }

  for (const [code, currency, label] of rules) {
    const companyId = code ? companyIds[code] : null;
    const existing = await prisma.paymentRule.findFirst({ where: { companyId, currency } });
    if (!existing) {
      await prisma.paymentRule.create({
        data: { companyId, currency, bankAccountId: accountIds[label] },
      });
    }
  }

  for (const [i, name] of owners.entries()) {
    await prisma.owner.upsert({ where: { name }, update: {}, create: { name, sortOrder: i } });
  }

  for (const [i, [name, subtypeHint]] of types.entries()) {
    await prisma.invoiceType.upsert({
      where: { name },
      update: {},
      create: { name, subtypeHint, sortOrder: i },
    });
  }

  if ((await prisma.invoiceItem.count()) === 0) {
    await prisma.invoiceItem.createMany({
      data: items.map(([labelEn, labelZh, detailHint, clientFee], i) => ({
        labelEn,
        labelZh,
        detailHint,
        clientFee,
        sortOrder: i,
      })),
    });
  }

  for (const [currency, usdPerUnit] of fx) {
    await prisma.fxRate.upsert({
      where: { currency },
      update: {},
      create: { currency, usdPerUnit },
    });
  }

  await prisma.company.upsert({
    where: { code: MOONLINK.code },
    update: {},
    create: { ...MOONLINK, termsEn: [], termsZh: [], sortOrder: companies.length },
  });
  for (const [i, [nameZh, nameEn, kind]] of CASH_CATEGORIES.entries()) {
    await prisma.cashCategory.upsert({ where: { nameZh }, update: {}, create: { nameZh, nameEn, kind, sortOrder: i } });
  }

  console.log("Seeded companies, bank accounts, payment rules, owners, types, items, FX rates, cash categories.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
