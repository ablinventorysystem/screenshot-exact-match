import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import type { Company } from "@/lib/company";
import { fmtDate, num, peso } from "@/lib/format";

export interface PdfLine {
  qty: number;
  uom: string;
  description: string;
  rate: number;
  amount: number;
}

export interface BirInvoicePdfData {
  documentTitle: "SALES INVOICE" | "SERVICE INVOICE" | "SALES ORDER";
  refNo: string;
  birSeriesNo?: number | null;
  txnDate: string;
  txnTime?: string;
  terms?: string | null;
  poReference?: string | null;
  voided?: boolean;
  voidReason?: string | null;
  buyerName: string;
  buyerTin?: string | null;
  buyerAddress?: string | null;
  buyerBusinessStyle?: string | null;
  scPwdId?: string | null;
  scPwdName?: string | null;
  lines: PdfLine[];
  vatableSales: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  vatAmount: number;
  discountAmount: number;
  ewtAtc?: string | null;
  ewtRate?: number;
  ewtAmount: number;
  total: number;
  amountDue: number;
  notes?: string | null;
}

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#000000" },
  watermark: {
    position: "absolute",
    top: "38%",
    left: "20%",
    fontSize: 64,
    color: "#D32F2F",
    opacity: 0.18,
    transform: "rotate(-30deg)",
    fontWeight: "bold",
  },
  header: { marginBottom: 10, borderBottomWidth: 1, borderBottomColor: "#BDBDBD", paddingBottom: 8 },
  companyName: { fontSize: 13, fontWeight: "bold" },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  docTitle: { fontSize: 13, fontWeight: "bold", color: "#00796B" },
  serialText: { fontSize: 11, fontWeight: "bold", color: "#D32F2F" },
  metaGrid: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10, gap: 12 },
  metaCol: { flex: 1 },
  tableHeader: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#424242", paddingVertical: 4, fontWeight: "bold" },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#BDBDBD", paddingVertical: 3 },
  colQty: { width: "10%", textAlign: "right", paddingRight: 4 },
  colUom: { width: "10%", paddingHorizontal: 4 },
  colDesc: { width: "44%", paddingHorizontal: 4 },
  colRate: { width: "18%", textAlign: "right", paddingHorizontal: 4 },
  colAmt: { width: "18%", textAlign: "right", paddingLeft: 4 },
  summaryWrap: { flexDirection: "row", justifyContent: "space-between", marginTop: 12, gap: 16 },
  summaryLeft: { flex: 1 },
  summaryRight: { width: "46%", borderTopWidth: 1, borderColor: "#424242", paddingTop: 6 },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  sumTotal: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderColor: "#000000", marginTop: 4, paddingTop: 4, fontWeight: "bold", fontSize: 10 },
  footer: { marginTop: 18, borderTopWidth: 1, borderTopColor: "#BDBDBD", paddingTop: 8, fontSize: 7.5, color: "#424242" },
  sigRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 },
  sigBox: { width: "42%", borderTopWidth: 1, borderTopColor: "#424242", paddingTop: 3, textAlign: "center", fontSize: 8 },
});

export function BirInvoicePdfDocument({
  company,
  data,
  paperSize = "A4",
}: {
  company: Company;
  data: BirInvoicePdfData;
  paperSize?: "A4" | "LETTER";
}) {
  const tinLabel = company.vat_registered ? "VAT Reg. TIN" : "NON-VAT Reg. TIN";
  const seriesStr = data.birSeriesNo ? String(data.birSeriesNo).padStart(7, "0") : data.refNo;
  const totalInclusive = data.vatableSales + data.vatExemptSales + data.zeroRatedSales + data.vatAmount;
  const netOfVat = data.vatableSales + data.vatExemptSales + data.zeroRatedSales;

  return (
    <Document>
      <Page size={paperSize === "LETTER" ? [612, 396] : "A4"} style={styles.page}>
        {data.voided && <Text style={styles.watermark}>VOID</Text>}

        <View style={styles.header}>
          <Text style={styles.companyName}>{company.name}</Text>
          {company.trade_name && <Text>Trade Name: {company.trade_name}</Text>}
          <Text>{company.registered_address ?? ""} {company.zip_code ?? ""}</Text>
          <Text>
            {tinLabel} {company.tin ?? "000-000-000-00000"} · Branch {company.branch_code ?? "00000"}
          </Text>
          <View style={styles.titleRow}>
            <Text style={styles.docTitle}>{data.documentTitle}</Text>
            <Text style={styles.serialText}>No. {seriesStr}</Text>
          </View>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaCol}>
            <Text>Sold To: {data.buyerName}</Text>
            <Text>TIN: {data.buyerTin || "—"}</Text>
            <Text>Address: {data.buyerAddress || "—"}</Text>
            <Text>Business Style: {data.buyerBusinessStyle || "—"}</Text>
            {data.scPwdId && <Text>SC/PWD ID: {data.scPwdId} ({data.scPwdName || ""})</Text>}
          </View>
          <View style={styles.metaCol}>
            <Text>Date: {fmtDate(data.txnDate)} {data.txnTime ?? ""}</Text>
            <Text>Ref #: {data.refNo}</Text>
            <Text>Terms: {data.terms || "—"}</Text>
            <Text>PO / SO Ref: {data.poReference || "—"}</Text>
          </View>
        </View>

        <View style={styles.tableHeader}>
          <Text style={styles.colQty}>Qty</Text>
          <Text style={styles.colUom}>Unit</Text>
          <Text style={styles.colDesc}>Description</Text>
          <Text style={styles.colRate}>Unit Price</Text>
          <Text style={styles.colAmt}>Amount</Text>
        </View>

        {data.lines.map((l, idx) => (
          <View key={idx} style={styles.tableRow}>
            <Text style={styles.colQty}>{num(l.qty, 2)}</Text>
            <Text style={styles.colUom}>{l.uom}</Text>
            <Text style={styles.colDesc}>{l.description}</Text>
            <Text style={styles.colRate}>{peso(l.rate)}</Text>
            <Text style={styles.colAmt}>{peso(l.amount)}</Text>
          </View>
        ))}

        <View style={styles.summaryWrap}>
          <View style={styles.summaryLeft}>
            {data.notes && <Text>Notes: {data.notes}</Text>}
            {data.voided && data.voidReason && (
              <Text style={{ color: "#D32F2F", marginTop: 4 }}>VOID REASON: {data.voidReason}</Text>
            )}
          </View>
          <View style={styles.summaryRight}>
            <View style={styles.sumRow}><Text>VATable Sales</Text><Text>₱{peso(data.vatableSales)}</Text></View>
            <View style={styles.sumRow}><Text>VAT-Exempt Sales</Text><Text>₱{peso(data.vatExemptSales)}</Text></View>
            <View style={styles.sumRow}><Text>Zero-Rated Sales</Text><Text>₱{peso(data.zeroRatedSales)}</Text></View>
            <View style={styles.sumRow}><Text>Total Sales (VAT-Inclusive)</Text><Text>₱{peso(totalInclusive)}</Text></View>
            <View style={styles.sumRow}><Text>Less: VAT</Text><Text>₱{peso(data.vatAmount)}</Text></View>
            <View style={styles.sumRow}><Text>Amount Net of VAT</Text><Text>₱{peso(netOfVat)}</Text></View>
            <View style={styles.sumRow}><Text>Less: SC/PWD / Discount</Text><Text>₱{peso(data.discountAmount)}</Text></View>
            <View style={styles.sumRow}><Text>Add: VAT</Text><Text>₱{peso(data.vatAmount)}</Text></View>
            <View style={styles.sumRow}>
              <Text>Less: Withholding Tax {data.ewtAtc ? `(${data.ewtAtc} ${data.ewtRate ?? 0}%)` : ""}</Text>
              <Text>₱{peso(data.ewtAmount)}</Text>
            </View>
            <View style={styles.sumTotal}><Text>TOTAL AMOUNT DUE</Text><Text>₱{peso(data.amountDue)}</Text></View>
          </View>
        </View>

        {data.documentTitle !== "SALES ORDER" && (
          <View style={styles.footer}>
            <Text>
              ATP No.: {company.atp_no ?? "—"} · Date Issued: {fmtDate(company.atp_date_issued) || "—"} · Valid Until:{" "}
              {fmtDate(company.atp_validity_date) || "—"}
            </Text>
            <Text>
              Approved Series: {company.invoice_series_start ?? 1} – {company.invoice_series_end ?? 2000}
            </Text>
            <Text>
              Printer: {company.printer_name ?? "—"} · TIN: {company.printer_tin ?? "—"} · Accreditation:{" "}
              {company.printer_accreditation_no ?? "—"}
            </Text>
            <Text style={{ marginTop: 3, fontWeight: "bold" }}>
              {company.bir_validity_notice ?? "THIS SALES INVOICE SHALL BE VALID FOR FIVE (5) YEARS FROM THE DATE OF ATP"}
            </Text>
          </View>
        )}

        <View style={styles.sigRow}>
          <Text style={styles.sigBox}>Prepared / Authorized Representative</Text>
          <Text style={styles.sigBox}>Received by (Signature over Printed Name / Date)</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function downloadBirPdf(company: Company, data: BirInvoicePdfData, paperSize: "A4" | "LETTER" = "A4") {
  const blob = await pdf(<BirInvoicePdfDocument company={company} data={data} paperSize={paperSize} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${data.refNo}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
