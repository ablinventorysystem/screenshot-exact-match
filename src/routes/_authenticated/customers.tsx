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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];
type PartyTaxType = Database["public"]["Enums"]["party_tax_type"];

interface CustomerForm {
  name: string;
  registered_name: string;
  tin: string;
  branch_code: string;
  registered_address: string;
  business_style: string;
  tax_type: PartyTaxType;
  withholding_agent: boolean;
  default_atc: string;
  sc_pwd_id: string;
  sc_pwd_name: string;
  contact_name: string;
  email: string;
  phone: string;
  terms: string;
  credit_limit: string;
}

export const Route = createFileRoute("/_authenticated/customers")({
  validateSearch: (s: Record<string, unknown>) => ({
    id: typeof s["id"] === "string" ? s["id"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Customers — SOS Inventory" },
      { name: "description", content: "Customer master data and BIR tax profiles." },
    ],
  }),
  component: CustomersPage,
});

const tinRule = (v: string) => !v || isValidTin(v) || "TIN must be 000-000-000-00000";

function CustomersPage() {
  const { id: selectedId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (selectedId) {
    return (
      <CustomerDetail
        customerId={selectedId}
        onBack={() => void navigate({ search: { id: undefined } })}
      />
    );
  }

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase.from("customers").select("*", { count: "exact" }).eq("company_id", companyId);
    if (a.filter !== "all") q = q.eq("archived", a.filter === "archived");
    if (a.search) q = q.or(`name.ilike.%${a.search}%,tin.ilike.%${a.search}%,email.ilike.%${a.search}%`);
    const sortMap: Record<string, string> = { name: "name", tin: "tin", tax_type: "tax_type", terms: "terms" };
    const { data, count, error } = await q
      .order(sortMap[a.sort.key] ?? "name", { ascending: a.sort.dir === "asc" })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return { rows: data ?? [], total: count ?? 0 };
  };

  const setArchived = (archived: boolean) => async (rows: CustomerRow[]) => {
    if (!canWrite) return void toast.error("Read-only users cannot modify customers");
    const { error } = await supabase.from("customers").update({ archived }).in("id", rows.map((r) => r.id));
    if (error) toast.error(error.message);
    else toast.success(`${rows.length} customer(s) ${archived ? "archived" : "unarchived"}`);
  };

  const columns: Column<CustomerRow>[] = [
    {
      key: "name",
      header: "Customer",
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
      <PageHeader title="Customers" subtitle="Customer directory, TIN/ATC profiles, and transaction history" />
      {companyId && (
        <DataTable<CustomerRow>
          id="customers"
          queryKey={["customers", companyId]}
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
            { label: "Open customer", onSelect: (rows) => rows[0] && void navigate({ search: { id: rows[0].id } }) },
            { label: "Archive", onSelect: setArchived(true) },
            { label: "Unarchive", onSelect: setArchived(false) },
          ]}
          {...(canWrite ? { onAdd: () => setDrawerOpen(true) } : {})}
        />
      )}
      <CustomerCreateDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onCreated={(id) => {
          qc.invalidateQueries({ queryKey: ["customers", companyId] });
          void navigate({ search: { id } });
        }}
      />
    </div>
  );
}

function CustomerCreateDrawer({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { companyId } = useCompany();
  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isDirty, isSubmitting } } = useForm<CustomerForm>({
    defaultValues: {
      name: "",
      registered_name: "",
      tin: "",
      branch_code: "00000",
      registered_address: "",
      business_style: "",
      tax_type: "vatable",
      withholding_agent: false,
      default_atc: "",
      sc_pwd_id: "",
      sc_pwd_name: "",
      contact_name: "",
      email: "",
      phone: "",
      terms: "Net 30",
      credit_limit: "",
    },
  });
  useUnsavedWarning(open && isDirty);

  const onSubmit = async (f: CustomerForm) => {
    const { data, error } = await supabase
      .from("customers")
      .insert({
        company_id: companyId,
        name: f.name.trim(),
        registered_name: f.registered_name.trim() || f.name.trim(),
        tin: f.tin.trim() || null,
        branch_code: f.branch_code.trim() || null,
        registered_address: f.registered_address.trim() || null,
        business_style: f.business_style.trim() || null,
        tax_type: f.tax_type,
        withholding_agent: f.withholding_agent,
        default_atc: f.default_atc.trim() || null,
        sc_pwd_id: f.sc_pwd_id.trim() || null,
        sc_pwd_name: f.sc_pwd_name.trim() || null,
        contact_name: f.contact_name.trim() || null,
        email: f.email.trim() || null,
        phone: f.phone.trim() || null,
        terms: f.terms.trim() || null,
        credit_limit: f.credit_limit.trim() === "" ? null : Number(f.credit_limit),
      })
      .select("id")
      .single();
    if (error) return void toast.error(error.message);
    toast.success("Customer created");
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
          <SheetTitle>New customer</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="cc-name">Customer name *</Label>
            <Input id="cc-name" className="mt-1 rounded-md" aria-invalid={!!errors.name} {...register("name", { required: "Customer name is required" })} />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div>
            <Label htmlFor="cc-reg">BIR Registered name</Label>
            <Input id="cc-reg" className="mt-1 rounded-md" {...register("registered_name")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cc-tin">TIN</Label>
              <Input
                id="cc-tin"
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
              <Label htmlFor="cc-tax">Tax type</Label>
              <select id="cc-tax" className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm" {...register("tax_type")}>
                <option value="vatable">VATable</option>
                <option value="vat_exempt">VAT-Exempt</option>
                <option value="zero_rated">Zero-Rated</option>
                <option value="government">Government</option>
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="cc-addr">Registered address</Label>
            <Input id="cc-addr" className="mt-1 rounded-md" {...register("registered_address")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cc-style">Business style</Label>
              <Input id="cc-style" className="mt-1 rounded-md" {...register("business_style")} />
            </div>
            <div>
              <Label htmlFor="cc-terms">Terms</Label>
              <Input id="cc-terms" className="mt-1 rounded-md" {...register("terms")} />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Switch id="cc-wa" checked={!!watch("withholding_agent")} onCheckedChange={(v) => setValue("withholding_agent", v, { shouldDirty: true })} />
            <Label htmlFor="cc-wa">Top Withholding Agent (EWT)</Label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cc-email">Email</Label>
              <Input id="cc-email" type="email" className="mt-1 rounded-md" {...register("email")} />
            </div>
            <div>
              <Label htmlFor="cc-phone">Phone</Label>
              <Input id="cc-phone" className="mt-1 rounded-md" {...register("phone")} />
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
            <Button type="submit" disabled={isSubmitting}>
              Create customer
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function CustomerDetail({ customerId, onBack }: { customerId: string; onBack: () => void }) {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();

  const custQ = useQuery({
    queryKey: ["customer", customerId],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").eq("id", customerId).single();
      if (error) throw error;
      return data;
    },
  });

  const txnsQ = useQuery({
    queryKey: ["customer_txns", customerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id, ref_no, type, txn_date, status, total, amount_due")
        .eq("party_id", customerId)
        .order("txn_date", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isDirty, isSubmitting } } = useForm<CustomerForm>();
  useUnsavedWarning(isDirty);

  useEffect(() => {
    const c = custQ.data;
    if (!c) return;
    reset({
      name: c.name,
      registered_name: c.registered_name ?? "",
      tin: c.tin ?? "",
      branch_code: c.branch_code ?? "00000",
      registered_address: c.registered_address ?? "",
      business_style: c.business_style ?? "",
      tax_type: c.tax_type,
      withholding_agent: c.withholding_agent,
      default_atc: c.default_atc ?? "",
      sc_pwd_id: c.sc_pwd_id ?? "",
      sc_pwd_name: c.sc_pwd_name ?? "",
      contact_name: c.contact_name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      terms: c.terms ?? "",
      credit_limit: c.credit_limit === null ? "" : String(c.credit_limit),
    });
  }, [custQ.data, reset]);

  const onSave = async (f: CustomerForm) => {
    const { error } = await supabase
      .from("customers")
      .update({
        name: f.name.trim(),
        registered_name: f.registered_name.trim() || null,
        tin: f.tin.trim() || null,
        branch_code: f.branch_code.trim() || null,
        registered_address: f.registered_address.trim() || null,
        business_style: f.business_style.trim() || null,
        tax_type: f.tax_type,
        withholding_agent: f.withholding_agent,
        default_atc: f.default_atc.trim() || null,
        sc_pwd_id: f.sc_pwd_id.trim() || null,
        sc_pwd_name: f.sc_pwd_name.trim() || null,
        contact_name: f.contact_name.trim() || null,
        email: f.email.trim() || null,
        phone: f.phone.trim() || null,
        terms: f.terms.trim() || null,
        credit_limit: f.credit_limit.trim() === "" ? null : Number(f.credit_limit),
      })
      .eq("id", customerId);
    if (error) return void toast.error(error.message);
    toast.success("Customer saved");
    qc.invalidateQueries({ queryKey: ["customer", customerId] });
    qc.invalidateQueries({ queryKey: ["customers", companyId] });
  };

  if (custQ.isLoading) return <div className="p-6 text-muted-foreground">Loading customer…</div>;
  if (!custQ.data) return <div className="p-6 text-destructive">Customer not found.</div>;

  return (
    <div className="p-6">
      <div className="mb-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (!confirmDiscard(isDirty)) return;
            onBack();
          }}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to customers
        </Button>
      </div>
      <PageHeader title={custQ.data.name} subtitle={custQ.data.tin ? `TIN ${custQ.data.tin}` : "No TIN on file"} />
      <Tabs defaultValue="general">
        <TabsList className="mb-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="tax">Tax &amp; BIR</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
        </TabsList>
        <form onSubmit={handleSubmit(onSave)}>
          <TabsContent value="general">
            <div className="rounded-lg border bg-card p-5">
              <fieldset disabled={!canWrite} className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="cd-name">Name *</Label>
                  <Input id="cd-name" className="mt-1 rounded-md" aria-invalid={!!errors.name} {...register("name", { required: "Name is required" })} />
                  {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
                </div>
                <div>
                  <Label htmlFor="cd-contact">Contact person</Label>
                  <Input id="cd-contact" className="mt-1 rounded-md" {...register("contact_name")} />
                </div>
                <div>
                  <Label htmlFor="cd-email">Email</Label>
                  <Input id="cd-email" type="email" className="mt-1 rounded-md" {...register("email")} />
                </div>
                <div>
                  <Label htmlFor="cd-phone">Phone</Label>
                  <Input id="cd-phone" className="mt-1 rounded-md" {...register("phone")} />
                </div>
                <div>
                  <Label htmlFor="cd-terms">Terms</Label>
                  <Input id="cd-terms" className="mt-1 rounded-md" {...register("terms")} />
                </div>
                <div>
                  <Label htmlFor="cd-limit">Credit limit (₱)</Label>
                  <Input id="cd-limit" type="number" step="any" className="mt-1 rounded-md" {...register("credit_limit")} />
                </div>
              </fieldset>
              {canWrite && <Button type="submit" className="mt-4" disabled={isSubmitting}>Save changes</Button>}
            </div>
          </TabsContent>

          <TabsContent value="tax">
            <div className="rounded-lg border bg-card p-5">
              <fieldset disabled={!canWrite} className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="cd-reg">BIR Registered name</Label>
                  <Input id="cd-reg" className="mt-1 rounded-md" {...register("registered_name")} />
                </div>
                <div>
                  <Label htmlFor="cd-tin">TIN</Label>
                  <Input
                    id="cd-tin"
                    className="mt-1 rounded-md"
                    placeholder="000-000-000-00000"
                    aria-invalid={!!errors.tin}
                    {...register("tin", {
                      validate: tinRule,
                      onChange: (e) => setValue("tin", formatTin(e.target.value), { shouldDirty: true }),
                    })}
                  />
                  {errors.tin && <p className="mt-1 text-xs text-destructive">{errors.tin.message}</p>}
                </div>
                <div>
                  <Label htmlFor="cd-addr">Registered address</Label>
                  <Input id="cd-addr" className="mt-1 rounded-md" {...register("registered_address")} />
                </div>
                <div>
                  <Label htmlFor="cd-style">Business style</Label>
                  <Input id="cd-style" className="mt-1 rounded-md" {...register("business_style")} />
                </div>
                <div>
                  <Label htmlFor="cd-taxtype">Tax type</Label>
                  <select id="cd-taxtype" className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm" {...register("tax_type")}>
                    <option value="vatable">VATable</option>
                    <option value="vat_exempt">VAT-Exempt</option>
                    <option value="zero_rated">Zero-Rated</option>
                    <option value="government">Government</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="cd-atc">Default ATC</Label>
                  <Input id="cd-atc" className="mt-1 rounded-md" {...register("default_atc")} />
                </div>
                <div>
                  <Label htmlFor="cd-scid">SC/PWD ID No.</Label>
                  <Input id="cd-scid" className="mt-1 rounded-md" {...register("sc_pwd_id")} />
                </div>
                <div>
                  <Label htmlFor="cd-scname">SC/PWD Name</Label>
                  <Input id="cd-scname" className="mt-1 rounded-md" {...register("sc_pwd_name")} />
                </div>
                <div className="flex items-center gap-2 md:col-span-2">
                  <Switch id="cd-wa" checked={!!watch("withholding_agent")} onCheckedChange={(v) => setValue("withholding_agent", v, { shouldDirty: true })} />
                  <Label htmlFor="cd-wa">Top Withholding Agent</Label>
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
      </Tabs>
    </div>
  );
}
