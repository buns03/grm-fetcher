export interface RawRow {
  name: string;
  number: string;
  method: string; // payment method text (Bill page only)
  bank: string; // bank / channel text (Bill page only)
  total: string; // bill total (Bill page only)
  status: string; // already mapped: VERIFIED / UNVERIFIED (or the raw text if unknown)
  numberRaw: string;
  contact: string;
  amount: string;
  address: string;
}

export interface ResultRow {
  query: string; // the input line that produced this row
  matched: boolean;
  accountName: string;
  accountNumber: string;
  multiservicesStatus: string; // VERIFIED | UNVERIFIED | NOT FOUND
  multiservicesDetail: string; // e.g. "1 of 3 verified" (empty when single record)
  billStatus: string; // VERIFIED | UNVERIFIED | NO BILL
  billDetail: string;
  remark: string; // CASH PAYMENT / BANK PAYMENT (from the Bill payment method)
}

export interface LookupResponse {
  queries: string[];
  month: number;
  year: number;
  rows: ResultRow[];
  warnings: string[];
  fetchedAt: { multiservices: number; bill: number };
  fromCache: { multiservices: boolean; bill: boolean };
}

export interface UnpaidRow {
  query: string; // the input line
  accountName: string;
  accountNumber: string;
  month: number; // 0 when there is no unpaid bill to show
  year: number;
  total: string; // amount of the unpaid bill, as shown on the portal
  note: string; // '' | 'NO UNPAID BILLS' | 'NOT FOUND'
}

export interface UnpaidResponse {
  queries: string[];
  periods: { month: number; year: number }[];
  rows: UnpaidRow[];
  warnings: string[];
}
