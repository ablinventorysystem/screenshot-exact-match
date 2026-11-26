import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, peso } from "@/lib/format";
import { formatTin, isValidTin } from "@/lib/tin";
import { confirmDiscard, useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type VendorRow = Database["public"]["Tables"]["vendors"]["Row"];
type PartyTaxType = Database["public"]["Enums"]["party_tax_type"];

interface VendorForm {
  name: string;
  registered_name: string;
  tin: string;
  registered_address: string;
  tax_type: PartyTaxType;
  default_atc: string;
  contact_name: string;
  email: string;
  phone: string;
  terms: string;
}

export const Route = createFileRoute("/_authenticated/vendors")({
  validateSearch: (s: Record<string, unknown>) => ({
    id: typeof s["id"] === "string" ? s["id"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Vendors — SOS Inventory" },
      { name: "description", content: "Supplier master data and tax profiles." },
    ],
  }),
  component: VendorsPage,
});

const tinRule = (v: string) => !v || isValidTin(v) || "TIN must be 000-000-000-00000";

function VendorsPage() {
  const { id: selectedId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (selectedId) {
    return <VendorDetail vendorId={selectedId} onBack={() => void navigate({ search: { id: undefined } })} />;
  }

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase.from("vendors").select("*", { count: "exact" }).eq("company_id", companyId);
    if (a.filter !== "all") q = q.eq("archived", a.filter === "archived");
    if (a.search) q = q.or(`name.ilike.%${a.search}%,tin.ilike.%${a.search}%,email.ilike.%${a.search}%`);
    const sortMap: Record<string, string> = { name: "name", tin: "tin", tax_type: "tax_type", terms: "terms" };
    const { data, count, error } = await q
      .order(sortMap[a.sort.key] ?? "name", { ascending: a.sort.dir === "asc" })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return { rows: data ?? [], total: count ?? 0 };
  };

  const setArchived = (archived: boolean) => async (rows: VendorRow[]) => {
    if (!canWrite) return void toast.error("Read-only users cannot modify vendors");
    const { error } = await supabase.from("vendors").update({ archived }).in("id", rows.map((r) => r.id));
    if (error) toast.error(error.message);
    else toast.success(`${rows.length} vendor(s) ${archived ? "archived" : "unarchived"}`);
  };

  const columns: Column<VendorRow>[] = [
    {
      key: "name",
      header: "Vendor",
      sortable: true,
      cell: (r) => (
        <button type="button" className="link-ref text-left" onClick={() => void navigate({ search: { id: r.id } })}>
          {r.name}
        </button>
      ),
      csv: (r) => r.name,
    },
    { key: "tin", header: "TIN", sortable: true, cell: (r) => r.tin ?? "—", csv: (r) => r.tin ?? "" },
    { key: "tax_type", header: "Tax type", sortable: true, cell: (r) => labelize(r.tax_type), csv: (r) => r.tax_type },
    { key: "contact", header: "Contact", cell: (r) => r.contact_name ?? "—", csv: (r) => r.contact_name ?? "" },
    { key: "phone", header: "Phone", cell: (r) => r.phone ?? "—", csv: (r) => r.phone ?? "" },
    { key: "terms", header: "Terms", sortable: true, cell: (r) => r.terms ?? "—", csv: (r) => r.terms ?? "" },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Vendors" subtitle="Supplier directory and EWT/ATC defaults" />
      {companyId && (
        <DataTable<VendorRow>
          id="vendors"
          queryKey={["vendors", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "name", dir: "asc" }}
          filters={[
            { value: "active", label: "Active" },
            { value: "archived", label: "Archived" },
            { value: "all", label: "All" },
          ]}
          batchActions={[
            { label: "Archive", onSelect: setArchived(true) },
            { label: "Unarchive", onSelect: setArchived(false) },
          ]}
          rowActions={[
            { label: "Open vendor", onSelect: (rows) => rows[0] && void navigate({ search: { id: rows[0].id } }) },
            { label: "Archive", onSelect: setArchived(true) },
            { label: "Unarchive", onSelect: setArchived(false) },
          ]}
          {...(canWrite ? { onAdd: () => setDrawerOpen(true) } : {})}
        />
      )}
      <VendorCreateDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onCreated={(id) => {
          qc.invalidateQueries({ queryKey: ["vendors", companyId] });
          void navigate({ search: { id } });
        }}
      />
    </div>
  );
}

function VendorCreateDrawer({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { companyId } = useCompany();
  const { register, handleSubmit, reset, setValue, formState: { errors, isDirty, isSubmitting } } = useForm<VendorForm>({
    defaultValues: {
      name: "",
      registered_name: "",
      tin: "",
      registered_address: "",
      tax_type: "vatable",
      default_atc: "WC158",
      contact_name: "",
      email: "",
      phone: "",
      terms: "Net 30",
    },
  });
  useUnsavedWarning(open && isDirty);

  const onSubmit = async (f: VendorForm) => {
    const { data, error } = await supabase
      .from("vendors")
      .insert({
        company_id: companyId,
        name: f.name.trim(),
        registered_name: f.registered_name.trim() || f.name.trim(),
        tin: f.tin.trim() || null,
        registered_address: f.registered_address.trim() || null,
        tax_type: f.tax_type,
        default_atc: f.default_atc.trim() || null,
        contact_name: f.contact_name.trim() || null,
        email: f.email.trim() || null,
        phone: f.phone.trim() || null,
        terms: f.terms.trim() || null,
      })
      .select("id")
      .single();
    if (error) return void toast.error(error.message);
    toast.success("Vendor created");
    reset();
    onOpenChange(false);
    onCreated(data.id);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !confirmDiscard(isDirty)) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>New vendor</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="vc-name">Vendor name *</Label>
            <Input id="vc-name" className="mt-1 rounded-md" aria-invalid={!!errors.name} {...register("name", { required: "Vendor name is required" })} />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="vc-tin">TIN</Label>
              <Input
                id="vc-tin"
                placeholder="000-000-000-00000"
                className="mt-1 rounded-md"
                aria-invalid={!!errors.tin}
                {...register("tin", {
                  validate: tinRule,
                  onChange: (e) => setValue("tin", formatTin(e.target.value), { shouldDirty: true }),
                })}
              />
              {errors.tin && <p className="mt-1 text-xs text-destructive">{errors.tin.message}</p>}
            </div>
            <div>
              <Label htmlFor="vc-tax">Tax type</Label>
              <select id="vc-tax" className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm" {...register("tax_type")}>
                <option value="vatable">VATable</option>
                <option value="vat_exempt">VAT-Exempt</option>
                <option value="zero_rated">Zero-Rated</option>
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="vc-addr">Address</Label>
            <Input id="vc-addr" className="mt-1 rounded-md" {...register("registered_address")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="vc-atc">Default ATC</Label>
              <Input id="vc-atc" className="mt-1 rounded-md" {...register("default_atc")} />
            </div>
            <div>
              <Label htmlFor="vc-terms">Terms</Label>
              <Input id="vc-terms" className="mt-1 rounded-md" {...register("terms")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="vc-email">Email</Label>
              <Input id="vc-email" type="email" className="mt-1 rounded-md" {...register("email")} />
            </div>
            <div>
              <Label htmlFor="vc-phone">Phone</Label>
              <Input id="vc-phone" className="mt-1 rounded-md" {...register("phone")} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!confirmDiscard(isDirty)) return;
                reset();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>Create vendor</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function VendorDetail({ vendorId, onBack }: { vendorId: string; onBack: () => void }) {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();

  const vendQ = useQuery({
    queryKey: ["vendor", vendorId],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select("*").eq("id", vendorId).single();
      if (error) throw error;
      return data;
    },
  });

  const txnsQ = useQuery({
    queryKey: ["vendor_txns", vendorId],
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id, ref_no, type, txn_date, status, total")
        .eq("party_id", vendorId)
        .order("txn_date", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const priceHistQ = useQuery({
    queryKey: ["vendor_price_history", vendorId],
    queryFn: async () => {
      const { data } = await supabase
        .from("transaction_lines")
        .select("id, description, qty, rate, uom, txn:transactions!inner(ref_no, type, txn_date, party_id)")
        .eq("txn.party_id", vendorId)
        .in("txn.type", ["purchase_order", "receipt", "bill"])
        .order("id", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const { register, handleSubmit, reset, setValue, formState: { errors, isDirty, isSubmitting } } = useForm<VendorForm>();
  useUnsavedWarning(isDirty);

  useEffect(() => {
    const v = vendQ.data;
    if (!v) return;
    reset({
      name: v.name,
      registered_name: v.registered_name ?? "",
      tin: v.tin ?? "",
      registered_address: v.registered_address ?? "",
      tax_type: v.tax_type,
      default_atc: v.default_atc ?? "",
      contact_name: v.contact_name ?? "",
      email: v.email ?? "",
      phone: v.phone ?? "",
      terms: v.terms ?? "",
    });
  }, [vendQ.data, reset]);

  const onSave = async (f: VendorForm) => {
    const { error } = await supabase
      .from("vendors")
      .update({
        name: f.name.trim(),
        registered_name: f.registered_name.trim() || null,
        tin: f.tin.trim() || null,
        registered_address: f.registered_address.trim() || null,
        tax_type: f.tax_type,
        default_atc: f.default_atc.trim() || null,
        contact_name: f.contact_name.trim() || null,
        email: f.email.trim() || null,
        phone: f.phone.trim() || null,
        terms: f.terms.trim() || null,
      })
      .eq("id", vendorId);
    if (error) return void toast.error(error.message);
    toast.success("Vendor saved");
    qc.invalidateQueries({ queryKey: ["vendor", vendorId] });
    qc.invalidateQueries({ queryKey: ["vendors", companyId] });
  };

  if (vendQ.isLoading) return <div className="p-6 text-muted-foreground">Loading vendor…</div>;
  if (!vendQ.data) return <div className="p-6 text-destructive">Vendor not found.</div>;

  return (
    <div className="p-6">
      <div className="mb-3">
        <Button variant="ghost" size="sm" onClick={() => confirmDiscard(isDirty) && onBack()}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to vendors
        </Button>
      </div>
      <PageHeader title={vendQ.data.name} subtitle={vendQ.data.tin ? `TIN ${vendQ.data.tin}` : "No TIN on file"} />
      <Tabs defaultValue="general">
        <TabsList className="mb-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="tax">Tax &amp; BIR</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="prices">Price History</TabsTrigger>
        </TabsList>
        <form onSubmit={handleSubmit(onSave)}>
          <TabsContent value="general">
            <div className="rounded-lg border bg-card p-5">
              <fieldset disabled={!canWrite} className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="vd-name">Name *</Label>
                  <Input id="vd-name" className="mt-1 rounded-md" aria-invalid={!!errors.name} {...register("name", { required: "Name is required" })} />
                  {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
                </div>
                <div>
                  <Label htmlFor="vd-contact">Contact</Label>
                  <Input id="vd-contact" className="mt-1 rounded-md" {...register("contact_name")} />
                </div>
                <div>
                  <Label htmlFor="vd-email">Email</Label>
                  <Input id="vd-email" type="email" className="mt-1 rounded-md" {...register("email")} />
                </div>
                <div>
                  <Label htmlFor="vd-phone">Phone</Label>
                  <Input id="vd-phone" className="mt-1 rounded-md" {...register("phone")} />
                </div>
                <div>
                  <Label htmlFor="vd-terms">Terms</Label>
                  <Input id="vd-terms" className="mt-1 rounded-md" {...register("terms")} />
                </div>
              </fieldset>
              {canWrite && <Button type="submit" className="mt-4" disabled={isSubmitting}>Save changes</Button>}
            </div>
          </TabsContent>
          <TabsContent value="tax">
            <div className="rounded-lg border bg-card p-5">
              <fieldset disabled={!canWrite} className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="vd-reg">Registered name</Label>
                  <Input id="vd-reg" className="mt-1 rounded-md" {...register("registered_name")} />
                </div>
                <div>
                  <Label htmlFor="vd-tin">TIN</Label>
                  <Input
                    id="vd-tin"
                    className="mt-1 rounded-md"
                    aria-invalid={!!errors.tin}
                    {...register("tin", {
                      validate: tinRule,
                      onChange: (e) => setValue("tin", formatTin(e.target.value), { shouldDirty: true }),
                    })}
                  />
                  {errors.tin && <p className="mt-1 text-xs text-destructive">{errors.tin.message}</p>}
                </div>
                <div>
                  <Label htmlFor="vd-addr">Registered address</Label>
                  <Input id="vd-addr" className="mt-1 rounded-md" {...register("registered_address")} />
                </div>
                <div>
                  <Label htmlFor="vd-atc">Default ATC</Label>
                  <Input id="vd-atc" className="mt-1 rounded-md" {...register("default_atc")} />
                </div>
              </fieldset>
              {canWrite && <Button type="submit" className="mt-4" disabled={isSubmitting}>Save tax profile</Button>}
            </div>
          </TabsContent>
        </form>
        <TabsContent value="transactions">
          <div className="rounded-lg border bg-card p-5">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Ref #</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Date</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(txnsQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted-foreground">No transactions found.</td>
                  </tr>
                )}
                {(txnsQ.data ?? []).map((t) => (
                  <tr key={t.id} className="border-b">
                    <td className="py-2 font-medium">{t.ref_no}</td>
                    <td className="py-2">{labelize(t.type)}</td>
                    <td className="py-2">{fmtDate(t.txn_date)}</td>
                    <td className="py-2">{labelize(t.status)}</td>
                    <td className="py-2 text-right">₱{peso(t.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="prices">
          <div className="rounded-lg border bg-card p-5">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Date</th>
                  <th className="py-2">Doc Ref #</th>
                  <th className="py-2">Item</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit Cost</th>
                </tr>
              </thead>
              <tbody>
                {(priceHistQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted-foreground">No purchase price history yet.</td>
                  </tr>
                )}
                {(priceHistQ.data ?? []).map((p) => {
                  const t = p.txn as unknown as { ref_no: string; type: string; txn_date: string } | null;
                  return (
                    <tr key={p.id} className="border-b">
                      <td className="py-2">{fmtDate(t?.txn_date)}</td>
                      <td className="py-2 font-medium">{t?.ref_no ?? "—"} ({labelize(t?.type)})</td>
                      <td className="py-2">{p.description ?? "—"}</td>
                      <td className="py-2 text-right">{p.qty} {p.uom ?? ""}</td>
                      <td className="py-2 text-right font-medium">₱{peso(p.rate)}</td>
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
