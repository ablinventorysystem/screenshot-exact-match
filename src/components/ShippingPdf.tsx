import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import { fmtDate, num } from "@/lib/format";

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9.5, fontFamily: "Helvetica", color: "#000000" },
  title: { fontSize: 15, fontWeight: "bold", color: "#00796B", marginBottom: 4 },
  sub: { fontSize: 9, color: "#424242", marginBottom: 12 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#BDBDBD", paddingVertical: 4 },
  head: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#424242", paddingVertical: 5, fontWeight: "bold" },
  box: { borderWidth: 1.5, borderColor: "#000000", padding: 14, marginTop: 10 },
  big: { fontSize: 16, fontWeight: "bold", marginBottom: 6 },
});

export async function downloadPackingSlipPdf(params: {
  companyName: string;
  refNo: string;
  txnDate: string;
  customerName: string;
  shipTo?: string | null;
  lines: { description: string; qty: number; uom: string; lotNo?: string | null }[];
}) {
  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>PACKING SLIP — {params.refNo}</Text>
        <Text style={styles.sub}>{params.companyName} · Date: {fmtDate(params.txnDate)}</Text>
        <Text style={{ marginBottom: 8 }}>Ship To: {params.customerName} {params.shipTo ? `(${params.shipTo})` : ""}</Text>
        <View style={styles.head}>
          <Text style={{ width: "55%" }}>Item Description</Text>
          <Text style={{ width: "25%" }}>Lot / Serial</Text>
          <Text style={{ width: "20%", textAlign: "right" }}>Qty</Text>
        </View>
        {params.lines.map((l, i) => (
          <View key={i} style={styles.row}>
            <Text style={{ width: "55%" }}>{l.description}</Text>
            <Text style={{ width: "25%" }}>{l.lotNo || "—"}</Text>
            <Text style={{ width: "20%", textAlign: "right" }}>{num(l.qty, 2)} {l.uom}</Text>
          </View>
        ))}
      </Page>
    </Document>
  );
  const blob = await pdf(doc).toBlob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `packing-slip-${params.refNo}.pdf`;
  a.click();
}

export async function downloadShippingLabelPdf(params: {
  provider: string;
  carrier: string;
  trackingNo: string;
  refNo: string;
  fromCompany: string;
  toCustomer: string;
  toAddress?: string | null;
  weightKg?: number | null;
}) {
  const doc = (
    <Document>
      <Page size={[288, 432]} style={styles.page}>
        <Text style={styles.title}>{params.carrier.toUpperCase()} ({params.provider.toUpperCase()} SANDBOX)</Text>
        <Text style={styles.sub}>Ref: {params.refNo} · Weight: {params.weightKg ?? 1} kg</Text>
        <View style={styles.box}>
          <Text style={{ fontSize: 8, color: "#424242" }}>FROM:</Text>
          <Text style={{ marginBottom: 8 }}>{params.fromCompany}</Text>
          <Text style={{ fontSize: 8, color: "#424242" }}>SHIP TO:</Text>
          <Text style={styles.big}>{params.toCustomer}</Text>
          <Text>{params.toAddress || "Philippines"}</Text>
        </View>
        <View style={[styles.box, { marginTop: 14, alignItems: "center" }]}>
          <Text style={{ fontSize: 8, color: "#424242" }}>TRACKING NUMBER</Text>
          <Text style={{ fontSize: 13, fontWeight: "bold", marginTop: 4 }}>{params.trackingNo}</Text>
        </View>
      </Page>
    </Document>
  );
  const blob = await pdf(doc).toBlob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `label-${params.trackingNo}.pdf`;
  a.click();
}
