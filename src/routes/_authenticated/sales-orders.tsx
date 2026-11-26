import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, num, peso, todayISO } from "@/lib/format";
import { getItemAvailability, roundQty } from "@/lib/inventory";
import { computeTax, type DiscountType, type PriceMode, type TaxKind } from "@/lib/ph-tax";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { BarcodeScanBar } from "@/components/BarcodeTools";
import { downloadBirPdf } from "@/components/BirInvoicePdf";
import { SalesOrderActionModals, type ActiveActionModal, type SoHeader, type SoLine } from "@/components/SalesOrderActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SoListRow {
  id: string;
  ref_no: string;
  txn_date: string;
  due_date: string | null;
  party_name: string | null;
  status: string;
  voided: boolean;
  total: number;
  amount_due: number;
}

export const Route = createFileRoute("/_authenticated/sales-orders")({
  validateSearch: (s: Record<string, unknown>) => ({
    id: typeof s["id"] === "string" ? s["id"] : undefined,
    isNew: s["new"] === "1" || s["new"] === true,
  }),
  head: () => ({
    meta: [
      { title: "Sales orders — SOS Inventory" },
      { name: "description", content: "Customer sales orders and partial fulfillment workflow." },
    ],
  }),
  component: SalesOrdersPage,
});

function statusBadge(status: string, voided: boolean) {
  if (voided || status === "void") return <Badge variant="destructive">Voided</Badge>;
  if (status === "closed" || status === "fully_shipped") return <Badge variant="secondary">{labelize(status)}</Badge>;
  if (status === "partially_shipped" || status === "partially_invoiced") return <Badge variant="outline">{labelize(status)}</Badge>;
  return <Badge variant="outline">{status === "open" ? "Pending" : labelize(status)}</Badge>;
}

function SalesOrdersPage() {
  const { id, isNew } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { companyId, canWrite } = useCompany();

  if (id || isNew) {
    return (
      <SalesOrderForm
        soId={id}
        onBack={() => void navigate({ search: { id: undefined, isNew: false } })}
        onSavedId={(savedId) => void navigate({ search: { id: savedId, isNew: false } })}
      />
    );
  }

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select("id, ref_no, txn_date, due_date, party_name, status, voided, total, amount_due", { count: "exact" })
      .eq("company_id", companyId)
      .eq("type", "sales_order");

    if (a.filter === "open") q = q.in("status", ["open", "pending", "partially_shipped", "partially_invoiced"]).eq("voided", false);
    else if (a.filter === "closed") q = q.eq("status", "closed");
    else if (a.filter === "voided") q = q.eq("voided", true);

    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,party_name.ilike.%${a.search}%`);

    const sortMap: Record<string, string> = { ref: "ref_no", date: "txn_date", customer: "party_name", total: "total" };
    const { data, count, error } = await q
      .order(sortMap[a.sort.key] ?? "txn_date", { ascending: a.sort.dir === "asc" })
      .order("ref_no", { ascending: false })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as SoListRow[], total: count ?? 0 };
  };

  const columns: Column<SoListRow>[] = [
    {
      key: "ref",
      header: "Ref #",
      sortable: true,
      cell: (r) => (
        <button type="button" className="link-ref text-left" onClick={() => void navigate({ search: { id: r.id, isNew: false } })}>
          {r.ref_no}
        </button>
      ),
      csv: (r) => r.ref_no,
    },
    { key: "date", header: "Date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    { key: "customer", header: "Customer", sortable: true, cell: (r) => r.party_name ?? "—", csv: (r) => r.party_name ?? "" },
    { key: "status", header: "Status", cell: (r) => statusBadge(r.status, r.voided), csv: (r) => r.status },
    { key: "total", header: "Total", sortable: true, cell: (r) => `₱${peso(r.total)}`, csv: (r) => String(r.total) },
    { key: "due", header: "Amount due", cell: (r) => `₱${peso(r.amount_due)}`, csv: (r) => String(r.amount_due) },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Sales orders" subtitle="Manage customer orders, partial shipments, and invoicing" />
      {companyId && (
        <DataTable<SoListRow>
          id="sales-orders"
          queryKey={["sales_orders", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          filters={[
            { value: "all", label: "All" },
            { value: "open", label: "Pending / Partial" },
            { value: "closed", label: "Closed" },
            { value: "voided", label: "Voided" },
          ]}
          rowActions={[
            { label: "Open sales order", onSelect: (rows) => rows[0] && void navigate({ search: { id: rows[0].id, isNew: false } }) },
          ]}
          {...(canWrite ? { onAdd: () => void navigate({ search: { id: undefined, isNew: true } }) } : {})}
        />
      )}
    </div>
  );
}

function SalesOrderForm({
  soId,
  onBack,
  onSavedId,
}: {
  soId?: string | undefined;
  onBack: () => void;
  onSavedId: (id: string) => void;
}) {
  const { company, companyId, canWrite, isAdmin } = useCompany();
  const qc = useQueryClient();
  const [modal, setModal] = useState<ActiveActionModal>(null);
  const [saving, setSaving] = useState(false);

  const [header, setHeader] = useState<SoHeader>({
    id: soId ?? "",
    ref_no: "(Auto)",
    txn_date: todayISO(),
    due_date: "",
    party_id: "",
    party_name: "",
    location_id: "",
    ship_to: "",
    bill_to: "",
    terms: "Net 30",
    sales_rep: "",
    notes: "",
    price_mode: (company?.price_mode as PriceMode) ?? "exclusive",
    discount_type: "none",
    discount_rate: 0,
    sc_pwd_id: "",
    sc_pwd_name: "",
    ewt_atc: "",
    ewt_rate: 0,
    status: "open",
    voided: false,
  });

  const [customerTin, setCustomerTin] = useState("");
  const [customerTaxType, setCustomerTaxType] = useState("");
  const [lines, setLines] = useState<SoLine[]>([]);

  const customersQ = useQuery({
    queryKey: ["so_customers", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, tin, registered_address, tax_type, default_atc, sc_pwd_id, sc_pwd_name, terms")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("name")
        .limit(300);
      return data ?? [];
    },
  });

  const locationsQ = useQuery({
    queryKey: ["so_locations", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("id, name, is_default").eq("company_id", companyId).eq("archived", false);
      return data ?? [];
    },
  });

  const itemsQ = useQuery({
    queryKey: ["so_items", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase
        .from("items")
        .select("id, sku, name, uom, price, decimals_allowed, type, tracking, preferred_vendor_id, tax_code:tax_codes(id, kind, rate)")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("sku")
        .limit(300);
      return data ?? [];
    },
  });

  const taxCodesQ = useQuery({
    queryKey: ["so_tax_codes", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("tax_codes").select("id, code, kind, rate").eq("company_id", companyId).eq("archived", false);
      return data ?? [];
    },
  });

  const atcQ = useQuery({
    queryKey: ["so_atc_codes", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("atc_codes").select("code, description, rate").eq("company_id", companyId).eq("archived", false);
      return data ?? [];
    },
  });

  const detailQ = useQuery({
    queryKey: ["so_detail", soId],
    enabled: !!soId,
    queryFn: async () => {
      const { data: txn, error } = await supabase.from("transactions").select("*").eq("id", soId!).single();
      if (error) throw error;
      const { data: txnLines } = await supabase
        .from("transaction_lines")
        .select("*, item:items(sku, name, uom, type, tracking, preferred_vendor_id), tax:tax_codes(kind, rate)")
        .eq("transaction_id", soId!)
        .order("line_no");
      return { txn, lines: txnLines ?? [] };
    },
  });

  const relatedQ = useQuery({
    queryKey: ["so_related", soId],
    enabled: !!soId,
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id, type, ref_no, txn_date, status, total, parent_txn_id")
        .eq("company_id", companyId)
        .eq("parent_txn_id", soId!)
        .order("txn_date", { ascending: false });
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!detailQ.data) return;
    const { txn, lines: dbLines } = detailQ.data;
    setHeader({
      id: txn.id,
      ref_no: txn.ref_no,
      txn_date: txn.txn_date,
      due_date: txn.due_date ?? "",
      party_id: txn.party_id ?? "",
      party_name: txn.party_name ?? "",
      location_id: txn.location_id ?? "",
      ship_to: txn.ship_to ?? "",
      bill_to: txn.bill_to ?? "",
      terms: txn.terms ?? "",
      sales_rep: txn.sales_rep ?? "",
      notes: txn.notes ?? "",
      price_mode: (txn.price_mode as PriceMode) || "exclusive",
      discount_type: txn.discount_type,
      discount_rate: Number(txn.discount_rate),
      sc_pwd_id: txn.sc_pwd_id ?? "",
      sc_pwd_name: txn.sc_pwd_name ?? "",
      ewt_atc: txn.ewt_atc ?? "",
      ewt_rate: Number(txn.ewt_rate),
      status: txn.status,
      voided: txn.voided,
    });
    const mapped: SoLine[] = dbLines.map((l) => {
      const it = l.item as unknown as { sku: string; name: string; uom: string; type: string; tracking: string; preferred_vendor_id: string | null } | null;
      const tc = l.tax as unknown as { kind: TaxKind; rate: number } | null;
      return {
        id: l.id,
        item_id: l.item_id ?? "",
        sku: it?.sku ?? "",
        name: it?.name ?? "",
        description: l.description ?? it?.name ?? "",
        qty: Number(l.qty),
        qty_fulfilled: Number(l.qty_fulfilled),
        qty_invoiced: Number(l.qty_invoiced),
        uom: l.uom ?? it?.uom ?? "pc",
        rate: Number(l.rate),
        discount_rate: Number(l.discount_rate ?? 0),
        tax_code_id: l.tax_code_id ?? "",
        tax_kind: tc?.kind ?? "vat",
        tax_rate: Number(tc?.rate ?? 12),
        amount: Number(l.amount),
        lot_id: l.lot_id ?? "",
        serial_id: l.serial_id ?? "",
        preferred_vendor_id: it?.preferred_vendor_id ?? null,
        item_type: it?.type ?? "inventory",
        tracking: it?.tracking ?? "none",
      };
    });
    setLines(mapped);
  }, [detailQ.data]);

  // Refresh customer TIN/tax badge when party_id changes
  useEffect(() => {
    const c = (customersQ.data ?? []).find((x) => x.id === header.party_id);
    if (c) {
      setCustomerTin(c.tin ?? "");
      setCustomerTaxType(labelize(c.tax_type));
    }
  }, [header.party_id, customersQ.data]);

  // Check availability for lines when items/location change
  useEffect(() => {
    if (!companyId || lines.length === 0) return;
    let active = true;
    (async () => {
      const updated = await Promise.all(
        lines.map(async (l) => {
          if (!l.item_id) return l;
          const avail = await getItemAvailability(companyId, l.item_id, header.location_id || null);
          return { ...l, onHand: avail.onHand, committed: avail.committed, available: avail.available };
        }),
      );
      if (active) setLines(updated);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, header.location_id, lines.length]);

  const taxResult = useMemo(() => {
    return computeTax(
      lines.map((l) => ({
        qty: l.qty,
        rate: l.rate * (1 - l.discount_rate / 100),
        kind: l.tax_kind,
        taxRate: l.tax_rate,
      })),
      {
        priceMode: header.price_mode,
        vatRegistered: company?.vat_registered ?? true,
        percentageTaxRate: Number(company?.percentage_tax_rate ?? 3),
        discountType: header.discount_type,
        discountRate: header.discount_rate,
        ewtRate: header.ewt_rate,
      },
    );
  }, [lines, header.price_mode, header.discount_type, header.discount_rate, header.ewt_rate, company]);

  const addLineByItem = async (itemId: string) => {
    const it = (itemsQ.data ?? []).find((i) => i.id === itemId);
    if (!it) return;
    const tc = it.tax_code as unknown as { id: string; kind: TaxKind; rate: number } | null;
    const avail = await getItemAvailability(companyId, it.id, header.location_id || null);
    setLines((prev) => [
      ...prev,
      {
        item_id: it.id,
        sku: it.sku,
        name: it.name,
        description: it.name,
        qty: 1,
        qty_fulfilled: 0,
        qty_invoiced: 0,
        uom: it.uom,
        rate: Number(it.price),
        discount_rate: 0,
        tax_code_id: tc?.id ?? "",
        tax_kind: tc?.kind ?? "vat",
        tax_rate: Number(tc?.rate ?? 12),
        amount: Number(it.price),
        lot_id: "",
        serial_id: "",
        preferred_vendor_id: it.preferred_vendor_id,
        item_type: it.type,
        tracking: it.tracking,
        onHand: avail.onHand,
        committed: avail.committed,
        available: avail.available,
      },
    ]);
  };

  const handleSave = async () => {
    if (!header.party_id) return void toast.error("Select a customer");
    if (lines.length === 0) return void toast.error("Add at least one line item");
    setSaving(true);
    try {
      const { data: savedId, error } = await supabase.rpc("save_transaction", {
        p: {
          id: header.id || null,
          company_id: companyId,
          type: "sales_order",
          status: header.status,
          txn_date: header.txn_date,
          due_date: header.due_date || null,
          party_type: "customer",
          party_id: header.party_id,
          party_name: header.party_name,
          location_id: header.location_id || locationsQ.data?.[0]?.id || null,
          ship_to: header.ship_to,
          bill_to: header.bill_to,
          terms: header.terms,
          sales_rep: header.sales_rep,
          notes: header.notes,
          price_mode: header.price_mode,
          vatable_sales: taxResult.vatableSales,
          vat_exempt_sales: taxResult.vatExemptSales,
          zero_rated_sales: taxResult.zeroRatedSales,
          vat_amount: taxResult.vatAmount,
          percentage_tax_amount: taxResult.percentageTax,
          discount_type: header.discount_type,
          discount_rate: header.discount_rate,
          discount_amount: taxResult.discountAmount,
          sc_pwd_id: header.sc_pwd_id || null,
          sc_pwd_name: header.sc_pwd_name || null,
          ewt_atc: header.ewt_atc || null,
          ewt_rate: header.ewt_rate,
          ewt_amount: taxResult.ewtAmount,
          total: taxResult.totalAmountDue,
          amount_due: taxResult.amountDueAfterWithholding,
          lines: lines.map((l, idx) => ({
            item_id: l.item_id,
            description: l.description,
            qty: l.qty,
            qty_fulfilled: l.qty_fulfilled,
            qty_invoiced: l.qty_invoiced,
            uom: l.uom,
            rate: l.rate,
            discount_rate: l.discount_rate,
            amount: taxResult.lines[idx]?.net ?? roundQty(l.qty * l.rate * (1 - l.discount_rate / 100), 2),
            tax_code_id: l.tax_code_id || null,
            vat_amount: taxResult.lines[idx]?.vat ?? 0,
            lot_id: l.lot_id || null,
            serial_id: l.serial_id || null,
          })),
        },
      });
      if (error) throw error;
      toast.success("Sales Order saved");
      qc.invalidateQueries({ queryKey: ["sales_orders", companyId] });
      onSavedId(savedId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to sales orders
        </Button>
        <div className="flex items-center gap-2">
          {soId && company && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Actions
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setModal("invoice")}>Create Invoice</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setModal("shipment")}>Create Shipment</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setModal("pick_ticket")}>Create Pick Ticket</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setModal("po")}>Create Purchase Order</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setModal("transfer")}>Create Transfer</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setModal("work_order")}>Create Work Order</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setModal("rma")}>Create RMA</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setModal("return")}>Create Return</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    void downloadBirPdf(company, {
                      documentTitle: "SALES ORDER",
                      refNo: header.ref_no,
                      txnDate: header.txn_date,
                      terms: header.terms,
                      buyerName: header.party_name,
                      buyerTin: customerTin,
                      buyerAddress: header.bill_to,
                      lines: lines.map((l) => ({
                        qty: l.qty,
                        uom: l.uom,
                        description: l.description,
                        rate: l.rate,
                        amount: l.amount,
                      })),
                      vatableSales: taxResult.vatableSales,
                      vatExemptSales: taxResult.vatExemptSales,
                      zeroRatedSales: taxResult.zeroRatedSales,
                      vatAmount: taxResult.vatAmount,
                      discountAmount: taxResult.discountAmount,
                      ewtAtc: header.ewt_atc,
                      ewtRate: header.ewt_rate,
                      ewtAmount: taxResult.ewtAmount,
                      total: taxResult.totalAmountDue,
                      amountDue: taxResult.amountDueAfterWithholding,
                      notes: header.notes,
                    })
                  }
                >
                  Create PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setModal("email")}>Email Order</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setModal("pnl")}>View Profit / Loss</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canWrite && !header.voided && (
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving…" : "Save Sales Order"}
            </Button>
          )}
        </div>
      </div>

      <PageHeader
        title={soId ? `Sales Order ${header.ref_no}` : "New Sales Order"}
        subtitle={customerTin ? `TIN ${customerTin} · ${customerTaxType}` : "Customer order & fulfillment"}
        actions={statusBadge(header.status, header.voided)}
      />

      <Tabs defaultValue="order">
        <TabsList className="mb-4">
          <TabsTrigger value="order">Order</TabsTrigger>
          {soId && <TabsTrigger value="related">Related transactions</TabsTrigger>}
        </TabsList>

        <TabsContent value="order" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 rounded-lg border bg-card p-5 md:grid-cols-3">
            <div>
              <Label htmlFor="so-cust">Customer *</Label>
              <select
                id="so-cust"
                value={header.party_id}
                onChange={(e) => {
                  const c = (customersQ.data ?? []).find((x) => x.id === e.target.value);
                  setHeader((h) => ({
                    ...h,
                    party_id: e.target.value,
                    party_name: c?.name ?? "",
                    bill_to: c?.registered_address ?? "",
                    ship_to: c?.registered_address ?? "",
                    terms: c?.terms ?? h.terms,
                    ewt_atc: c?.default_atc ?? "",
                    sc_pwd_id: c?.sc_pwd_id ?? "",
                    sc_pwd_name: c?.sc_pwd_name ?? "",
                  }));
                }}
                className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
              >
                <option value="">Select customer…</option>
                {(customersQ.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="so-loc">Location</Label>
              <select
                id="so-loc"
                value={header.location_id}
                onChange={(e) => setHeader((h) => ({ ...h, location_id: e.target.value }))}
                className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
              >
                <option value="">Default location</option>
                {(locationsQ.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="so-date">Order date</Label>
                <Input id="so-date" type="date" value={header.txn_date} onChange={(e) => setHeader((h) => ({ ...h, txn_date: e.target.value }))} className="mt-1 rounded-md" />
              </div>
              <div>
                <Label htmlFor="so-due">Due date</Label>
                <Input id="so-due" type="date" value={header.due_date} onChange={(e) => setHeader((h) => ({ ...h, due_date: e.target.value }))} className="mt-1 rounded-md" />
              </div>
            </div>
            <div>
              <Label htmlFor="so-bill">Bill to</Label>
              <Input id="so-bill" value={header.bill_to} onChange={(e) => setHeader((h) => ({ ...h, bill_to: e.target.value }))} className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="so-ship">Ship to</Label>
              <Input id="so-ship" value={header.ship_to} onChange={(e) => setHeader((h) => ({ ...h, ship_to: e.target.value }))} className="mt-1 rounded-md" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="so-terms">Terms</Label>
                <Input id="so-terms" value={header.terms} onChange={(e) => setHeader((h) => ({ ...h, terms: e.target.value }))} className="mt-1 rounded-md" />
              </div>
              <div>
                <Label htmlFor="so-rep">Sales rep</Label>
                <Input id="so-rep" value={header.sales_rep} onChange={(e) => setHeader((h) => ({ ...h, sales_rep: e.target.value }))} className="mt-1 rounded-md" />
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="section-label">Line items</h3>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-72">
                  <BarcodeScanBar placeholder="Scan barcode / SKU to add…" onMatch={(m) => void addLineByItem(m.itemId)} />
                </div>
                <select
                  value=""
                  onChange={(e) => e.target.value && void addLineByItem(e.target.value)}
                  className="h-9 w-56 rounded-md border bg-surface px-3 text-sm"
                >
                  <option value="">+ Add item…</option>
                  {(itemsQ.data ?? []).map((i) => (
                    <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-2">Item / Description</th>
                    <th className="w-20 py-2 pr-2 text-right">Qty</th>
                    <th className="w-16 py-2 pr-2">UOM</th>
                    <th className="w-24 py-2 pr-2 text-right">Rate</th>
                    <th className="w-16 py-2 pr-2 text-right">Disc%</th>
                    <th className="w-28 py-2 pr-2">Tax</th>
                    <th className="w-24 py-2 pr-2 text-right">Amount</th>
                    <th className="w-28 py-2 pr-2 text-right">Ship / Inv / Rem</th>
                    <th className="w-28 py-2 pr-2 text-right">Avail</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-6 text-center text-muted-foreground">
                        No lines yet. Add an item or scan a barcode above.
                      </td>
                    </tr>
                  )}
                  {lines.map((l, idx) => {
                    const short = l.item_type === "inventory" && l.available !== undefined && l.qty > l.available;
                    const remaining = Math.max(0, l.qty - l.qty_fulfilled);
                    return (
                      <tr key={idx} className="border-b">
                        <td className="py-1.5 pr-2">
                          <Input
                            value={l.description}
                            onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))}
                            className="h-8 rounded-md"
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <Input
                            type="number"
                            step="any"
                            value={l.qty}
                            onChange={(e) => {
                              const q = Number(e.target.value) || 0;
                              setLines((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, qty: q, amount: roundQty(q * x.rate * (1 - x.discount_rate / 100), 2) } : x,
                                ),
                              );
                            }}
                            className="h-8 rounded-md text-right"
                          />
                        </td>
                        <td className="py-1.5 pr-2">{l.uom}</td>
                        <td className="py-1.5 pr-2">
                          <Input
                            type="number"
                            step="any"
                            value={l.rate}
                            onChange={(e) => {
                              const r = Number(e.target.value) || 0;
                              setLines((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, rate: r, amount: roundQty(x.qty * r * (1 - x.discount_rate / 100), 2) } : x,
                                ),
                              );
                            }}
                            className="h-8 rounded-md text-right"
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <Input
                            type="number"
                            step="any"
                            value={l.discount_rate}
                            onChange={(e) => {
                              const d = Number(e.target.value) || 0;
                              setLines((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, discount_rate: d, amount: roundQty(x.qty * x.rate * (1 - d / 100), 2) } : x,
                                ),
                              );
                            }}
                            className="h-8 rounded-md text-right"
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <select
                            value={l.tax_code_id}
                            onChange={(e) => {
                              const tc = (taxCodesQ.data ?? []).find((t) => t.id === e.target.value);
                              setLines((prev) =>
                                prev.map((x, i) =>
                                  i === idx
                                    ? {
                                        ...x,
                                        tax_code_id: e.target.value,
                                        tax_kind: (tc?.kind as TaxKind) ?? "vat",
                                        tax_rate: Number(tc?.rate ?? 12),
                                      }
                                    : x,
                                ),
                              );
                            }}
                            className="h-8 w-full rounded-md border bg-surface px-1.5 text-xs"
                          >
                            {(taxCodesQ.data ?? []).map((t) => (
                              <option key={t.id} value={t.id}>{t.code}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1.5 pr-2 text-right font-medium">₱{peso(l.amount)}</td>
                        <td className="py-1.5 pr-2 text-right text-xs text-muted-foreground">
                          {num(l.qty_fulfilled, 0)} / {num(l.qty_invoiced, 0)} / {num(remaining, 0)}
                        </td>
                        <td className={`py-1.5 pr-2 text-right text-xs ${short ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                          {l.available !== undefined ? `${num(l.available, 0)} (${num(l.onHand ?? 0, 0)} OH)` : "—"}
                        </td>
                        <td className="py-1.5 text-right">
                          <button
                            type="button"
                            aria-label="Remove line"
                            onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-card p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="so-disc">Discount type</Label>
                  <select
                    id="so-disc"
                    value={header.discount_type}
                    onChange={(e) => setHeader((h) => ({ ...h, discount_type: e.target.value as DiscountType }))}
                    className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
                  >
                    <option value="none">None</option>
                    <option value="regular">Regular %</option>
                    <option value="senior">Senior Citizen (20%)</option>
                    <option value="pwd">PWD (20%)</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="so-atc">EWT ATC</Label>
                  <select
                    id="so-atc"
                    value={header.ewt_atc}
                    onChange={(e) => {
                      const a = (atcQ.data ?? []).find((x) => x.code === e.target.value);
                      setHeader((h) => ({ ...h, ewt_atc: e.target.value, ewt_rate: Number(a?.rate ?? 0) }));
                    }}
                    className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
                  >
                    <option value="">None</option>
                    {(atcQ.data ?? []).map((a) => (
                      <option key={a.code} value={a.code}>{a.code} ({a.rate}%)</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <Label htmlFor="so-notes">Comment / Notes</Label>
                <Input id="so-notes" value={header.notes} onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))} className="mt-1 rounded-md" />
              </div>
            </div>

            <div className="rounded-lg border bg-card p-5 text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-muted-foreground">VATable Sales</span><span>₱{peso(taxResult.vatableSales)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">VAT-Exempt Sales</span><span>₱{peso(taxResult.vatExemptSales)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Zero-Rated Sales</span><span>₱{peso(taxResult.zeroRatedSales)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">VAT 12%</span><span>₱{peso(taxResult.vatAmount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-₱{peso(taxResult.discountAmount)}</span></div>
              <div className="flex justify-between border-t pt-1.5 font-medium"><span>Total</span><span>₱{peso(taxResult.totalAmountDue)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Less EWT ({header.ewt_atc || "0%"})</span><span>-₱{peso(taxResult.ewtAmount)}</span></div>
              <div className="flex justify-between border-t pt-1.5 text-base font-medium"><span>Amount Due</span><span>₱{peso(taxResult.amountDueAfterWithholding)}</span></div>
            </div>
          </div>
        </TabsContent>

        {soId && (
          <TabsContent value="related">
            <div className="rounded-lg border bg-card p-5">
              <h3 className="section-label mb-3">Related transactions ({header.ref_no})</h3>
              {(relatedQ.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No linked Pick Tickets, Shipments, Invoices, or Returns yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {(relatedQ.data ?? []).map((t) => (
                    <li key={t.id} className="flex items-center justify-between rounded-md border bg-surface px-3 py-2">
                      <div>
                        <span className="font-medium">{t.ref_no}</span> · {labelize(t.type)} · {fmtDate(t.txn_date)}
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">{labelize(t.status)}</Badge>
                        <span>₱{peso(t.total)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>
        )}
      </Tabs>

      {company && (
        <SalesOrderActionModals
          modal={modal}
          onClose={() => setModal(null)}
          so={header}
          lines={lines}
          company={company}
          isAdmin={isAdmin}
          onDone={() => void detailQ.refetch()}
        />
      )}
    </div>
  );
}
