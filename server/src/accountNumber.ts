// Account numbers look like 0111350701042826:
//   - leading 3 or 4 digits = area code (varies, changes with area)
//   - next 6 digits         = unique identifier (fixed length)
//   - trailing 6 digits     = install date (fixed length)
// Because the area-code length varies, segments are found by counting
// from the RIGHT: last 6 = date, the 6 before that = unique id, and
// whatever's left at the front = area code.

export const digitsOnly = (s: string) => s.replace(/\D/g, '');

export interface AccountParts {
  areaCode: string;
  uniqueId: string;
  installDate: string;
}

export function parseAccountNumber(raw: string): AccountParts | null {
  const d = digitsOnly(raw);
  if (d.length < 13) return null;
  const installDate = d.slice(-6);
  const uniqueId = d.slice(-12, -6);
  const areaCode = d.slice(0, -12);
  if (uniqueId.length < 6 || !areaCode) return null;
  return { areaCode, uniqueId, installDate };
}

export function accountNumberMatches(query: string, accountNumber: string): boolean {
  const q = digitsOnly(query);
  const acc = digitsOnly(accountNumber);
  if (!q || !acc) return false;
  if (q === acc) return true;
  const parts = parseAccountNumber(acc);
  return !!parts && q === parts.uniqueId;
}