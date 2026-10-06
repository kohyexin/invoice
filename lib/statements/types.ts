export type StatementEntry = {
  /** yyyy-mm-dd */
  date: string;
  description: string;
  debit: number;
  credit: number;
  isInterest: boolean;
  /** Upper-cased payer or payee read from the description. */
  counterparty: string;
};

export type StatementSection = {
  currency: string;
  opening: number;
  closing: number;
  entries: StatementEntry[];
};

export type ParsedStatement = {
  bank: "ANEXT";
  accountNumber: string;
  accountName: string;
  accountType: string;
  bankName: string;
  accountLocation: string;
  /** yyyy-mm-dd */
  periodStart: string;
  periodEnd: string;
  sections: StatementSection[];
};
