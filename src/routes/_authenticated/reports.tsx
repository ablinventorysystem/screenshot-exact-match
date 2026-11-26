import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, num, peso, todayISO } from "@/lib/format";
import { isExpiringSoon } from "@/lib/inventory";
import { PageHeader } from "@/components/PageHeader";
import { PhTaxReportsTab } from "@/components/PhTaxReportsTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ReportKey =
  | "inv_valuation"
  | "inv_by_loc"
  | "low_stock"
  | "lot_expiry"
  | "serial_history"
  | "sales_by_customer"
  | "sales_by_item"
  | "open_so"
  | "backorders"
  | "pnl_order_item"
  | "po_status"
  | "production_cost"
  | "qb_unsynced";

const REPORT_LIST: { key: ReportKey; label: string }[] = [
  { key: "inv_valuation", label: "Inventory valuation" },
  { key: "inv_by_loc", label: "Inventory by location" },
  { key: "low_stock", label: "Low stock / reorder" },
  { key: "lot_expiry", label: "Lot expiry" },
  { key: "serial_history", label: "Serial history" },
  { key: "sales_by_customer", label: "Sales by customer" },
  { key: "sales_by_item", label: "Sales by item" },
  { key: "open_so", label: "Open sales orders" },
  { key: "backorders", label: "Backorders" },
  { key: "pnl_order_item", label: "Profit / Loss by order & item" },
  { key: "po_status", label: "PO status" },
  { key: "production_cost", label: "Production cost" },
  { key: "qb_unsynced", label: "Transactions unsynced to QuickBooks" },
];

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — ABL Inventory" },
      { name: "description", content: "Business, inventory, fulfillment, and Philippine BIR tax reports." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { companyId } = useCompany();
  const [report, setReport] = useState<ReportKey>("inv_valuation");
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [toDate, setToDate] = useState(todayISO());
  const [locationId, setLocationId] = useState("");

  const locsQ = useQuery({
    queryKey: ["rep_locs", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("id, name").eq("company_id", companyId).eq("archived", false);
      return data ?? [];
    },
  });

  const dataQ = useQuery({
    queryKey: ["reports_bundle", companyId, fromDate, toDate, locationId],
    enabled: !!companyId,
    queryFn: async () => {
      let invQ = supabase.from("inventory_levels").select("qty, location_id, item:items(id, sku, name, cost, price, reorder_point), location:locations(name)").eq("company_id", companyId);
      if (locationId) invQ = invQ.eq("location_id", locationId);

      const [{ data: inv }, { data: lots }, { data: serials }, { data: txns }, { data: lines }] = await Promise.all([
        invQ,
        supabase.from("item_lots").select("id, lot_no, received_date, expiry_date, item:items(sku, name)").eq("company_id", companyId).order("expiry_date", { ascending: true }),
        supabase.from("item_serials").select("id, serial_no, status, unit_cost, created_at, item:items(sku, name)").eq("company_id", companyId).order("created_at", { ascending: false }).limit(200),
        supabase.from("transactions").select("*").eq("company_id", companyId).gte("txn_date", fromDate).lte("txn_date", toDate).order("txn_date", { ascending: false }),
        supabase.from("transaction_lines").select("*, txn:transactions!inner(ref_no, type, txn_date, status, party_name, company_id, voided)").eq("txn.company_id", companyId).eq("txn.voided", false).gte("txn.txn_date", fromDate).lte("txn.txn_date", toDate),
      ]);
      return { inv: inv ?? [], lots: lots ?? [], serials: serials ?? [], txns: txns ?? [], lines: lines ?? [] };
    },
  });

  const { headers, rows } = useMemo(() => {
    const d = dataQ.data;
    if (!d) return { headers: [] as string[], rows: [] as string[][] };

    switch (report) {
      case "inv_valuation": {
        const byItem = new Map<string, { sku: string; name: string; qty: number; cost: number }>();
        for (const r of d.inv) {
          const it = r.item as unknown as { id: string; sku: string; name: string; cost: number } | null;
          if (!it) continue;
          const cur = byItem.get(it.id) ?? { sku: it.sku, name: it.name, qty: 0, cost: Number(it.cost) };
          cur.qty += Number(r.qty);
          byItem.set(it.id, cur);
        }
        return {
          headers: ["SKU", "Item", "On Hand", "Unit Cost", "Total Value"],
          rows: Array.from(byItem.values()).map((x) => [x.sku, x.name, num(x.qty, 2), peso(x.cost), peso(x.qty * x.cost)]),
        };
      }
      case "inv_by_loc":
        return {
          headers: ["Location", "SKU", "Item", "Qty"],
          rows: d.inv.map((r) => {
            const it = r.item as unknown as { sku: string; name: string } | null;
            const loc = r.location as unknown as { name: string } | null;
            return [loc?.name ?? "—", it?.sku ?? "", it?.name ?? "", num(r.qty, 2)];
          }),
        };
      case "low_stock": {
        const totals = new Map<string, { sku: string; name: string; qty: number; rp: number }>();
        for (const r of d.inv) {
          const it = r.item as unknown as { id: string; sku: string; name: string; reorder_point: number | null } | null;
          if (!it || it.reorder_point === null) continue;
          const cur = totals.get(it.id) ?? { sku: it.sku, name: it.name, qty: 0, rp: Number(it.reorder_point) };
          cur.qty += Number(r.qty);
          totals.set(it.id, cur);
        }
        return {
          headers: ["SKU", "Item", "On Hand", "Reorder Point", "Shortage"],
          rows: Array.from(totals.values())
            .filter((x) => x.qty <= x.rp)
            .map((x) => [x.sku, x.name, num(x.qty, 2), num(x.rp, 2), num(Math.max(0, x.rp - x.qty), 2)]),
        };
      }
      case "lot_expiry":
        return {
          headers: ["Lot #", "Item", "Received", "Expiry", "Alert"],
          rows: d.lots.map((l) => {
            const it = l.item as unknown as { sku: string; name: string } | null;
            return [l.lot_no, it ? `${it.sku} — ${it.name}` : "", fmtDate(l.received_date), fmtDate(l.expiry_date) || "No expiry", isExpiringSoon(l.expiry_date) ? "Expiring <=30d" : "OK"];
          }),
        };
      case "serial_history":
        return {
          headers: ["Serial #", "Item", "Status", "Unit Cost", "Created"],
          rows: d.serials.map((s) => {
            const it = s.item as unknown as { sku: string; name: string } | null;
            return [s.serial_no, it ? `${it.sku} — ${it.name}` : "", labelize(s.status), peso(s.unit_cost), fmtDate(s.created_at)];
          }),
        };
      case "sales_by_customer": {
        const map = new Map<string, { name: string; count: number; total: number }>();
        for (const t of d.txns.filter((x) => (x.type === "invoice" || x.type === "sales_receipt") && !x.voided)) {
          const k = t.party_name || "Walk-in";
          const cur = map.get(k) ?? { name: k, count: 0, total: 0 };
          cur.count += 1;
          cur.total += Number(t.total);
          map.set(k, cur);
        }
        return {
          headers: ["Customer", "Invoices", "Total Sales"],
          rows: Array.from(map.values()).map((x) => [x.name, String(x.count), peso(x.total)]),
        };
      }
      case "sales_by_item": {
        const map = new Map<string, { desc: string; qty: number; amt: number }>();
        for (const l of d.lines) {
          const t = l.txn as unknown as { type: string };
          if (t.type !== "invoice" && t.type !== "sales_receipt") continue;
          const k = l.description || l.item_id || "Item";
          const cur = map.get(k) ?? { desc: k, qty: 0, amt: 0 };
          cur.qty += Number(l.qty);
          cur.amt += Number(l.amount);
          map.set(k, cur);
        }
        return {
          headers: ["Item", "Qty Sold", "Revenue"],
          rows: Array.from(map.values()).map((x) => [x.desc, num(x.qty, 2), peso(x.amt)]),
        };
      }
      case "open_so":
        return {
          headers: ["SO #", "Date", "Customer", "Status", "Total"],
          rows: d.txns
            .filter((t) => t.type === "sales_order" && !t.voided && t.status !== "closed")
            .map((t) => [t.ref_no, fmtDate(t.txn_date), t.party_name ?? "—", labelize(t.status), peso(t.total)]),
        };
      case "backorders":
        return {
          headers: ["SO #", "Item", "Ordered", "Fulfilled", "Backordered"],
          rows: d.lines
            .filter((l) => (l.txn as unknown as { type: string }).type === "sales_order" && Number(l.qty) > Number(l.qty_fulfilled))
            .map((l) => {
              const t = l.txn as unknown as { ref_no: string };
              return [t.ref_no, l.description ?? "", num(l.qty, 2), num(l.qty_fulfilled, 2), num(Number(l.qty) - Number(l.qty_fulfilled), 2)];
            }),
        };
      case "pnl_order_item":
        return {
          headers: ["Doc #", "Item", "Qty", "Revenue"],
          rows: d.lines
            .filter((l) => {
              const tp = (l.txn as unknown as { type: string }).type;
              return tp === "invoice" || tp === "sales_order";
            })
            .map((l) => {
              const t = l.txn as unknown as { ref_no: string };
              return [t.ref_no, l.description ?? "", num(l.qty, 2), peso(l.amount)];
            }),
        };
      case "po_status":
        return {
          headers: ["PO #", "Date", "Vendor", "Status", "Total"],
          rows: d.txns
            .filter((t) => t.type === "purchase_order" && !t.voided)
            .map((t) => [t.ref_no, fmtDate(t.txn_date), t.party_name ?? "—", labelize(t.status), peso(t.total)]),
        };
      case "production_cost":
        return {
          headers: ["Ref #", "Type", "Date", "Status", "Total Cost"],
          rows: d.txns
            .filter((t) => t.type === "build" || t.type === "work_order")
            .map((t) => [t.ref_no, labelize(t.type), fmtDate(t.txn_date), labelize(t.status), peso(t.total)]),
        };
      case "qb_unsynced":
        return {
          headers: ["Ref #", "Type", "Date", "Party", "Total", "QB Status"],
          rows: d.txns
            .filter((t) => t.qb_sync_status === "pending" && !t.voided)
            .map((t) => [t.ref_no, labelize(t.type), fmtDate(t.txn_date), t.party_name ?? "—", peso(t.total), labelize(t.qb_sync_status)]),
        };
    }
  }, [dataQ.data, report]);

  const chartData = useMemo(() => {
    const byDate = new Map<string, { date: string; sales: number; purchases: number }>();
    for (const t of dataQ.data?.txns ?? []) {
      if (t.voided) continue;
      const cur = byDate.get(t.txn_date) ?? { date: t.txn_date, sales: 0, purchases: 0 };
      if (t.type === "invoice" || t.type === "sales_receipt") cur.sales += Number(t.total);
      if (t.type === "bill" || t.type === "purchase_order") cur.purchases += Number(t.total);
      byDate.set(t.txn_date, cur);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  }, [dataQ.data]);

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${report}-${fromDate}.csv`;
    a.click();
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Reports"
        subtitle="Business intelligence, inventory analytics, and Philippine BIR tax filings"
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print / PDF
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border bg-card p-4 sm:grid-cols-3 print:hidden">
        <div>
          <Label htmlFor="rep-from">From Date</Label>
          <Input id="rep-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1 rounded-md" />
        </div>
        <div>
          <Label htmlFor="rep-to">To Date</Label>
          <Input id="rep-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1 rounded-md" />
        </div>
        <div>
          <Label htmlFor="rep-loc">Location (optional)</Label>
          <select id="rep-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
            <option value="">All locations</option>
            {(locsQ.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>

      <Tabs defaultValue="business">
        <TabsList className="mb-4 print:hidden">
          <TabsTrigger value="business">Business &amp; Inventory Reports</TabsTrigger>
          <TabsTrigger value="ph_tax">Philippine Tax Reports (BIR)</TabsTrigger>
        </TabsList>

        <TabsContent value="business" className="space-y-4">
          {/* Two simple charts using ONLY CSS token colors */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border bg-card p-4">
              <h2 className="section-label mb-3">Sales vs Purchases (Bar)</h2>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="sales" name="Sales" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="purchases" name="Purchases" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <h2 className="section-label mb-3">Sales Trend (Line)</h2>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="sales" name="Sales" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <select
                aria-label="Select report"
                value={report}
                onChange={(e) => setReport(e.target.value as ReportKey)}
                className="h-9 rounded-md border bg-surface px-3 text-sm font-medium"
              >
                {REPORT_LIST.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="mr-1.5 h-4 w-4" />
                Export CSV
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    {headers.map((h) => <th key={h} className="px-2 py-2">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={Math.max(1, headers.length)} className="p-6 text-center text-muted-foreground">No records for selected filters.</td></tr>
                  )}
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b">
                      {r.map((c, j) => <td key={j} className="px-2 py-1.5">{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="ph_tax">
          <PhTaxReportsTab fromDate={fromDate} toDate={toDate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
