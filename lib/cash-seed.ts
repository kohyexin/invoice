import type { CashKind, Currency } from "./generated/prisma/client";

/* Starting cash-book settings, from "Star SaaS Balance Sheet 2.0.xlsx".
   Shared by prisma/seed.ts and scripts/import-balance-sheet.ts. */

export const MOONLINK = {
  code: "MOONLINK",
  legalName: "Moonlink Ventures Pte Ltd",
  addressLines: [] as string[],
  invoicing: false,
};

/** [摘要, English, kind] — every value used in the workbook's 摘要 column. */
export const CASH_CATEGORIES: [string, string, CashKind][] = [
  ["营业收入", "Client payment", "INCOME"],
  ["主营业务收入", "Main business revenue", "INCOME"],
  ["工资", "Salary", "EXPENSE"],
  ["薪资福利", "Staff benefits (CPF, social insurance)", "EXPENSE"],
  ["办公费用", "Office expenses", "EXPENSE"],
  ["渠道费用", "Channel fees", "EXPENSE"],
  ["测试相关", "Testing", "EXPENSE"],
  ["营业成本", "Operating cost", "EXPENSE"],
  ["主营业务成本", "Cost of main business", "EXPENSE"],
  ["特殊费用", "Special expenses", "EXPENSE"],
  ["财务费用", "Finance costs", "EXPENSE"],
  ["内部资金", "Internal funds", "TRANSFER"],
  ["资金相关", "Funds (fees, interest, transfers)", "TRANSFER"],
];

export type CashAccountSeed = {
  /** Workbook sheet the lines come from. */
  sheet: string;
  /** Existing invoice account to reuse (set to "both"), or the label of a new balance-only account. */
  label: string;
  existing?: boolean;
  company: "STAR" | "XIAMEN" | "MOONLINK";
  bankName: string;
  accountName: string;
  currency: Currency;
  /** Known bank details. The importer fills these only where Settings is still blank. */
  details?: {
    accountNumber?: string;
    accountType?: string;
    bankName?: string;
    bankAddress?: string;
    bankCode?: string;
    branchCode?: string;
    swiftCode?: string;
    accountLocation?: string;
  };
};

const STAR = "STAR SAAS LIMITED";
const XIAMEN = "厦门星知付科技有限公司";
/** Industrial Bank details, from the invoice workbook's Type sheet. */
const CIB = {
  bankName: "兴业银行",
  bankAddress: "NO.78, NORTH HUBIN ROAD, XIAMEN, FUJIAN PROVINCE, 361012 P.R.CHINA",
  branchCode: "厦门观音山支行",
  swiftCode: "FJIBCNBA260",
  accountLocation: "厦门",
};
/** Airwallex Global Accounts (receiving details held at Standard Chartered Hong Kong). */
const AIRWALLEX_GA = {
  accountType: "Airwallex Global Account",
  bankAddress: "32nd Floor, 4-4A Des Voeux Road Central",
  bankCode: "003",
  swiftCode: "SCBLHKHH",
  accountLocation: "Hong Kong SAR",
};

/** The live sheets. S-, Others and Jason are closed and left out. */
export const CASH_ACCOUNTS: CashAccountSeed[] = [
  {
    sheet: "M - S$",
    label: "SGD (ANEXT)",
    company: "MOONLINK",
    bankName: "ANEXT BANK PTE. LTD.",
    accountName: "MOONLINK VENTURES PTE. LTD.",
    currency: "SGD",
    details: {
      accountNumber: "11568506601",
      accountType: "ANEXT Business Account",
      bankAddress: "128 Beach Road, Guoco Midtown Unit 21-01, Singapore 189773",
      swiftCode: "ANTPSGSGXXX",
      accountLocation: "Singapore",
    },
  },
  { sheet: "G - $", label: "USD (GEP)", existing: true, company: "STAR", bankName: "GEP", accountName: STAR, currency: "USD" },
  { sheet: "G - H$", label: "HKD (GEP)", existing: true, company: "STAR", bankName: "GEP", accountName: STAR, currency: "HKD" },
  { sheet: "G - CNY", label: "CNY (GEP)", company: "STAR", bankName: "GEP", accountName: STAR, currency: "CNY" },
  { sheet: "G - CNH", label: "CNH (GEP)", company: "STAR", bankName: "GEP", accountName: STAR, currency: "CNH" },
  { sheet: "O - $", label: "USD (OTT)", company: "STAR", bankName: "OTT", accountName: STAR, currency: "USD" },
  { sheet: "O - €", label: "EUR (OTT)", company: "STAR", bankName: "OTT", accountName: STAR, currency: "EUR" },
  { sheet: "O - H$", label: "HKD (OTT)", company: "STAR", bankName: "OTT", accountName: STAR, currency: "HKD" },
  { sheet: "O - ￥", label: "CNY (OTT)", company: "STAR", bankName: "OTT", accountName: STAR, currency: "CNY" },
  {
    sheet: "A - $",
    label: "Airwallex Pay",
    existing: true,
    company: "STAR",
    bankName: "Airwallex",
    accountName: STAR,
    currency: "USD",
    details: { accountNumber: "47417790780", branchCode: "474", ...AIRWALLEX_GA },
  },
  {
    sheet: "A - €",
    label: "EUR (Airwallex)",
    company: "STAR",
    bankName: "Airwallex",
    accountName: STAR,
    currency: "EUR",
    details: { accountNumber: "57210157094", branchCode: "572", ...AIRWALLEX_GA },
  },
  {
    sheet: "A - H$",
    label: "HKD (Airwallex)",
    company: "STAR",
    bankName: "Airwallex",
    accountName: STAR,
    currency: "HKD",
    details: { accountNumber: "47416857504", branchCode: "474", ...AIRWALLEX_GA },
  },
  { sheet: "A - S$", label: "SGD (Airwallex)", company: "STAR", bankName: "Airwallex", accountName: STAR, currency: "SGD" },
  { sheet: "A - ¥", label: "CNY (Airwallex)", company: "STAR", bankName: "Airwallex", accountName: STAR, currency: "CNY" },
  { sheet: "XMXY - $", label: "USD (XMXY)", company: "XIAMEN", bankName: "", accountName: XIAMEN, currency: "USD", details: { accountNumber: "129961400100075317", ...CIB } },
  { sheet: "XMXY - ¥", label: "CNY (XMXY)", company: "XIAMEN", bankName: "", accountName: XIAMEN, currency: "CNY", details: { accountNumber: "129960100100474016", ...CIB } },
];
