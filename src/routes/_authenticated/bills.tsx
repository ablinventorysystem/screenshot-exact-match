import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, peso, todayISO } from "@/lib/format";
import { round2 } from "@/lib/ph-tax";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface BillRow {
  id: string;
  ref_no: string;
  txn_date: string;
  due_date: string | null;
  party_name: string | null;
  po_reference: string | null;
  status: string;
  input_vat_amount: number;
  input_vat_claimable: boolean;
  ewt_amount: number;
  total: number;
  amount_due: number;
  voided: boolean;
}

interface BillLine {
  item_id: string;
  description: string;
  qty: number;
  rate: number;
  taxKind: "vat" | "exempt" | "zero_rated";
  taxRate: number;
}

export const Route = createFileRoute("/_authenticated/bills")({
  validateSearch: (s: Record<string, unknown>) => ({
    id: typeof s["id"] === "string" ? s["id"] : undefined,
    poId: typeof s["poId"] === "string" ? s["poId"] : undefined,
    isNew: s["new"] === "1" || s["new"] === true,
  }),
  head: () => ({
    meta: [
      { title: "Bills — ABL Inventory" },
      { name: "description", content: "Vendor bills with 3-way match, Input VAT, EWT, and Form 2307 issued tracker." },
    ],
  }),
  component: BillsPage,
});

function BillsPage() {
  const { id, poId, isNew } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { companyId, canWrite } = useCompany();

  if (id || poId || isNew) {
    return (
      <BillForm
        billId={id}
        initialPoId={poId}
        onBack={() => void navigate({ search: { id: undefined, poId: undefined, isNew: false } })}
        onSaved={(savedId) => void navigate({ search: { id: savedId, poId: undefined, isNew: false } })}
      />
    );
  }

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select("id, ref_no, txn_date, due_date, party_name, po_reference, status, input_vat_amount, input_vat_claimable, ewt_amount, total, amount_due, voided", { count: "exact" })
      .eq("company_id", companyId)
      .eq("type", "bill");
    if (a.filter === "open") q = q.eq("status", "open").eq("voided", false);
    else if (a.filter === "paid") q = q.eq("status", "paid");
    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,party_name.ilike.%${a.search}%,po_reference.ilike.%${a.search}%`);
    const { data, count, error } = await q
      .order(a.sort.key === "ref" ? "ref_no" : "txn_date", { ascending: a.sort.dir === "asc" })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as BillRow[], total: count ?? 0 };
  };

  const columns: Column<BillRow>[] = [
    {
      key: "ref",
      header: "Ref #",
      sortable: true,
      cell: (r) => (
        <button type="button" className="link-ref text-left" onClick={() => void navigate({ search: { id: r.id, poId: undefined, isNew: false } })}>
          {r.ref_no}
        </button>
      ),
      csv: (r) => r.ref_no,
    },
    { key: "date", header: "Bill Date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    { key: "vendor", header: "Vendor", cell: (r) => r.party_name ?? "—", csv: (r) => r.party_name ?? "" },
    { key: "po", header: "PO / 3-Way", cell: (r) => r.po_reference ? <Badge variant="secondary">{r.po_reference}</Badge> : <span className="text-muted-foreground">Direct</span>, csv: (r) => r.po_reference ?? "" },
    { key: "vat", header: "Input VAT", cell: (r) => `₱${peso(r.input_vat_amount)} (${r.input_vat_claimable ? "Claimable" : "Cap."})`, csv: (r) => String(r.input_vat_amount) },
    { key: "ewt", header: "EWT", cell: (r) => `₱${peso(r.ewt_amount)}`, csv: (r) => String(r.ewt_amount) },
    { key: "due", header: "Net Payable", cell: (r) => `₱${peso(r.amount_due)}`, csv: (r) => String(r.amount_due) },
    { key: "status", header: "Status", cell: (r) => <Badge variant={r.status === "paid" ? "secondary" : "outline"}>{labelize(r.status)}</Badge>, csv: (r) => r.status },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Bills" subtitle="Vendor bills, Input VAT (claimable/capitalized), EWT withholding, and Form 2307 issued" />
      {companyId && (
        <DataTable<BillRow>
          id="bills"
          queryKey={["bills", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          filters={[{ value: "all", label: "All" }, { value: "open", label: "Open" }, { value: "paid", label: "Paid" }]}
          {...(canWrite ? { onAdd: () => void navigate({ search: { id: undefined, poId: undefined, isNew: true } }) } : {})}
        />
      )}
    </div>
  );
}

function BillForm({
  billId,
  initialPoId,
  onBack,
  onSaved,
}: {
  billId: string | undefined;
  initialPoId: string | undefined;
  onBack: () => void;
  onSaved: (id: string) => void;
}) {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();

  const [refNo, setRefNo] = useState("New Bill");
  const [vendorId, setVendorId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [vendorTin, setVendorTin] = useState("");
  const [poId, setPoId] = useState(initialPoId ?? "");
  const [poRef, setPoRef] = useState("");
  const [txnDate, setTxnDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [inputVatClaimable, setInputVatClaimable] = useState(true);
  const [ewtAtc, setEwtAtc] = useState("");
  const [ewtRate, setEwtRate] = useState(0);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("open");
  const [lines, setLines] = useState<BillLine[]>([]);
  const [f2307Issued, setF2307Issued] = useState(false);
  const [f2307No, setF2307No] = useState("");
  const [busy, setBusy] = useState(false);

  const vendorsQ = useQuery({
    queryKey: ["bill_vendors", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("vendors").select("id, name, tin, default_atc, tax_type").eq("company_id", companyId).eq("archived", false).order("name");
      return data ?? [];
    },
  });

  const atcQ = useQuery({
    queryKey: ["bill_atc", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("atc_codes").select("code, description, rate").eq("company_id", companyId).eq("archived", false).order("code");
      return data ?? [];
    },
  });

  const posQ = useQuery({
    queryKey: ["bill_pos", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("transactions").select("id, ref_no, party_id, party_name, status, total").eq("company_id", companyId).eq("type", "purchase_order").eq("voided", false).order("txn_date", { ascending: false }).limit(100);
      return data ?? [];
    },
  });

  const itemsQ = useQuery({
    queryKey: ["bill_items", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("items").select("id, sku, name, cost").eq("company_id", companyId).eq("archived", false).order("name").limit(400);
      return data ?? [];
    },
  });

  const detailQ = useQuery({
    queryKey: ["bill_detail", billId],
    enabled: !!billId,
    queryFn: async () => {
      const { data: txn, error } = await supabase.from("transactions").select("*").eq("id", billId!).single();
      if (error) throw error;
      const { data: lns } = await supabase.from("transaction_lines").select("*").eq("transaction_id", billId!).order("line_no");
      const { data: f2307 } = await supabase.from("form_2307_issued").select("*").eq("bill_txn_id", billId!).maybeSingle();
      return { txn, lns: lns ?? [], f2307 };
    },
  });

  // Load 3-way match comparison (PO + Receipts)
  const matchQ = useQuery({
    queryKey: ["bill_3way", poId],
    enabled: !!poId,
    queryFn: async () => {
      const [{ data: po }, { data: recs }] = await Promise.all([
        supabase.from("transactions").select("id, ref_no, total, status").eq("id", poId).single(),
        supabase.from("transactions").select("id, ref_no, total").eq("parent_txn_id", poId).eq("type", "receipt").eq("voided", false),
      ]);
      const receiptTotal = (recs ?? []).reduce((s, r) => s + Number(r.total), 0);
      return { po, receipts: recs ?? [], receiptTotal };
    },
  });

  useEffect(() => {
    if (!detailQ.data) return;
    const { txn, lns, f2307 } = detailQ.data;
    setRefNo(txn.ref_no);
    setVendorId(txn.party_id ?? "");
    setVendorName(txn.party_name ?? "");
    setPoId(txn.parent_txn_id ?? "");
    setPoRef(txn.po_reference ?? "");
    setTxnDate(txn.txn_date);
    setDueDate(txn.due_date ?? "");
    setInputVatClaimable(txn.input_vat_claimable);
    setEwtAtc(txn.ewt_atc ?? "");
    setEwtRate(Number(txn.ewt_rate ?? 0));
    setNotes(txn.notes ?? "");
    setStatus(txn.status);
    setLines(
      lns.map((l) => ({
        item_id: l.item_id ?? "",
        description: l.description ?? "",
        qty: Number(l.qty),
        rate: Number(l.rate),
        taxKind: Number(l.vat_amount) > 0 ? "vat" : "exempt",
        taxRate: 12,
      })),
    );
    if (f2307) {
      setF2307Issued(f2307.certificate_issued);
      setF2307No(f2307.certificate_no ?? "");
    }
  }, [detailQ.data]);

  useEffect(() => {
    const v = (vendorsQ.data ?? []).find((x) => x.id === vendorId);
    if (v) setVendorTin(v.tin ?? "");
  }, [vendorId, vendorsQ.data]);

  // Pre-fill from PO if initialPoId
  useEffect(() => {
    if (!initialPoId || billId) return;
    const loadPo = async () => {
      const po = (posQ.data ?? []).find((p) => p.id === initialPoId);
      if (po) {
        setVendorId(po.party_id ?? "");
        setVendorName(po.party_name ?? "");
        setPoRef(po.ref_no);
      }
      const { data: lns } = await supabase.from("transaction_lines").select("*").eq("transaction_id", initialPoId).order("line_no");
      if (lns?.length) {
        setLines(
          lns.map((l) => ({
            item_id: l.item_id ?? "",
            description: l.description ?? "",
            qty: Number(l.qty),
            rate: Number(l.rate),
            taxKind: "vat",
            taxRate: 12,
          })),
        );
      }
    };
    void loadPo();
  }, [initialPoId, billId, posQ.data]);

  const vatableBase = round2(lines.filter((l) => l.taxKind === "vat").reduce((s, l) => s + l.qty * l.rate, 0));
  const exemptBase = round2(lines.filter((l) => l.taxKind === "exempt").reduce((s, l) => s + l.qty * l.rate, 0));
  const zeroBase = round2(lines.filter((l) => l.taxKind === "zero_rated").reduce((s, l) => s + l.qty * l.rate, 0));
  const inputVat = round2(lines.filter((l) => l.taxKind === "vat").reduce((s, l) => s + (l.qty * l.rate * l.taxRate) / 100, 0));
  const netPurchases = round2(vatableBase + exemptBase + zeroBase);
  const grossBill = round2(netPurchases + inputVat);
  const ewtAmount = round2((netPurchases * ewtRate) / 100);
  const amountPayable = round2(grossBill - ewtAmount);

  const threeWayBadge = () => {
    if (!poId || !matchQ.data?.po) return <Badge variant="outline">Unmatched (Direct Bill)</Badge>;
    const poTot = Number(matchQ.data.po.total);
    const recTot = matchQ.data.receiptTotal;
    if (matchQ.data.receipts.length === 0) return <Badge variant="outline">2-Way (PO Only, No Receipt)</Badge>;
    if (Math.abs(poTot - recTot) < 0.01 && Math.abs(netPurchases - poTot) < 0.01) {
      return <Badge variant="secondary">3-Way Matched</Badge>;
    }
    return <Badge variant="destructive">3-Way Variance (PO ₱{peso(poTot)} / Rec ₱{peso(recTot)})</Badge>;
  };

  const handleSave = async () => {
    if (!vendorId) return void toast.error("Select a vendor");
    if (lines.length === 0) return void toast.error("Add at least one line");
    setBusy(true);
    try {
      const { data: savedId, error } = await supabase.rpc("save_transaction", {
        p: {
          id: billId ?? null,
          company_id: companyId,
          type: "bill",
          status,
          txn_date: txnDate,
          due_date: dueDate || null,
          party_type: "vendor",
          party_id: vendorId,
          party_name: vendorName,
          parent_txn_id: poId || null,
          po_reference: poRef || null,
          vatable_sales: vatableBase,
          vat_exempt_sales: exemptBase,
          zero_rated_sales: zeroBase,
          input_vat_amount: inputVat,
          input_vat_claimable: inputVatClaimable,
          ewt_atc: ewtAtc || null,
          ewt_rate: ewtRate,
          ewt_amount: ewtAmount,
          total: grossBill,
          amount_due: amountPayable,
          notes,
          lines: lines.map((l) => ({
            item_id: l.item_id || null,
            description: l.description,
            qty: l.qty,
            rate: l.rate,
            amount: round2(l.qty * l.rate),
            vat_amount: l.taxKind === "vat" ? round2((l.qty * l.rate * l.taxRate) / 100) : 0,
          })),
        },
      });
      if (error) throw error;

      const effectiveId = savedId ?? billId;
      if (effectiveId && ewtAmount > 0) {
        const dt = new Date(`${txnDate}T00:00:00`);
        const quarter = `${dt.getFullYear()}-Q${Math.floor(dt.getMonth() / 3) + 1}`;
        await supabase.from("form_2307_issued").upsert(
          {
            company_id: companyId,
            bill_txn_id: effectiveId,
            vendor_id: vendorId,
            atc_code: ewtAtc || null,
            income_base: netPurchases,
            amount_withheld: ewtAmount,
            quarter,
            certificate_issued: f2307Issued,
            issued_date: f2307Issued ? todayISO() : null,
            certificate_no: f2307No.trim() || null,
          },
          { onConflict: "company_id,bill_txn_id" },
        );
      }

      toast.success("Vendor bill saved");
      qc.invalidateQueries({ queryKey: ["bills", companyId] });
      if (effectiveId) onSaved(effectiveId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save bill");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Bills
        </Button>
      </div>
      <PageHeader title={refNo} subtitle="Vendor Bill, Input VAT & Form 2307 Withholding" />

      <div className="max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-5 py-3">
          <span className="text-xs font-medium uppercase text-muted-foreground">3-Way Match:</span>
          {threeWayBadge()}
          {vendorTin && <span className="ml-auto text-xs text-muted-foreground">Vendor TIN: {vendorTin}</span>}
        </div>

        <div className="grid grid-cols-1 gap-4 rounded-lg border bg-card p-5 md:grid-cols-3">
          <div>
            <Label htmlFor="b-vendor">Vendor *</Label>
            <select
              id="b-vendor"
              value={vendorId}
              onChange={(e) => {
                const v = (vendorsQ.data ?? []).find((x) => x.id === e.target.value);
                setVendorId(e.target.value);
                setVendorName(v?.name ?? "");
                if (v?.default_atc) {
                  setEwtAtc(v.default_atc);
                  const found = (atcQ.data ?? []).find((a) => a.code === v.default_atc);
                  if (found) setEwtRate(Number(found.rate));
                }
              }}
              className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
            >
              <option value="">Select vendor…</option>
              {(vendorsQ.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="b-po">Match to Purchase Order</Label>
            <select
              id="b-po"
              value={poId}
              onChange={(e) => {
                const p = (posQ.data ?? []).find((x) => x.id === e.target.value);
                setPoId(e.target.value);
                setPoRef(p?.ref_no ?? "");
              }}
              className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
            >
              <option value="">None (Direct Bill)</option>
              {(posQ.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.ref_no} — {p.party_name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="b-status">Status</Label>
            <select id="b-status" value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="open">Open</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          <div>
            <Label htmlFor="b-date">Bill Date</Label>
            <Input id="b-date" type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} className="mt-1 rounded-md" />
          </div>
          <div>
            <Label htmlFor="b-due">Due Date</Label>
            <Input id="b-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 rounded-md" />
          </div>
          <div>
            <Label htmlFor="b-notes">Vendor Invoice / Notes</Label>
            <Input id="b-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 rounded-md" />
          </div>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-label">Bill Lines</h2>
            <select
              aria-label="Add item to bill"
              value=""
              onChange={(e) => {
                const it = (itemsQ.data ?? []).find((x) => x.id === e.target.value);
                if (!it) return;
                setLines((prev) => [...prev, { item_id: it.id, description: `${it.sku} — ${it.name}`, qty: 1, rate: Number(it.cost ?? 0), taxKind: "vat", taxRate: 12 }]);
              }}
              className="h-9 rounded-md border bg-surface px-3 text-sm"
            >
              <option value="">+ Add item…</option>
              {(itemsQ.data ?? []).map((it) => (
                <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">Unit Cost</th>
                  <th className="py-2 pr-3">Tax Code</th>
                  <th className="py-2 pr-3 text-right">Input VAT</th>
                  <th className="py-2 pr-3 text-right">Net</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="py-1.5 pr-3">{l.description}</td>
                    <td className="py-1.5 pr-3 text-right">
                      <Input type="number" step="any" value={l.qty} onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value) || 0 } : x)))} className="ml-auto h-8 w-20 rounded-md text-right" />
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <Input type="number" step="any" value={l.rate} onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, rate: Number(e.target.value) || 0 } : x)))} className="ml-auto h-8 w-24 rounded-md text-right" />
                    </td>
                    <td className="py-1.5 pr-3">
                      <select
                        value={l.taxKind}
                        onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, taxKind: e.target.value as BillLine["taxKind"] } : x)))}
                        className="h-8 rounded-md border bg-surface px-2 text-xs"
                      >
                        <option value="vat">VAT 12%</option>
                        <option value="exempt">VAT-Exempt</option>
                        <option value="zero_rated">Zero-Rated</option>
                      </select>
                    </td>
                    <td className="py-1.5 pr-3 text-right">₱{peso(l.taxKind === "vat" ? (l.qty * l.rate * l.taxRate) / 100 : 0)}</td>
                    <td className="py-1.5 pr-3 text-right font-medium">₱{peso(l.qty * l.rate)}</td>
                    <td className="py-1.5 text-right">
                      <Button variant="ghost" size="icon" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))} aria-label="Remove line">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 border-t pt-4 md:grid-cols-2">
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <Switch id="b-claim" checked={inputVatClaimable} onCheckedChange={setInputVatClaimable} />
                <Label htmlFor="b-claim">
                  Input VAT is {inputVatClaimable ? "Claimable (creditable against Output VAT)" : "Capitalized (added to cost)"}
                </Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="b-atc">EWT ATC Code</Label>
                  <select
                    id="b-atc"
                    value={ewtAtc}
                    onChange={(e) => {
                      setEwtAtc(e.target.value);
                      const found = (atcQ.data ?? []).find((a) => a.code === e.target.value);
                      setEwtRate(found ? Number(found.rate) : 0);
                    }}
                    className="mt-1 h-9 w-full rounded-md border bg-surface px-2 text-sm"
                  >
                    <option value="">No EWT</option>
                    {(atcQ.data ?? []).map((a) => (
                      <option key={a.code} value={a.code}>{a.code} ({a.rate}%) — {a.description}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="b-2307">Form 2307 Certificate #</Label>
                  <Input id="b-2307" value={f2307No} onChange={(e) => setF2307No(e.target.value)} placeholder="2307-2026-001" className="mt-1 rounded-md" />
                </div>
              </div>
              <label className="flex items-center gap-2">
                <Checkbox checked={f2307Issued} onCheckedChange={(v) => setF2307Issued(!!v)} />
                <span>Form 2307 issued to vendor</span>
              </label>
            </div>

            <div className="space-y-1.5 rounded-md border bg-muted p-4 text-sm">
              <div className="flex justify-between"><span>Net Purchases</span><span>₱{peso(netPurchases)}</span></div>
              <div className="flex justify-between"><span>Input VAT (12%)</span><span>₱{peso(inputVat)}</span></div>
              <div className="flex justify-between font-medium"><span>Gross Bill Amount</span><span>₱{peso(grossBill)}</span></div>
              <div className="flex justify-between text-destructive"><span>Less: EWT Withheld ({ewtRate}%)</span><span>-₱{peso(ewtAmount)}</span></div>
              <div className="flex justify-between border-t pt-2 text-base font-medium">
                <span>Amount payable after withholding</span>
                <span>₱{peso(amountPayable)}</span>
              </div>
            </div>
          </div>

          {canWrite && (
            <div className="mt-4 flex justify-end">
              <Button disabled={busy} onClick={() => void handleSave()}>
                <Plus className="mr-1.5 h-4 w-4" />
                Save Vendor Bill
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
