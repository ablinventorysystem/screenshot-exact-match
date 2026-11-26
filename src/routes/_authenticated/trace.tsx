import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, num } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/trace")({
  validateSearch: (s: Record<string, unknown>) => ({
    q: typeof s["q"] === "string" ? s["q"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Trace — ABL Inventory" },
      { name: "description", content: "Upstream and downstream lot/serial traceability and recall list." },
    ],
  }),
  component: TracePage,
});

interface TraceNode {
  id: string;
  direction: "upstream" | "downstream";
  type: string;
  ref_no: string;
  txn_date: string;
  party_name: string;
  qty: number;
  status: string;
}

function TracePage() {
  const { q: initialQ } = Route.useSearch();
  const { companyId } = useCompany();
  const [input, setInput] = useState(initialQ ?? "");
  const [queryTerm, setQueryTerm] = useState(initialQ ?? "");

  const traceQ = useQuery({
    queryKey: ["trace", companyId, queryTerm],
    enabled: !!companyId && !!queryTerm.trim(),
    queryFn: async () => {
      const code = queryTerm.trim();
      const { data: lot } = await supabase
        .from("item_lots")
        .select("id, lot_no, received_date, expiry_date, item:items(id, sku, name, uom)")
        .eq("company_id", companyId)
        .eq("lot_no", code)
        .maybeSingle();

      const { data: serial } = await supabase
        .from("item_serials")
        .select("id, serial_no, status, item:items(id, sku, name, uom)")
        .eq("company_id", companyId)
        .eq("serial_no", code)
        .maybeSingle();

      if (!lot && !serial) return { kind: null, label: code, item: null, nodes: [] as TraceNode[] };

      let lineQ = supabase
        .from("transaction_lines")
        .select("id, qty, txn:transactions(id, type, ref_no, txn_date, party_name, status)")
        .eq("company_id", companyId);

      if (lot) lineQ = lineQ.eq("lot_id", lot.id);
      else if (serial) lineQ = lineQ.eq("serial_id", serial.id);

      const { data: lines } = await lineQ;
      const upstreamTypes = new Set(["purchase_order", "receipt", "bill", "build", "work_order", "adjustment"]);

      const nodes: TraceNode[] = (lines ?? []).map((l) => {
        const t = l.txn as unknown as { id: string; type: string; ref_no: string; txn_date: string; party_name: string | null; status: string } | null;
        const type = t?.type ?? "adjustment";
        return {
          id: l.id,
          direction: upstreamTypes.has(type) ? "upstream" : "downstream",
          type,
          ref_no: t?.ref_no ?? "—",
          txn_date: t?.txn_date ?? "",
          party_name: t?.party_name ?? "Internal",
          qty: Number(l.qty ?? 0),
          status: t?.status ?? "open",
        };
      });

      // Production lot/serial genealogy (both directions)
      if (lot) {
        const [{ data: parents }, { data: children }] = await Promise.all([
          supabase.from("lot_genealogy").select("id, qty, parent_lot_id, build_txn_id").eq("company_id", companyId).eq("child_lot_id", lot.id),
          supabase.from("lot_genealogy").select("id, qty, child_lot_id, build_txn_id").eq("company_id", companyId).eq("parent_lot_id", lot.id),
        ]);
        for (const p of parents ?? []) {
          nodes.push({
            id: `gen-p-${p.id}`,
            direction: "upstream",
            type: "component_lot",
            ref_no: p.parent_lot_id ? `Lot ${p.parent_lot_id.slice(0, 8)}` : "Component",
            txn_date: lot.received_date ?? "",
            party_name: "Production Input",
            qty: Number(p.qty),
            status: "consumed",
          });
        }
        for (const c of children ?? []) {
          nodes.push({
            id: `gen-c-${c.id}`,
            direction: "downstream",
            type: "finished_lot",
            ref_no: c.child_lot_id ? `Lot ${c.child_lot_id.slice(0, 8)}` : "Finished Good",
            txn_date: lot.received_date ?? "",
            party_name: "Production Output",
            qty: Number(c.qty),
            status: "produced",
          });
        }
      }

      const item = (lot?.item ?? serial?.item) as unknown as { id: string; sku: string; name: string; uom: string } | null;
      return {
        kind: lot ? ("lot" as const) : ("serial" as const),
        label: lot ? `Lot ${lot.lot_no}` : `Serial ${serial!.serial_no}`,
        expiry: lot?.expiry_date ?? null,
        item,
        nodes,
      };
    },
  });

  const exportRecallCsv = () => {
    const nodes = traceQ.data?.nodes ?? [];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = ["Direction", "Document Type", "Ref #", "Date", "Customer/Vendor", "Qty", "Status"].map(esc).join(",");
    const rows = nodes.map((n) =>
      [n.direction, labelize(n.type), n.ref_no, fmtDate(n.txn_date), n.party_name, String(n.qty), n.status].map(esc).join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `recall-${queryTerm.trim() || "trace"}.csv`;
    a.click();
  };

  const upstream = (traceQ.data?.nodes ?? []).filter((n) => n.direction === "upstream");
  const downstream = (traceQ.data?.nodes ?? []).filter((n) => n.direction === "downstream");

  return (
    <div className="p-6">
      <PageHeader
        title="Trace"
        subtitle="Enter a lot or serial number to inspect upstream receipts/builds and downstream shipments/customers"
        actions={
          traceQ.data && traceQ.data.nodes.length > 0 ? (
            <Button variant="outline" size="sm" onClick={exportRecallCsv}>
              <Download className="mr-1.5 h-4 w-4" />
              Recall list CSV
            </Button>
          ) : undefined
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQueryTerm(input);
        }}
        className="mb-6 flex max-w-lg items-center gap-2"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter Lot # or Serial # (e.g. LOT-00003-1)"
          className="rounded-md"
        />
        <Button type="submit">
          <Search className="mr-1.5 h-4 w-4" />
          Trace
        </Button>
      </form>

      {traceQ.isLoading && <p className="text-muted-foreground">Tracing…</p>}

      {traceQ.data && !traceQ.data.kind && (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          No lot or serial matched &ldquo;{traceQ.data.label}&rdquo;.
        </div>
      )}

      {traceQ.data?.kind && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="secondary">{traceQ.data.kind.toUpperCase()}</Badge>
              <span className="text-base font-medium">{traceQ.data.label}</span>
              {traceQ.data.item && (
                <span className="text-sm text-muted-foreground">
                  {traceQ.data.item.sku} — {traceQ.data.item.name}
                </span>
              )}
              {traceQ.data.expiry && (
                <span className="text-sm text-muted-foreground">Expires: {fmtDate(traceQ.data.expiry)}</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section className="rounded-lg border bg-card p-4">
              <h2 className="section-label mb-3">Upstream (Receipts, Builds, Adjustments)</h2>
              {upstream.length === 0 ? (
                <p className="text-sm text-muted-foreground">No upstream transactions linked.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {upstream.map((n) => (
                    <li key={n.id} className="flex items-center justify-between rounded-md border bg-surface px-3 py-2">
                      <div>
                        <div className="font-medium">{n.ref_no} · {labelize(n.type)}</div>
                        <div className="text-xs text-muted-foreground">{n.party_name} · {fmtDate(n.txn_date)}</div>
                      </div>
                      <Badge variant="outline">+{num(n.qty, 2)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border bg-card p-4">
              <h2 className="section-label mb-3">Downstream (Sales Orders, Shipments, Invoices)</h2>
              {downstream.length === 0 ? (
                <p className="text-sm text-muted-foreground">No downstream transactions linked.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {downstream.map((n) => (
                    <li key={n.id} className="flex items-center justify-between rounded-md border bg-surface px-3 py-2">
                      <div>
                        <div className="font-medium">{n.ref_no} · {labelize(n.type)}</div>
                        <div className="text-xs text-muted-foreground">{n.party_name} · {fmtDate(n.txn_date)}</div>
                      </div>
                      <Badge variant="secondary">{num(n.qty, 2)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
