import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { companiesQueryKey, useCompany } from "@/lib/company";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/settings/quickbooks")({
  head: () => ({
    meta: [
      { title: "QuickBooks Online — SOS Inventory" },
      { name: "description", content: "Simulated QuickBooks Online connection, manual sync, and sync log." },
    ],
  }),
  component: QuickBooksPage,
});

function QuickBooksPage() {
  const { company, companyId, userId, canManageTax } = useCompany();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const pendingQ = useQuery({
    queryKey: ["qb_pending_count", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { count } = await supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("qb_sync_status", "pending")
        .eq("voided", false);
      return count ?? 0;
    },
  });

  const logsQ = useQuery({
    queryKey: ["qb_sync_logs", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase
        .from("qb_sync_logs")
        .select("*")
        .eq("company_id", companyId)
        .order("synced_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const toggleConnect = async () => {
    if (!company) return;
    const next = !company.qb_connected;
    const { error } = await supabase
      .from("companies")
      .update({ qb_connected: next, qb_realm_id: next ? "913035000123456" : null })
      .eq("id", companyId);
    if (error) return void toast.error(error.message);
    toast.success(next ? "QuickBooks Online connected (simulated)" : "Disconnected");
    qc.invalidateQueries({ queryKey: companiesQueryKey(userId) });
  };

  const syncNow = async () => {
    if (!company?.qb_connected) {
      await supabase.from("qb_sync_logs").insert({
        company_id: companyId,
        txn_count: 0,
        status: "error",
        error_message: "QuickBooks Online is not connected. Connect your company first.",
      });
      qc.invalidateQueries({ queryKey: ["qb_sync_logs", companyId] });
      return void toast.error("Connect QuickBooks Online first");
    }
    setBusy(true);
    try {
      const { data: pending } = await supabase
        .from("transactions")
        .select("id")
        .eq("company_id", companyId)
        .eq("qb_sync_status", "pending")
        .eq("voided", false);
      const ids = (pending ?? []).map((p) => p.id);
      if (ids.length > 0) {
        await supabase.from("transactions").update({ qb_sync_status: "synced" }).in("id", ids);
      }
      await supabase.from("companies").update({ last_sync_at: new Date().toISOString() }).eq("id", companyId);
      await supabase.from("qb_sync_logs").insert({
        company_id: companyId,
        txn_count: ids.length,
        status: "success",
      });

      toast.success(`Synced ${ids.length} transaction(s) to QuickBooks`);
      qc.invalidateQueries({ queryKey: ["qb_pending_count", companyId] });
      qc.invalidateQueries({ queryKey: ["qb_sync_logs", companyId] });
      qc.invalidateQueries({ queryKey: ["dashboard", companyId] });
      qc.invalidateQueries({ queryKey: companiesQueryKey(userId) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6">
      <PageHeader title="QuickBooks Online" subtitle="Simulated accounting sync, transaction queue, and sync history" />
      <div className="max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-medium">Connection Status:</span>
              <Badge variant={company?.qb_connected ? "secondary" : "outline"}>
                {company?.qb_connected ? `Connected (Realm ${company.qb_realm_id ?? "Demo"})` : "Not connected"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Last sync: {company?.last_sync_at ? fmtDate(company.last_sync_at) : "Never"} · Transactions pending: {pendingQ.data ?? 0}
            </p>
          </div>
          {canManageTax && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void toggleConnect()}>
                {company?.qb_connected ? "Disconnect" : "Connect QuickBooks"}
              </Button>
              <Button disabled={busy} onClick={() => void syncNow()}>
                <RefreshCw className={`mr-1.5 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
                Sync now
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card p-5">
          <h2 className="section-label mb-3">Sync Log</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2">Timestamp</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Synced Count</th>
                <th className="py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {(logsQ.data ?? []).length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No sync runs yet.</td></tr>
              )}
              {(logsQ.data ?? []).map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="py-2">{new Date(l.synced_at).toLocaleString("en-PH")}</td>
                  <td className="py-2">
                    <Badge variant={l.status === "error" ? "destructive" : "secondary"}>{l.status}</Badge>
                  </td>
                  <td className="py-2 text-right">{l.txn_count}</td>
                  <td className={`py-2 ${l.status === "error" ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                    {l.error_message ?? "Completed cleanly"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
