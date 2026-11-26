import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Send, CheckCheck, FileText, ListChecks, Receipt, Truck, FileCheck2, ShoppingCart, Factory, TrendingUp, TrendingDown, Landmark, Percent, RefreshCw, Settings } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, num, peso } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — ABL Inventory" },
      { name: "description", content: "Sync, sales and tax overview." },
      { property: "og:title", content: "Dashboard — ABL Inventory" },
      { property: "og:description", content: "Sync, sales and tax overview." },
    ],
  }),
  component: Dashboard,
});

type Stats = Record<string, number | string | null>;
type Tone = "teal" | "blue" | "red";
interface Card { label: string; value: (s: Stats) => string; icon: typeof Send; tone: Tone; to: string }

const n = (s: Stats, k: string) => num(Number(s[k] ?? 0));
const p = (s: Stats, k: string) => `₱${peso(s[k] as number)}`;

const SECTIONS: { label: string; cards: Card[] }[] = [
  { label: "Sync", cards: [
    { label: "Date of last sync", value: (s) => (s["last_sync_at"] ? fmtDate(String(s["last_sync_at"])) : "Never"), icon: CalendarClock, tone: "teal", to: "/settings" },
    { label: "Transactions to send", value: (s) => n(s, "to_send"), icon: Send, tone: "blue", to: "/invoices" },
    { label: "Transactions sent", value: (s) => n(s, "sent"), icon: CheckCheck, tone: "teal", to: "/invoices" },
  ] },
  { label: "Sales", cards: [
    { label: "Pending estimates", value: (s) => n(s, "pending_estimates"), icon: FileText, tone: "blue", to: "/estimates" },
    { label: "Open lines on sales orders", value: (s) => n(s, "open_so_lines"), icon: ListChecks, tone: "teal", to: "/sales-orders" },
    { label: "Open sales receipts", value: (s) => n(s, "open_sales_receipts"), icon: Receipt, tone: "blue", to: "/sales-receipts" },
    { label: "Lines ready to ship", value: (s) => n(s, "lines_ready_to_ship"), icon: Truck, tone: "teal", to: "/ready-to-ship" },
    { label: "Lines ready to invoice", value: (s) => n(s, "lines_ready_to_invoice"), icon: FileCheck2, tone: "red", to: "/invoices" },
  ] },
  { label: "Other transactions", cards: [
    { label: "Open purchase orders", value: (s) => n(s, "open_pos"), icon: ShoppingCart, tone: "blue", to: "/purchase-orders" },
    { label: "Open work orders", value: (s) => n(s, "open_wos"), icon: Factory, tone: "teal", to: "/work-orders" },
  ] },
  { label: "Tax", cards: [
    { label: "Output VAT this month", value: (s) => p(s, "output_vat"), icon: TrendingUp, tone: "teal", to: "/invoices" },
    { label: "Input VAT this month", value: (s) => p(s, "input_vat"), icon: TrendingDown, tone: "blue", to: "/bills" },
    { label: "VAT payable", value: (s) => `₱${peso(Number(s["output_vat"] ?? 0) - Number(s["input_vat"] ?? 0))}`, icon: Landmark, tone: "red", to: "/settings/tax" },
    { label: "Total withholding tax", value: (s) => p(s, "ewt_total"), icon: Percent, tone: "blue", to: "/payments" },
  ] },
];

const TONE: Record<Tone, string> = { teal: "bg-teal text-teal-foreground", blue: "bg-primary text-primary-foreground", red: "bg-destructive text-destructive-foreground" };

function Dashboard() {
  const { companyId } = useCompany();
  const q = useQuery({
    queryKey: ["dashboard", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_stats", { _company: companyId });
      if (error) throw error;
      return (data ?? {}) as Stats;
    },
  });

  return (
    <div className="p-6">
      <PageHeader title="Dashboard" actions={<>
        <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} />Refresh dashboard</Button>
        <Button variant="outline" asChild><Link to="/settings"><Settings className="h-4 w-4" />Settings</Link></Button>
      </>} />
      {q.error && <p className="mb-4 text-destructive">Couldn't load the dashboard. Try refreshing.</p>}
      {SECTIONS.map((sec) => (
        <section key={sec.label} className="mb-6">
          <h2 className="section-label mb-2">{sec.label}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {sec.cards.map((c) => (
              <Link key={c.label} to={c.to} className="flex items-center gap-3 rounded-lg border bg-card p-4 transition-bg hover:bg-muted">
                <span className={cn("icon-circle h-10 w-10", TONE[c.tone])}><c.icon className="h-5 w-5" /></span>
                <div className="min-w-0">
                  {q.data ? <div className="truncate text-2xl font-medium">{c.value(q.data)}</div> : <Skeleton className="mb-1 h-6 w-16" />}
                  <div className="text-sm text-muted-foreground">{c.label}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
