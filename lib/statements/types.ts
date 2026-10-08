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

/** One cash book line of a bank line booked as several (e.g. an Ethoca bill net of a Shinecourse receipt). */
export type SplitRow = { categoryId: string; purpose: string; party: string; memo: string; amountIn: number; amountOut: number };
/** How a counterparty's lines were split, remembered without amounts. An empty memo means the bank's wording. */
export type SplitPattern = { categoryId: string; purpose: string; party: string; memo: string; direction: "in" | "out" };

export type StatementSection = {
  currency: string;
  opening: number;
  closing: number;
  entries: StatementEntry[];
};

export type ParsedStatement = {
  bank: "ANEXT" | "CIB" | "AIRWALLEX";
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
