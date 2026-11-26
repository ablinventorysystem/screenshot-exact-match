import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, num, peso, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface RentalRow {
  id: string;
  ref_no: string;
  customer_name: string;
  item_name: string;
  qty: number;
  daily_rate: number;
  out_date: string;
  due_in_date: string;
  returned_date: string | null;
  status: string;
  total_amount: number;
}

export const Route = createFileRoute("/_authenticated/rentals")({
  head: () => ({
    meta: [
      { title: "Rentals — ABL Inventory" },
      { name: "description", content: "Rental equipment bookings, daily rates, availability, and return check-in." },
    ],
  }),
  component: RentalsPage,
});

function RentalsPage() {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("rental_bookings")
      .select("*, item:items(sku, name)", { count: "exact" })
      .eq("company_id", companyId);
    if (a.filter !== "all") q = q.eq("status", a.filter);
    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,customer_name.ilike.%${a.search}%`);
    const { data, count, error } = await q
      .order("out_date", { ascending: false })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return {
      total: count ?? 0,
      rows: (data ?? []).map((r) => {
        const it = r.item as unknown as { sku: string; name: string } | null;
        return {
          id: r.id,
          ref_no: r.ref_no,
          customer_name: r.customer_name,
          item_name: it ? `${it.sku} — ${it.name}` : "—",
          qty: Number(r.qty),
          daily_rate: Number(r.daily_rate),
          out_date: r.out_date,
          due_in_date: r.due_in_date,
          returned_date: r.returned_date,
          status: r.status,
          total_amount: Number(r.total_amount),
        };
      }) as RentalRow[],
    };
  };

  const checkIn = async (rows: RentalRow[]) => {
    if (!canWrite) return;
    const { error } = await supabase
      .from("rental_bookings")
      .update({ status: "returned", returned_date: todayISO() })
      .in("id", rows.map((r) => r.id));
    if (error) toast.error(error.message);
    else toast.success("Rental checked in");
  };

  const columns: Column<RentalRow>[] = [
    { key: "ref", header: "Ref #", sortable: true, cell: (r) => r.ref_no, csv: (r) => r.ref_no },
    { key: "customer", header: "Customer", cell: (r) => r.customer_name, csv: (r) => r.customer_name },
    { key: "item", header: "Rental Item", cell: (r) => r.item_name, csv: (r) => r.item_name },
    { key: "qty", header: "Qty", cell: (r) => num(r.qty, 0), csv: (r) => String(r.qty) },
    { key: "out", header: "Out Date", cell: (r) => fmtDate(r.out_date), csv: (r) => fmtDate(r.out_date) },
    { key: "due", header: "Due In", cell: (r) => fmtDate(r.due_in_date), csv: (r) => fmtDate(r.due_in_date) },
    { key: "rate", header: "Daily Rate", cell: (r) => `₱${peso(r.daily_rate)}`, csv: (r) => String(r.daily_rate) },
    { key: "tot", header: "Total", cell: (r) => `₱${peso(r.total_amount)}`, csv: (r) => String(r.total_amount) },
    {
      key: "status",
      header: "Status",
      cell: (r) => <Badge variant={r.status === "returned" ? "secondary" : r.status === "out" ? "default" : "outline"}>{labelize(r.status)}</Badge>,
      csv: (r) => r.status,
    },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Rentals" subtitle="Equipment rentals, out/in dates, daily rates, and return check-in" />
      {companyId && (
        <DataTable<RentalRow>
          id="rentals"
          queryKey={["rentals", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "out", dir: "desc" }}
          filters={[
            { value: "all", label: "All" },
            { value: "reserved", label: "Reserved" },
            { value: "out", label: "Out" },
            { value: "returned", label: "Returned" },
          ]}
          rowActions={[
            { label: "Check-in Return", onSelect: checkIn },
          ]}
          {...(canWrite ? { onAdd: () => setOpen(true) } : {})}
        />
      )}
      <CreateRentalDrawer open={open} onOpenChange={setOpen} onCreated={() => qc.invalidateQueries({ queryKey: ["rentals", companyId] })} />
    </div>
  );
}

function CreateRentalDrawer({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { companyId } = useCompany();
  const [customerId, setCustomerId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [dailyRate, setDailyRate] = useState("500");
  const [outDate, setOutDate] = useState(todayISO());
  const [dueInDate, setDueInDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  const custsQ = useQuery({
    queryKey: ["rent_custs", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("id, name").eq("company_id", companyId).eq("archived", false).order("name");
      return data ?? [];
    },
  });

  const itemsQ = useQuery({
    queryKey: ["rent_items", companyId],
    enabled: open && !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("items").select("id, sku, name, price").eq("company_id", companyId).eq("archived", false).limit(400);
      return data ?? [];
    },
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cust = (custsQ.data ?? []).find((c) => c.id === customerId);
    if (!cust || !itemId) return void toast.error("Select customer and item");
    const days = Math.max(1, Math.ceil((new Date(dueInDate).getTime() - new Date(outDate).getTime()) / 86400000) + 1);
    const total = days * (Number(qty) || 1) * (Number(dailyRate) || 0);
    setBusy(true);
    try {
      const { error } = await supabase.from("rental_bookings").insert({
        company_id: companyId,
        ref_no: `RNT-${Date.now().toString().slice(-6)}`,
        item_id: itemId,
        customer_id: cust.id,
        customer_name: cust.name,
        qty: Number(qty) || 1,
        daily_rate: Number(dailyRate) || 0,
        out_date: outDate,
        due_in_date: dueInDate,
        status: "out",
        total_amount: total,
      });
      if (error) throw error;
      toast.success("Rental booking created");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create rental");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New Rental Booking</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="rn-cust">Customer *</Label>
            <select id="rn-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="">Select customer…</option>
              {(custsQ.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="rn-item">Rental Item *</Label>
            <select id="rn-item" value={itemId} onChange={(e) => setItemId(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm">
              <option value="">Select item…</option>
              {(itemsQ.data ?? []).map((it) => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rn-qty">Qty</Label>
              <Input id="rn-qty" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="rn-rate">Daily Rate (₱)</Label>
              <Input id="rn-rate" type="number" step="any" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="rn-out">Out Date</Label>
              <Input id="rn-out" type="date" value={outDate} onChange={(e) => setOutDate(e.target.value)} className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="rn-in">Due In Date</Label>
              <Input id="rn-in" type="date" value={dueInDate} onChange={(e) => setDueInDate(e.target.value)} className="mt-1 rounded-md" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              <CheckCircle className="mr-1.5 h-4 w-4" />
              Check Out Rental
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
