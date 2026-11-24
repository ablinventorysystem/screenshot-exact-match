/**
 * Philippine VAT / percentage tax / EWT computation.
 * Pure functions: every rate comes from the caller (company settings, tax code
 * table, ATC table) — nothing is hardcoded except the statutory SC/PWD 20%.
 */

export type TaxKind = "vat" | "exempt" | "zero_rated" | "percentage";
export type PriceMode = "exclusive" | "inclusive";
export type DiscountType = "none" | "regular" | "senior" | "pwd";

export interface TaxLineInput {
  qty: number;
  rate: number;
  /** Tax code kind of the line */
  kind: TaxKind;
  /** Tax code rate in percent, e.g. 12 */
  taxRate: number;
}

export interface TaxOptions {
  priceMode: PriceMode;
  /** Seller is VAT-registered. When false, VAT lines carry no VAT and percentage tax applies. */
  vatRegistered: boolean;
  /** Percentage tax rate for Non-VAT sellers, e.g. 3 */
  percentageTaxRate: number;
  discountType: DiscountType;
  /** Percent for regular discounts, e.g. 5 */
  discountRate: number;
  /** EWT rate in percent from the ATC table, applied on the net-of-VAT base */
  ewtRate: number;
}

export interface TaxLineResult {
  gross: number;
  net: number;
  vat: number;
}

export interface TaxResult {
  lines: TaxLineResult[];
  vatableSales: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  /** Sales of a Non-VAT seller (subject to percentage tax) */
  nonVatSales: number;
  totalSales: number;
  vatAmount: number;
  percentageTax: number;
  discountAmount: number;
  totalAmountDue: number;
  ewtAmount: number;
  amountDueAfterWithholding: number;
}

/** Statutory Senior Citizen / PWD discount (RA 9994, RA 10754). */
export const SC_PWD_DISCOUNT_RATE = 20;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeTax(lines: TaxLineInput[], opts: TaxOptions): TaxResult {
  const isScPwd = opts.discountType === "senior" || opts.discountType === "pwd";
  const discPct =
    opts.discountType === "regular" ? opts.discountRate : isScPwd ? SC_PWD_DISCOUNT_RATE : 0;

  let vatable = 0;
  let exempt = 0;
  let zero = 0;
  let nonVat = 0;
  let vat = 0;
  let discount = 0;
  const out: TaxLineResult[] = [];

  for (const l of lines) {
    const gross = l.qty * l.rate;
    const isVatLine = l.kind === "vat" && opts.vatRegistered;
    // Strip VAT from inclusive prices to get the base
    const base =
      isVatLine && opts.priceMode === "inclusive" ? gross / (1 + l.taxRate / 100) : gross;
    const lineDiscount = (base * discPct) / 100;
    const net = base - lineDiscount;
    discount += lineDiscount;

    let lineVat = 0;
    if (!opts.vatRegistered) {
      nonVat += net;
    } else if (l.kind === "vat") {
      if (isScPwd) {
        // SC/PWD sales are VAT-exempt
        exempt += net;
      } else {
        vatable += net;
        lineVat = (net * l.taxRate) / 100;
      }
    } else if (l.kind === "zero_rated") {
      zero += net;
    } else {
      exempt += net;
    }
    vat += lineVat;
    out.push({ gross: round2(gross), net: round2(net), vat: round2(lineVat) });
  }

  const vatableSales = round2(vatable);
  const vatExemptSales = round2(exempt);
  const zeroRatedSales = round2(zero);
  const nonVatSales = round2(nonVat);
  const totalSales = round2(vatableSales + vatExemptSales + zeroRatedSales + nonVatSales);
  const vatAmount = round2(vat);
  const percentageTax = opts.vatRegistered ? 0 : round2((nonVatSales * opts.percentageTaxRate) / 100);
  const totalAmountDue = round2(totalSales + vatAmount);
  const ewtAmount = round2((totalSales * opts.ewtRate) / 100);

  return {
    lines: out,
    vatableSales,
    vatExemptSales,
    zeroRatedSales,
    nonVatSales,
    totalSales,
    vatAmount,
    percentageTax,
    discountAmount: round2(discount),
    totalAmountDue,
    ewtAmount,
    amountDueAfterWithholding: round2(totalAmountDue - ewtAmount),
  };
}
