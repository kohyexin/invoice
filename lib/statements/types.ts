export type StatementEntry = {
  /** yyyy-mm-dd */
  date: string;
  description: string;
  debit: number;
  credit: number;
  isInterest: boolean;
  /** Upper-cased payer or payee read from the description. */
  counterparty: string;
  /** The bank's own id for the transaction, when it gives one. Lines with a ref are keyed by it. */
  ref?: string;
  /** Balance after the entry and its bank timestamp, for statements that give them per line. */
  balance?: number;
  time?: string;
};

export type StatementSection = {
  currency: string;
  opening: number;
  closing: number;
  entries: StatementEntry[];
};

export type ParsedStatement = {
  bank: "ANEXT" | "CIB";
  accountNumber: string;
  accountName: string;
  accountType: string;
  bankName: string;
  accountLocation: string;
  /** yyyy-mm-dd */
  periodStart: string;
  periodEnd: string;
  /** True when the period covers only part of its calendar month. */
  partial?: boolean;
  sections: StatementSection[];
};
