export interface ResultRow {
  query: string;
  matched: boolean;
  accountName: string;
  accountNumber: string;
  multiservicesStatus: string;
  multiservicesDetail: string;
  billStatus: string;
  billDetail: string;
  remark: string;
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
  query: string;
  accountName: string;
  accountNumber: string;
  month: number;
  year: number;
  total: string;
  note: string;
}

export interface UnpaidResponse {
  queries: string[];
  periods: { month: number; year: number }[];
  rows: UnpaidRow[];
  warnings: string[];
}
