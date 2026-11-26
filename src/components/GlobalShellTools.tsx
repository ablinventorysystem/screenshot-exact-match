import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, FileText, Package, Search, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface SearchHit {
  id: string;
  kind: "item" | "customer" | "vendor" | "txn";
  label: string;
  sub: string;
  to: string;
  search?: Record<string, string>;
}

export function GlobalSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { companyId } = useCompany();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);

  // Global "/" shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      onOpenChange(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open || !companyId) return;
    const term = q.trim();
    if (!term) {
      setHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const [{ data: items }, { data: custs }, { data: vendors }, { data: txns }] = await Promise.all([
          supabase.from("items").select("id, sku, name, barcode").eq("company_id", companyId).or(`sku.ilike.%${term}%,name.ilike.%${term}%,barcode.ilike.%${term}%`).limit(5),
          supabase.from("customers").select("id, name, tin").eq("company_id", companyId).or(`name.ilike.%${term}%,tin.ilike.%${term}%`).limit(5),
          supabase.from("vendors").select("id, name, tin").eq("company_id", companyId).or(`name.ilike.%${term}%,tin.ilike.%${term}%`).limit(4),
          supabase.from("transactions").select("id, type, ref_no, party_name, txn_date").eq("company_id", companyId).or(`ref_no.ilike.%${term}%,party_name.ilike.%${term}%`).limit(6),
        ]);

        const out: SearchHit[] = [];
        for (const it of items ?? []) {
          out.push({ id: `i-${it.id}`, kind: "item", label: `${it.sku} — ${it.name}`, sub: it.barcode ? `Barcode: ${it.barcode}` : "Item", to: "/items", search: { id: it.id } });
        }
        for (const c of custs ?? []) {
          out.push({ id: `c-${c.id}`, kind: "customer", label: c.name, sub: c.tin ? `Customer · TIN ${c.tin}` : "Customer", to: "/customers", search: { id: c.id } });
        }
        for (const v of vendors ?? []) {
          out.push({ id: `v-${v.id}`, kind: "vendor", label: v.name, sub: v.tin ? `Vendor · TIN ${v.tin}` : "Vendor", to: "/vendors", search: { id: v.id } });
        }
        const typeRoute: Record<string, string> = {
          sales_order: "/sales-orders",
          invoice: "/invoices",
          purchase_order: "/purchase-orders",
          bill: "/bills",
          receipt: "/receipts",
          shipment: "/shipments",
          estimate: "/estimates",
          rma: "/rmas",
          transfer: "/transfers",
          work_order: "/work-orders",
        };
        for (const t of txns ?? []) {
          out.push({
            id: `t-${t.id}`,
            kind: "txn",
            label: `${t.ref_no} · ${t.party_name ?? "Internal"}`,
            sub: `${t.type.replace("_", " ")} · ${fmtDate(t.txn_date)}`,
            to: typeRoute[t.type] ?? "/dashboard",
            search: { id: t.id },
          });
        }
        setHits(out);
      } finally {
        setBusy(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [q, open, companyId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-lg p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4 text-teal" />
            <span>Global Search</span>
            <kbd className="ml-auto rounded-md border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">/</kbd>
          </DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search ref #, item SKU/name, customer, vendor, or TIN…"
          aria-label="Global search query"
          className="rounded-md"
        />
        <div className="max-h-72 overflow-y-auto">
          {busy && <p className="py-4 text-center text-xs text-muted-foreground">Searching…</p>}
          {!busy && q.trim() && hits.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No matches found</p>
          )}
          <ul className="space-y-1">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    setQ("");
                    void navigate({ to: h.to as never, search: h.search as never });
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-bg hover:bg-muted"
                >
                  {h.kind === "item" && <Package className="h-4 w-4 shrink-0 text-teal" />}
                  {(h.kind === "customer" || h.kind === "vendor") && <Users className="h-4 w-4 shrink-0 text-primary" />}
                  {h.kind === "txn" && <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{h.label}</div>
                    <div className="truncate text-xs text-muted-foreground">{h.sub}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NotificationsPopover({ iconBtnClass }: { iconBtnClass: string }) {
  const { companyId } = useCompany();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const notifQ = useQuery({
    queryKey: ["notifications", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [{ data: rows }, { count: lowCount }, { count: unsentCount }] = await Promise.all([
        supabase.from("notifications").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(15),
        supabase.from("items").select("id", { count: "exact", head: true }).eq("company_id", companyId).not("reorder_point", "is", null),
        supabase.from("transactions").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("qb_sync_status", "pending").eq("voided", false),
      ]);
      return { rows: rows ?? [], lowCount: lowCount ?? 0, unsentCount: unsentCount ?? 0 };
    },
  });

  const unread = (notifQ.data?.rows ?? []).filter((r) => !r.read).length + ((notifQ.data?.unsentCount ?? 0) > 0 ? 1 : 0);

  const markAllRead = async () => {
    if (!companyId) return;
    await supabase.from("notifications").update({ read: true }).eq("company_id", companyId).eq("read", false);
    qc.invalidateQueries({ queryKey: ["notifications", companyId] });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={`${iconBtnClass} relative`} aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 rounded-lg bg-destructive px-1.5 text-[10px] leading-4 text-destructive-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-lg p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void markAllRead()}>
            <CheckCheck className="mr-1 h-3.5 w-3.5" />
            Mark read
          </Button>
        </div>
        <div className="max-h-72 divide-y overflow-y-auto text-sm">
          {(notifQ.data?.unsentCount ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => void navigate({ to: "/settings/quickbooks" as never })}
              className="block w-full px-3 py-2.5 text-left transition-bg hover:bg-muted"
            >
              <div className="font-medium text-primary">{notifQ.data?.unsentCount} transaction(s) unsent to QuickBooks</div>
              <div className="text-xs text-muted-foreground">Click to review &amp; sync in QuickBooks Online settings</div>
            </button>
          )}
          {(notifQ.data?.rows ?? []).length === 0 && (notifQ.data?.unsentCount ?? 0) === 0 && (
            <p className="p-4 text-center text-xs text-muted-foreground">All caught up.</p>
          )}
          {(notifQ.data?.rows ?? []).map((n) => (
            <div key={n.id} className={`px-3 py-2 ${n.read ? "opacity-70" : "bg-accent"}`}>
              <div className="font-medium">{n.title}</div>
              {n.body && <div className="text-xs text-muted-foreground">{n.body}</div>}
              <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtDate(n.created_at)}</div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
