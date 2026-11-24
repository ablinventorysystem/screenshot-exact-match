import { describe, expect, it } from "vitest";
import { computeTax, type TaxOptions } from "./ph-tax";
import { formatTin, isValidTin } from "./tin";

const base: TaxOptions = {
  priceMode: "exclusive",
  vatRegistered: true,
  percentageTaxRate: 3,
  discountType: "none",
  discountRate: 0,
  ewtRate: 0,
};
const vat12 = { kind: "vat" as const, taxRate: 12 };

describe("PH VAT", () => {
  it("adds 12% VAT on VAT-exclusive prices", () => {
    const r = computeTax([{ qty: 10, rate: 100, ...vat12 }], base);
    expect(r.vatableSales).toBe(1000);
    expect(r.vatAmount).toBe(120);
    expect(r.totalAmountDue).toBe(1120);
  });

  it("extracts 12% VAT from VAT-inclusive prices", () => {
    const r = computeTax([{ qty: 1, rate: 1120, ...vat12 }], { ...base, priceMode: "inclusive" });
    expect(r.vatableSales).toBe(1000);
    expect(r.vatAmount).toBe(120);
    expect(r.totalAmountDue).toBe(1120);
  });

  it("splits vatable, exempt and zero-rated sales", () => {
    const r = computeTax(
      [
        { qty: 1, rate: 1000, ...vat12 },
        { qty: 1, rate: 500, kind: "exempt", taxRate: 0 },
        { qty: 1, rate: 300, kind: "zero_rated", taxRate: 0 },
      ],
      base,
    );
    expect(r.vatableSales).toBe(1000);
    expect(r.vatExemptSales).toBe(500);
    expect(r.zeroRatedSales).toBe(300);
    expect(r.totalSales).toBe(1800);
    expect(r.totalAmountDue).toBe(1920);
  });

  it("gives Senior Citizen 20% discount on the VAT-exempt base", () => {
    const r = computeTax([{ qty: 1, rate: 1120, ...vat12 }], {
      ...base,
      priceMode: "inclusive",
      discountType: "senior",
    });
    expect(r.discountAmount).toBe(200);
    expect(r.vatAmount).toBe(0);
    expect(r.vatExemptSales).toBe(800);
    expect(r.totalAmountDue).toBe(800);
  });

  it("applies a regular discount before VAT", () => {
    const r = computeTax([{ qty: 1, rate: 1000, ...vat12 }], {
      ...base,
      discountType: "regular",
      discountRate: 10,
    });
    expect(r.discountAmount).toBe(100);
    expect(r.vatAmount).toBe(108);
    expect(r.totalAmountDue).toBe(1008);
  });

  it("withholds EWT on the net-of-VAT base", () => {
    const r = computeTax([{ qty: 1, rate: 1000, ...vat12 }], { ...base, ewtRate: 1 });
    expect(r.ewtAmount).toBe(10);
    expect(r.amountDueAfterWithholding).toBe(1110);
  });

  it("charges no VAT and computes 3% percentage tax for Non-VAT sellers", () => {
    const r = computeTax([{ qty: 1, rate: 1000, ...vat12 }], { ...base, vatRegistered: false });
    expect(r.vatAmount).toBe(0);
    expect(r.percentageTax).toBe(30);
    expect(r.totalAmountDue).toBe(1000);
  });
});

describe("TIN", () => {
  it("accepts 000-000-000-00000 and rejects other shapes", () => {
    expect(isValidTin("008-123-456-00000")).toBe(true);
    expect(isValidTin("008-123-456")).toBe(false);
    expect(isValidTin("008123456000")).toBe(false);
  });
  it("formats typed digits and pads a missing branch code", () => {
    expect(formatTin("008123456")).toBe("008-123-456-00000");
    expect(formatTin("00812345600001")).toBe("008-123-456-00001");
  });
});
