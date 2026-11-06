import 'dotenv/config';

export const config = {
  baseUrl: 'https://glercimor.com',
  port: Number(process.env.PORT ?? 4000),
  username: process.env.GLERCIMOR_USERNAME ?? '',
  password: process.env.GLERCIMOR_PASSWORD ?? '',
  headless: (process.env.HEADLESS ?? 'true') !== 'false',

  pages: {
    login: '/auth',
    multiservices: '/customer/multiservices',
    bill: '/bill',
  },

  // Table header text -> which column is which. Tune after `npm run inspect`.
  columns: {
    name: /account\s*name|customer\s*name|subscriber|full\s*name|^\s*name\s*$/i,
    number: /account\s*(no|num|number|#|id)|acct|^\s*account\s*$|subscriber\s*(no|id)/i,
    status: /^\s*status\s*$/i,
    // Bill table: how it was paid (Cash, GCash, BDO, ...). Used for the Remark column.
    method: /method|mode\s*of\s*payment|payment\s*(type|mode)/i,
    bank: /bank|channel|gateway|provider|wallet/i,
    // Bill table: amount due. A total of 0 means the remark is FREE.
    total: /^\s*(grand\s*)?total(\s*(amount|bill|due))?\s*$/i,
    contact: /contact|phone|mobile|cell/i,
amount: /^(?!.*status).*bill/i,
address: /address/i,
  },

  // Portal status (upper-cased) -> label shown in this system.
  statusMap: { PAID: 'VERIFIED', UNPAID: 'UNVERIFIED', 'NON ACTIVE': 'NON-ACTIVE', NONACTIVE: 'NON-ACTIVE', INACTIVE: 'NON-ACTIVE' } as Record<string, string>,

  // Optional CSS selector overrides, only needed if auto-detection fails.
  selectors: {
    multiStatus: undefined as string | undefined,
    billStatus: '#status' as string | undefined,
    billMonth: '#month' as string | undefined,
    billYear: '#year' as string | undefined,
  },
};
