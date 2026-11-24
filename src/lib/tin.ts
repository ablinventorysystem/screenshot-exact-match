/** BIR TIN: 000-000-000-00000 (9-digit TIN + 5-digit branch code). */
export const TIN_PATTERN = /^\d{3}-\d{3}-\d{3}-\d{5}$/;

export function isValidTin(tin: string): boolean {
  return TIN_PATTERN.test(tin.trim());
}

/** Formats any digits typed into 000-000-000-00000, padding a missing branch code with 00000. */
export function formatTin(input: string): string {
  const d = input.replace(/\D/g, "").slice(0, 14);
  if (d.length < 9) return input.trim();
  const branch = d.slice(9).padEnd(5, "0");
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6, 9)}-${branch}`;
}

export function branchCodeOf(tin: string): string | null {
  return isValidTin(tin) ? tin.trim().slice(-5) : null;
}
