import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";

interface CalEvent {
  id: string;
  date: string;
  kind: "SO" | "PO" | "WO" | "RNT";
  label: string;
  to: string;
}

const KIND_STYLE: Record<CalEvent["kind"], { badge: string; name: string }> = {
  SO: { badge: "bg-teal text-teal-foreground", name: "Sales Order" },
  PO: { badge: "bg-primary text-primary-foreground", name: "Purchase Order" },
  WO: { badge: "bg-destructive text-destructive-foreground", name: "Work Order" },
  RNT: { badge: "bg-secondary text-secondary-foreground border", name: "Rental Due" },
};

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — SOS Inventory" },
      { name: "description", content: "Month and week view of due dates for sales orders, purchase orders, work orders, and rentals." },
    ],
  }),
  component: CalendarPage,
});

function CalendarPage() {
  const { companyId } = useCompany();
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<"month" | "week">("month");

  const eventsQ = useQuery({
    queryKey: ["calendar_events", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [{ data: txns }, { data: rents }] = await Promise.all([
        supabase
          .from("transactions")
          .select("id, type, ref_no, due_date, txn_date, party_name")
          .eq("company_id", companyId)
          .in("type", ["sales_order", "purchase_order", "work_order"])
          .eq("voided", false)
          .limit(300),
        supabase
          .from("rental_bookings")
          .select("id, ref_no, customer_name, due_in_date")
          .eq("company_id", companyId)
          .neq("status", "cancelled")
          .limit(150),
      ]);

      const out: CalEvent[] = [];
      for (const t of txns ?? []) {
        const dt = t.due_date ?? t.txn_date;
        if (!dt) continue;
        const kind: CalEvent["kind"] = t.type === "sales_order" ? "SO" : t.type === "purchase_order" ? "PO" : "WO";
        const to = t.type === "sales_order" ? "/sales-orders" : t.type === "purchase_order" ? "/purchase-orders" : "/work-orders";
        out.push({ id: t.id, date: dt, kind, label: `${kind}: ${t.ref_no}${t.party_name ? ` (${t.party_name})` : ""}`, to });
      }
      for (const r of rents ?? []) {
        out.push({ id: r.id, date: r.due_in_date, kind: "RNT", label: `RNT: ${r.ref_no} (${r.customer_name})`, to: "/rentals" });
      }
      return out;
    },
  });

  const days = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    if (view === "week") {
      const start = new Date(cursor);
      start.setDate(cursor.getDate() - cursor.getDay());
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
      });
    }
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor, view]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const ev of eventsQ.data ?? []) {
      const arr = map.get(ev.date) ?? [];
      arr.push(ev);
      map.set(ev.date, arr);
    }
    return map;
  }, [eventsQ.data]);

  const shift = (dir: number) => {
    const next = new Date(cursor);
    if (view === "week") next.setDate(cursor.getDate() + dir * 7);
    else next.setMonth(cursor.getMonth() + dir);
    setCursor(next);
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Calendar"
        subtitle="Due dates for sales orders, purchase orders, work orders, and rentals"
        actions={
          <div className="flex items-center gap-2">
            <Button variant={view === "month" ? "default" : "outline"} size="sm" onClick={() => setView("month")}>Month</Button>
            <Button variant={view === "week" ? "default" : "outline"} size="sm" onClick={() => setView("week")}>Week</Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-[160px] text-center font-medium">
            {cursor.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}
          </span>
          <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Next"><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(new Date())}>Today</Button>
        </div>

        {/* Accessible legend with both token colors and text labels */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(Object.entries(KIND_STYLE) as [CalEvent["kind"], { badge: string; name: string }][]).map(([k, v]) => (
            <span key={k} className={`rounded-md px-2 py-0.5 font-medium ${v.badge}`}>
              {k} — {v.name}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-7 overflow-hidden rounded-lg border bg-card">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="border-b border-r bg-surface px-2 py-1.5 text-center text-xs font-medium text-muted-foreground last:border-r-0">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const evs = byDate.get(iso) ?? [];
          const inMonth = d.getMonth() === cursor.getMonth();
          return (
            <div
              key={iso}
              className={`min-h-[104px] border-b border-r p-1.5 text-xs ${inMonth ? "bg-card" : "bg-muted opacity-60"}`}
            >
              <div className="mb-1 font-medium">{d.getDate()}</div>
              <div className="space-y-1">
                {evs.slice(0, 4).map((ev) => (
                  <Link
                    key={ev.id}
                    to={ev.to as never}
                    className={`block truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium ${KIND_STYLE[ev.kind].badge}`}
                    title={ev.label}
                  >
                    {ev.label}
                  </Link>
                ))}
                {evs.length > 4 && <div className="text-[11px] text-muted-foreground">+{evs.length - 4} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
