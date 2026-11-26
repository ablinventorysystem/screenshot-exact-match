import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { GitFork } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, num, peso } from "@/lib/format";
import { isExpiringSoon } from "@/lib/inventory";
import { PageHeader } from "@/components/PageHeader";
import { BarcodeScanBar } from "@/components/BarcodeTools";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/lots-serials")({
  head: () => ({
    meta: [
      { title: "Lots/Serials — SOS Inventory" },
      { name: "description", content: "Browse FEFO lots and serialized inventory." },
    ],
  }),
  component: LotsSerialsPage,
});

function LotsSerialsPage() {
  const { companyId } = useCompany();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [serialStatus, setSerialStatus] = useState("all");

  const lotsQ = useQuery({
    queryKey: ["all_lots", companyId, search],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase
        .from("item_lots")
        .select("*, item:items(id, sku, name, uom, decimals_allowed), inv:inventory_levels(qty)")
        .eq("company_id", companyId)
        .order("expiry_date", { ascending: true, nullsFirst: false })
        .limit(200);
      if (search.trim()) q = q.ilike("lot_no", `%${search.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const serialsQ = useQuery({
    queryKey: ["all_serials", companyId, search, serialStatus],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase
        .from("item_serials")
        .select("*, item:items(id, sku, name, price, cost), location:locations(name)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (search.trim()) q = q.ilike("serial_no", `%${search.trim()}%`);
      if (serialStatus !== "all") q = q.eq("status", serialStatus);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="p-6">
      <PageHeader title="Lots / Serials" subtitle="FEFO lot expiry monitor and serial number browser" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-full max-w-md">
          <BarcodeScanBar
            placeholder="Scan or search lot # / serial #…"
            onMatch={(m) => {
              if (m.kind === "lot" || m.kind === "serial") {
                void navigate({ to: "/items", search: { id: m.itemId, tab: "lots" } });
              } else {
                void navigate({ to: "/items", search: { id: m.itemId, tab: undefined } });
              }
            }}
          />
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by lot # or serial #"
          className="h-9 w-64 rounded-md"
        />
      </div>

      <Tabs defaultValue="lots">
        <TabsList className="mb-4">
          <TabsTrigger value="lots">Lots (FEFO)</TabsTrigger>
          <TabsTrigger value="serials">Serials</TabsTrigger>
        </TabsList>

        <TabsContent value="lots">
          <div className="rounded-lg border bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-surface text-left font-medium">
                  <th className="px-3 py-2">Lot #</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Received</th>
                  <th className="px-3 py-2">Expiry</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Trace</th>
                </tr>
              </thead>
              <tbody>
                {lotsQ.isLoading && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading lots…</td></tr>
                )}
                {!lotsQ.isLoading && (lotsQ.data ?? []).length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No lots found.</td></tr>
                )}
                {(lotsQ.data ?? []).map((l, idx) => {
                  const it = l.item as unknown as { id: string; sku: string; name: string; uom: string; decimals_allowed: number } | null;
                  const inv = (l.inv as unknown as { qty: number }[] | null) ?? [];
                  const qty = inv.reduce((s, x) => s + Number(x.qty ?? 0), 0);
                  const soon = isExpiringSoon(l.expiry_date, 30);
                  return (
                    <tr key={l.id} className={idx % 2 === 1 ? "border-b bg-zebra" : "border-b bg-surface"}>
                      <td className="px-3 py-1.5 font-medium">{l.lot_no}</td>
                      <td className="px-3 py-1.5">
                        {it ? (
                          <button
                            type="button"
                            className="link-ref text-left"
                            onClick={() => void navigate({ to: "/items", search: { id: it.id, tab: "lots" } })}
                          >
                            {it.sku} — {it.name}
                          </button>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-1.5">{fmtDate(l.received_date) || "—"}</td>
                      <td className="px-3 py-1.5">{fmtDate(l.expiry_date) || "—"}</td>
                      <td className="px-3 py-1.5 text-right">{num(qty, it?.decimals_allowed ?? 0)} {it?.uom ?? ""}</td>
                      <td className="px-3 py-1.5">
                        {soon ? <Badge variant="destructive">Expiring soon</Badge> : <Badge variant="outline">OK</Badge>}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void navigate({ to: "/trace", search: { q: l.lot_no } })}
                        >
                          <GitFork className="mr-1 h-3.5 w-3.5" />
                          Trace
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="serials">
          <div className="mb-3 flex items-center gap-2">
            <select
              value={serialStatus}
              onChange={(e) => setSerialStatus(e.target.value)}
              className="h-9 rounded-md border bg-surface px-3 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="in_stock">In stock</option>
              <option value="sold">Sold</option>
              <option value="returned">Returned</option>
              <option value="scrapped">Scrapped</option>
            </select>
          </div>
          <div className="rounded-lg border bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-surface text-left font-medium">
                  <th className="px-3 py-2">Serial #</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2 text-right">Unit cost</th>
                  <th className="px-3 py-2 text-right">Trace</th>
                </tr>
              </thead>
              <tbody>
                {serialsQ.isLoading && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading serials…</td></tr>
                )}
                {!serialsQ.isLoading && (serialsQ.data ?? []).length === 0 && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No serials found.</td></tr>
                )}
                {(serialsQ.data ?? []).map((s, idx) => {
                  const it = s.item as unknown as { id: string; sku: string; name: string; cost: number } | null;
                  const loc = s.location as unknown as { name: string } | null;
                  return (
                    <tr key={s.id} className={idx % 2 === 1 ? "border-b bg-zebra" : "border-b bg-surface"}>
                      <td className="px-3 py-1.5 font-medium">{s.serial_no}</td>
                      <td className="px-3 py-1.5">
                        {it ? (
                          <button
                            type="button"
                            className="link-ref text-left"
                            onClick={() => void navigate({ to: "/items", search: { id: it.id, tab: "lots" } })}
                          >
                            {it.sku} — {it.name}
                          </button>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge variant={s.status === "scrapped" ? "destructive" : s.status === "sold" ? "secondary" : "outline"}>
                          {labelize(s.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-1.5">{loc?.name ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right">₱{peso(s.unit_cost || it?.cost || 0)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void navigate({ to: "/trace", search: { q: s.serial_no } })}
                        >
                          <GitFork className="mr-1 h-3.5 w-3.5" />
                          Trace
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
