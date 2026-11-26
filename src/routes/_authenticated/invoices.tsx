import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, num, peso } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { downloadBirPdf, type BirInvoicePdfData } from "@/components/BirInvoicePdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface InvRow {
  id: string;
  ref_no: string;
  bir_series_no: number | null;
  txn_date: string;
  due_date: string | null;
  party_name: string | null;
  status: string;
  voided: boolean;
  qb_sync_status: string;
  total: number;
  amount_due: number;
}

export const Route = createFileRoute("/_authenticated/invoices")({
  validateSearch: (s: Record<string, unknown>) => ({
    id: typeof s["id"] === "string" ? s["id"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Invoices — SOS Inventory" },
      { name: "description", content: "BIR-ready sales invoices, Sales Journal, and Form 2307 tracker." },
    ],
  }),
  component: InvoicesPage,
});

function InvoicesPage() {
  const { id: selectedId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { companyId } = useCompany();
  const [reportsOpen, setReportsOpen] = useState(false);

  if (selectedId) {
    return (
      <InvoiceDetailView
        invoiceId={selectedId}
        onBack={() => void navigate({ search: { id: undefined } })}
      />
    );
  }

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select("id, ref_no, bir_series_no, txn_date, due_date, party_name, status, voided, qb_sync_status, total, amount_due", { count: "exact" })
      .eq("company_id", companyId)
      .eq("type", "invoice");

    if (a.filter === "open") q = q.eq("status", "open").eq("voided", false);
    else if (a.filter === "paid") q = q.eq("status", "paid");
    else if (a.filter === "voided") q = q.eq("voided", true);
    else if (a.filter === "unsent") q = q.eq("qb_sync_status", "pending");

    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,party_name.ilike.%${a.search}%`);

    const sortMap: Record<string, string> = { ref: "ref_no", date: "txn_date", customer: "party_name", total: "total" };
    const { data, count, error } = await q
      .order(sortMap[a.sort.key] ?? "txn_date", { ascending: a.sort.dir === "asc" })
      .order("ref_no", { ascending: false })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as InvRow[], total: count ?? 0 };
  };

  const columns: Column<InvRow>[] = [
    {
      key: "ref",
      header: "Ref #",
      sortable: true,
      cell: (r) => (
        <button type="button" className="link-ref text-left" onClick={() => void navigate({ search: { id: r.id } })}>
          {r.ref_no}
        </button>
      ),
      csv: (r) => r.ref_no,
    },
    {
      key: "bir",
      header: "BIR Series",
      cell: (r) => (r.bir_series_no ? String(r.bir_series_no).padStart(7, "0") : "—"),
      csv: (r) => (r.bir_series_no ? String(r.bir_series_no) : ""),
    },
    { key: "date", header: "Date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    { key: "customer", header: "Customer", sortable: true, cell: (r) => r.party_name ?? "—", csv: (r) => r.party_name ?? "" },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          <Badge variant={r.voided ? "destructive" : r.status === "paid" ? "secondary" : "outline"}>
            {r.voided ? "Voided" : labelize(r.status)}
          </Badge>
          {r.qb_sync_status === "pending" && <Badge variant="outline">Unsent to QuickBooks</Badge>}
        </div>
      ),
      csv: (r) => (r.voided ? "void" : r.status),
    },
    { key: "total", header: "Total", sortable: true, cell: (r) => `₱${peso(r.total)}`, csv: (r) => String(r.total) },
    { key: "due", header: "Amount due", cell: (r) => `₱${peso(r.amount_due)}`, csv: (r) => String(r.amount_due) },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="Invoices"
        subtitle="BIR-registered Sales Invoices, Sales Journal (SLSP), and Form 2307 tracker"
        actions={
          <Button variant="outline" size="sm" onClick={() => setReportsOpen(true)}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            Reports
          </Button>
        }
      />
      {companyId && (
        <DataTable<InvRow>
          id="invoices"
          queryKey={["invoices", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          filters={[
            { value: "all", label: "All" },
            { value: "open", label: "Open" },
            { value: "paid", label: "Paid" },
            { value: "unsent", label: "Unsent to QuickBooks" },
            { value: "voided", label: "Voided" },
          ]}
          rowActions={[
            { label: "Open / BIR Print", onSelect: (rows) => rows[0] && void navigate({ search: { id: rows[0].id } }) },
          ]}
        />
      )}
      <InvoiceReportsDialog open={reportsOpen} onOpenChange={setReportsOpen} />
    </div>
  );
}

function InvoiceDetailView({ invoiceId, onBack }: { invoiceId: string; onBack: () => void }) {
  const { company, companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [paperSize, setPaperSize] = useState<"A4" | "LETTER">("A4");
  const [docTitle, setDocTitle] = useState<"SALES INVOICE" | "SERVICE INVOICE">("SALES INVOICE");
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidBusy, setVoidBusy] = useState(false);

  const invQ = useQuery({
    queryKey: ["invoice_detail", invoiceId],
    queryFn: async () => {
      const { data: txn, error } = await supabase.from("transactions").select("*").eq("id", invoiceId).single();
      if (error) throw error;
      const { data: lines } = await supabase
        .from("transaction_lines")
        .select("*, item:items(sku, name, uom)")
        .eq("transaction_id", invoiceId)
        .order("line_no");
      let customer = null;
      if (txn.party_id) {
        const { data: c } = await supabase.from("customers").select("*").eq("id", txn.party_id).maybeSingle();
        customer = c;
      }
      return { txn, lines: lines ?? [], customer };
    },
  });

  const handleVoid = async () => {
    if (!voidReason.trim()) return void toast.error("Void reason is required");
    setVoidBusy(true);
    try {
      const { error } = await supabase.rpc("void_transaction", {
        _id: invoiceId,
        _reason: voidReason.trim(),
      });
      if (error) throw error;
      toast.success("Invoice voided (BIR serial number preserved)");
      setVoidOpen(false);
      qc.invalidateQueries({ queryKey: ["invoice_detail", invoiceId] });
      qc.invalidateQueries({ queryKey: ["invoices", companyId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to void invoice");
    } finally {
      setVoidBusy(false);
    }
  };

  if (invQ.isLoading) return <div className="p-6 text-muted-foreground">Loading invoice…</div>;
  if (!invQ.data || !company) return <div className="p-6 text-destructive">Invoice not found.</div>;

  const { txn, lines, customer } = invQ.data;
  const effectiveTitle = (txn.document_title as "SALES INVOICE" | "SERVICE INVOICE" | null) ?? docTitle;
  const seriesStr = txn.bir_series_no ? String(txn.bir_series_no).padStart(7, "0") : txn.ref_no;
  const totalInclusive = Number(txn.vatable_sales) + Number(txn.vat_exempt_sales) + Number(txn.zero_rated_sales) + Number(txn.vat_amount);
  const netOfVat = Number(txn.vatable_sales) + Number(txn.vat_exempt_sales) + Number(txn.zero_rated_sales);

  const pdfPayload: BirInvoicePdfData = {
    documentTitle: effectiveTitle,
    refNo: txn.ref_no,
    birSeriesNo: txn.bir_series_no,
    txnDate: txn.txn_date,
    txnTime: new Date(txn.created_at).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }),
    terms: txn.terms ?? customer?.terms ?? "",
    poReference: txn.po_reference ?? "",
    voided: txn.voided,
    voidReason: txn.void_reason,
    buyerName: customer?.registered_name || txn.party_name || "Walk-in Customer",
    buyerTin: customer?.tin ?? "",
    buyerAddress: customer?.registered_address || txn.bill_to || "",
    buyerBusinessStyle: customer?.business_style ?? "",
    scPwdId: txn.sc_pwd_id ?? customer?.sc_pwd_id ?? "",
    scPwdName: txn.sc_pwd_name ?? customer?.sc_pwd_name ?? "",
    lines: lines.map((l) => {
      const it = l.item as unknown as { uom: string; name: string } | null;
      return {
        qty: Number(l.qty),
        uom: l.uom ?? it?.uom ?? "pc",
        description: l.description ?? it?.name ?? "",
        rate: Number(l.rate),
        amount: Number(l.amount),
      };
    }),
    vatableSales: Number(txn.vatable_sales),
    vatExemptSales: Number(txn.vat_exempt_sales),
    zeroRatedSales: Number(txn.zero_rated_sales),
    vatAmount: Number(txn.vat_amount),
    discountAmount: Number(txn.discount_amount),
    ewtAtc: txn.ewt_atc,
    ewtRate: Number(txn.ewt_rate),
    ewtAmount: Number(txn.ewt_amount),
    total: Number(txn.total),
    amountDue: Number(txn.amount_due),
    notes: txn.notes,
  };

  return (
    <div className="p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to invoices
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={effectiveTitle}
            onChange={(e) => setDocTitle(e.target.value as "SALES INVOICE" | "SERVICE INVOICE")}
            className="h-8 rounded-md border bg-surface px-2 text-xs"
          >
            <option value="SALES INVOICE">SALES INVOICE</option>
            <option value="SERVICE INVOICE">SERVICE INVOICE</option>
          </select>
          <select
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value as "A4" | "LETTER")}
            className="h-8 rounded-md border bg-surface px-2 text-xs"
          >
            <option value="A4">A4</option>
            <option value="LETTER">Half-Letter</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => void downloadBirPdf(company, pdfPayload, paperSize)}>
            <FileText className="mr-1.5 h-4 w-4" />
            Download PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" />
            Print
          </Button>
          {canWrite && !txn.voided && (
            <Button variant="destructive" size="sm" onClick={() => setVoidOpen(true)}>
              <Ban className="mr-1.5 h-4 w-4" />
              Void invoice
            </Button>
          )}
        </div>
      </div>

      {/* Printable BIR Invoice Sheet */}
      <div className={`relative mx-auto rounded-lg border bg-surface p-8 text-sm ${paperSize === "LETTER" ? "max-w-2xl" : "max-w-4xl"}`}>
        {txn.voided && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-12 text-6xl font-medium tracking-widest text-destructive/20">VOID</span>
          </div>
        )}

        <div className="border-b pb-4">
          <div className="text-lg font-medium">{company.name}</div>
          {company.trade_name && <div className="text-muted-foreground">Trade Name: {company.trade_name}</div>}
          <div className="text-muted-foreground">{company.registered_address} {company.zip_code}</div>
          <div className="text-xs text-muted-foreground">
            {company.vat_registered ? "VAT Reg. TIN" : "NON-VAT Reg. TIN"} {company.tin ?? "000-000-000-00000"} · Branch {company.branch_code ?? "00000"}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <h2 className="text-xl font-medium text-teal">{effectiveTitle}</h2>
            <div className="text-right">
              <div className="text-base font-medium text-destructive">No. {seriesStr}</div>
              {txn.qb_sync_status === "pending" && (
                <Badge variant="outline" className="mt-1">Unsent to QuickBooks</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="my-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-0.5">
            <div><span className="text-muted-foreground">Sold To:</span> {pdfPayload.buyerName}</div>
            <div><span className="text-muted-foreground">TIN:</span> {pdfPayload.buyerTin || "—"}</div>
            <div><span className="text-muted-foreground">Address:</span> {pdfPayload.buyerAddress || "—"}</div>
            <div><span className="text-muted-foreground">Business Style:</span> {pdfPayload.buyerBusinessStyle || "—"}</div>
            {pdfPayload.scPwdId && (
              <div><span className="text-muted-foreground">SC/PWD ID:</span> {pdfPayload.scPwdId} ({pdfPayload.scPwdName})</div>
            )}
          </div>
          <div className="space-y-0.5 md:text-right">
            <div><span className="text-muted-foreground">Date / Time:</span> {fmtDate(txn.txn_date)} {pdfPayload.txnTime}</div>
            <div><span className="text-muted-foreground">Ref #:</span> {txn.ref_no}</div>
            <div><span className="text-muted-foreground">Terms:</span> {pdfPayload.terms || "—"}</div>
            <div><span className="text-muted-foreground">PO / SO Ref:</span> {pdfPayload.poReference || "—"}</div>
          </div>
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y bg-muted text-left">
              <th className="px-2 py-1.5 text-right">Qty</th>
              <th className="px-2 py-1.5">Unit</th>
              <th className="px-2 py-1.5">Description</th>
              <th className="px-2 py-1.5 text-right">Unit Price</th>
              <th className="px-2 py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {pdfPayload.lines.map((l, idx) => (
              <tr key={idx} className="border-b">
                <td className="px-2 py-1.5 text-right">{num(l.qty, 2)}</td>
                <td className="px-2 py-1.5">{l.uom}</td>
                <td className="px-2 py-1.5">{l.description}</td>
                <td className="px-2 py-1.5 text-right">₱{peso(l.rate)}</td>
                <td className="px-2 py-1.5 text-right">₱{peso(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="text-xs text-muted-foreground space-y-1">
            {txn.notes && <p>Notes: {txn.notes}</p>}
            {txn.voided && txn.void_reason && (
              <p className="font-medium text-destructive">VOID REASON: {txn.void_reason}</p>
            )}
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span>VATable Sales</span><span>₱{peso(txn.vatable_sales)}</span></div>
            <div className="flex justify-between"><span>VAT-Exempt Sales</span><span>₱{peso(txn.vat_exempt_sales)}</span></div>
            <div className="flex justify-between"><span>Zero-Rated Sales</span><span>₱{peso(txn.zero_rated_sales)}</span></div>
            <div className="flex justify-between"><span>Total Sales (VAT-Inclusive)</span><span>₱{peso(totalInclusive)}</span></div>
            <div className="flex justify-between"><span>Less: VAT</span><span>₱{peso(txn.vat_amount)}</span></div>
            <div className="flex justify-between"><span>Amount Net of VAT</span><span>₱{peso(netOfVat)}</span></div>
            <div className="flex justify-between"><span>Less: Discount (SC/PWD)</span><span>₱{peso(txn.discount_amount)}</span></div>
            <div className="flex justify-between"><span>Add: VAT</span><span>₱{peso(txn.vat_amount)}</span></div>
            <div className="flex justify-between">
              <span>Less: Withholding Tax {txn.ewt_atc ? `(${txn.ewt_atc} ${txn.ewt_rate}%)` : ""}</span>
              <span>₱{peso(txn.ewt_amount)}</span>
            </div>
            <div className="flex justify-between border-t pt-1.5 text-base font-medium">
              <span>Total Amount Due</span>
              <span>₱{peso(txn.amount_due)}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 border-t pt-3 text-xs text-muted-foreground space-y-0.5">
          <div>
            ATP No.: {company.atp_no ?? "—"} · Date Issued: {fmtDate(company.atp_date_issued) || "—"} · Valid Until: {fmtDate(company.atp_validity_date) || "—"}
          </div>
          <div>Approved Series: {company.invoice_series_start ?? 1} – {company.invoice_series_end ?? 2000}</div>
          <div>
            Printer: {company.printer_name ?? "—"} · TIN: {company.printer_tin ?? "—"} · Accreditation: {company.printer_accreditation_no ?? "—"}
          </div>
          <div className="pt-1 font-medium text-foreground">
            {company.bir_validity_notice ?? "THIS SALES INVOICE SHALL BE VALID FOR FIVE (5) YEARS FROM THE DATE OF ATP"}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-10 text-center text-xs text-muted-foreground">
          <div className="border-t pt-1">Authorized Representative</div>
          <div className="border-t pt-1">Received by (Signature over Printed Name / Date)</div>
        </div>
      </div>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent className="max-w-md rounded-lg">
          <DialogHeader>
            <DialogTitle>Void Invoice {txn.ref_no}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Voiding preserves BIR serial number {seriesStr} and stamps a VOID watermark. Invoices cannot be deleted.
            </p>
            <div>
              <Label htmlFor="void-reason">Reason for voiding *</Label>
              <Input
                id="void-reason"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Cancelled order, typographical error"
                className="mt-1 rounded-md"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
              <Button variant="destructive" disabled={voidBusy} onClick={() => void handleVoid()}>
                Confirm Void
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvoiceReportsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();

  const journalQ = useQuery({
    queryKey: ["sales_journal", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data: txns } = await supabase
        .from("transactions")
        .select("id, ref_no, bir_series_no, txn_date, party_id, party_name, vatable_sales, vat_exempt_sales, zero_rated_sales, vat_amount, total, voided")
        .eq("company_id", companyId)
        .in("type", ["invoice", "sales_receipt"])
        .eq("voided", false)
        .order("txn_date", { ascending: false })
        .limit(200);

      const { data: custs } = await supabase
        .from("customers")
        .select("id, tin, registered_name, registered_address")
        .eq("company_id", companyId);
      const cmap = new Map((custs ?? []).map((c) => [c.id, c]));

      return (txns ?? []).map((t) => {
        const c = t.party_id ? cmap.get(t.party_id) : undefined;
        const gross = Number(t.vatable_sales) + Number(t.vat_exempt_sales) + Number(t.zero_rated_sales) + Number(t.vat_amount);
        const grossTaxable = Number(t.vatable_sales) + Number(t.vat_amount);
        return {
          ...t,
          tin: c?.tin ?? "",
          regName: c?.registered_name || t.party_name || "",
          address: c?.registered_address ?? "",
          gross,
          grossTaxable,
        };
      });
    },
  });

  const f2307Q = useQuery({
    queryKey: ["form_2307_tracker", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data: payments } = await supabase
        .from("transactions")
        .select("id, ref_no, txn_date, party_id, party_name, ewt_atc, ewt_amount, vatable_sales, vat_exempt_sales, zero_rated_sales")
        .eq("company_id", companyId)
        .eq("type", "payment")
        .gt("ewt_amount", 0)
        .order("txn_date", { ascending: false })
        .limit(100);

      const { data: recs } = await supabase.from("form_2307_records").select("*").eq("company_id", companyId);
      const rmap = new Map((recs ?? []).map((r) => [r.payment_txn_id, r]));

      return (payments ?? []).map((p) => {
        const rec = rmap.get(p.id);
        const base = Number(p.vatable_sales) + Number(p.vat_exempt_sales) + Number(p.zero_rated_sales);
        const dt = new Date(`${p.txn_date}T00:00:00`);
        const qtr = `${dt.getFullYear()}-Q${Math.floor(dt.getMonth() / 3) + 1}`;
        return {
          paymentId: p.id,
          refNo: p.ref_no,
          txnDate: p.txn_date,
          customerId: p.party_id,
          customerName: p.party_name ?? "—",
          atc: rec?.atc_code ?? p.ewt_atc ?? "—",
          base: rec?.income_base ?? base,
          withheld: rec?.amount_withheld ?? Number(p.ewt_amount),
          quarter: rec?.quarter ?? qtr,
          received: rec?.certificate_received ?? false,
        };
      });
    },
  });

  const exportJournalCsv = () => {
    const rows = journalQ.data ?? [];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const headers = ["TIN", "Registered Name", "Address", "Gross Sales", "Exempt", "Zero-Rated", "Taxable", "Output VAT", "Gross Taxable"];
    const lines = [
      headers.map(esc).join(","),
      ...rows.map((r) =>
        [
          r.tin,
          r.regName,
          r.address,
          r.gross.toFixed(2),
          Number(r.vat_exempt_sales).toFixed(2),
          Number(r.zero_rated_sales).toFixed(2),
          Number(r.vatable_sales).toFixed(2),
          Number(r.vat_amount).toFixed(2),
          r.grossTaxable.toFixed(2),
        ]
          .map(esc)
          .join(","),
      ),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "sales-journal-slsp.csv";
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl rounded-lg">
        <DialogHeader>
          <DialogTitle>BIR Invoice Reports</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="journal">
          <TabsList className="mb-3">
            <TabsTrigger value="journal">Sales Journal (SLSP)</TabsTrigger>
            <TabsTrigger value="f2307">Form 2307 Received</TabsTrigger>
          </TabsList>

          <TabsContent value="journal" className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={exportJournalCsv}>
                <Download className="mr-1.5 h-4 w-4" />
                Export CSV
              </Button>
            </div>
            <div className="max-h-96 overflow-auto rounded-md border">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-2">TIN</th>
                    <th className="px-2 py-2">Registered Name</th>
                    <th className="px-2 py-2">Address</th>
                    <th className="px-2 py-2 text-right">Gross Sales</th>
                    <th className="px-2 py-2 text-right">Exempt</th>
                    <th className="px-2 py-2 text-right">Zero-Rated</th>
                    <th className="px-2 py-2 text-right">Taxable</th>
                    <th className="px-2 py-2 text-right">Output VAT</th>
                    <th className="px-2 py-2 text-right">Gross Taxable</th>
                  </tr>
                </thead>
                <tbody>
                  {(journalQ.data ?? []).map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="px-2 py-1.5">{r.tin || "—"}</td>
                      <td className="px-2 py-1.5">{r.regName}</td>
                      <td className="px-2 py-1.5 truncate max-w-[160px]">{r.address || "—"}</td>
                      <td className="px-2 py-1.5 text-right">{peso(r.gross)}</td>
                      <td className="px-2 py-1.5 text-right">{peso(r.vat_exempt_sales)}</td>
                      <td className="px-2 py-1.5 text-right">{peso(r.zero_rated_sales)}</td>
                      <td className="px-2 py-1.5 text-right">{peso(r.vatable_sales)}</td>
                      <td className="px-2 py-1.5 text-right">{peso(r.vat_amount)}</td>
                      <td className="px-2 py-1.5 text-right font-medium">{peso(r.grossTaxable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="f2307">
            <div className="max-h-96 overflow-auto rounded-md border">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2">Payment</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">ATC</th>
                    <th className="px-3 py-2 text-right">Base</th>
                    <th className="px-3 py-2 text-right">Withheld</th>
                    <th className="px-3 py-2">Quarter</th>
                    <th className="px-3 py-2 text-center">2307 Received</th>
                  </tr>
                </thead>
                <tbody>
                  {(f2307Q.data ?? []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-muted-foreground">No customer payments with EWT found.</td>
                    </tr>
                  )}
                  {(f2307Q.data ?? []).map((row) => (
                    <tr key={row.paymentId} className="border-b">
                      <td className="px-3 py-1.5 font-medium">{row.refNo}</td>
                      <td className="px-3 py-1.5">{row.customerName}</td>
                      <td className="px-3 py-1.5">{row.atc}</td>
                      <td className="px-3 py-1.5 text-right">₱{peso(row.base)}</td>
                      <td className="px-3 py-1.5 text-right">₱{peso(row.withheld)}</td>
                      <td className="px-3 py-1.5">{row.quarter}</td>
                      <td className="px-3 py-1.5 text-center">
                        <Checkbox
                          checked={row.received}
                          disabled={!canWrite}
                          onCheckedChange={async (checked) => {
                            const { error } = await supabase.from("form_2307_records").upsert(
                              {
                                company_id: companyId,
                                payment_txn_id: row.paymentId,
                                customer_id: row.customerId,
                                atc_code: row.atc,
                                income_base: row.base,
                                amount_withheld: row.withheld,
                                quarter: row.quarter,
                                certificate_received: !!checked,
                                received_date: checked ? new Date().toISOString().slice(0, 10) : null,
                              },
                              { onConflict: "company_id,payment_txn_id" },
                            );
                            if (error) toast.error(error.message);
                            else qc.invalidateQueries({ queryKey: ["form_2307_tracker", companyId] });
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
