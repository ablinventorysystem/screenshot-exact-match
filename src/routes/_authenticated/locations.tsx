import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCompany } from "@/lib/company";
import { num } from "@/lib/format";
import { confirmDiscard, useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type LocationRow = Database["public"]["Tables"]["locations"]["Row"];

interface LocationForm {
  name: string;
  address: string;
  is_default: boolean;
}

export const Route = createFileRoute("/_authenticated/locations")({
  validateSearch: (s: Record<string, unknown>) => ({
    id: typeof s["id"] === "string" ? s["id"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Locations — ABL Inventory" },
      { name: "description", content: "Warehouses and stores in ABL Inventory." },
    ],
  }),
  component: LocationsPage,
});

function LocationsPage() {
  const { id: selectedId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (selectedId) {
    return <LocationDetail locationId={selectedId} onBack={() => void navigate({ search: { id: undefined } })} />;
  }

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase.from("locations").select("*", { count: "exact" }).eq("company_id", companyId);
    if (a.filter !== "all") q = q.eq("archived", a.filter === "archived");
    if (a.search) q = q.or(`name.ilike.%${a.search}%,address.ilike.%${a.search}%`);
    const { data, count, error } = await q
      .order(a.sort.key === "address" ? "address" : "name", { ascending: a.sort.dir === "asc" })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return { rows: data ?? [], total: count ?? 0 };
  };

  const setArchived = (archived: boolean) => async (rows: LocationRow[]) => {
    if (!canWrite) return void toast.error("Read-only users cannot modify locations");
    const { error } = await supabase.from("locations").update({ archived }).in("id", rows.map((r) => r.id));
    if (error) toast.error(error.message);
    else toast.success(`${rows.length} location(s) ${archived ? "archived" : "unarchived"}`);
  };

  const columns: Column<LocationRow>[] = [
    {
      key: "name",
      header: "Location",
      sortable: true,
      cell: (r) => (
        <div className="flex items-center gap-2">
          <button type="button" className="link-ref text-left" onClick={() => void navigate({ search: { id: r.id } })}>
            {r.name}
          </button>
          {r.is_default && <Badge variant="secondary">Default</Badge>}
        </div>
      ),
      csv: (r) => r.name,
    },
    { key: "address", header: "Address", sortable: true, cell: (r) => r.address ?? "—", csv: (r) => r.address ?? "" },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Locations" subtitle="Warehouses and store branches" />
      {companyId && (
        <DataTable<LocationRow>
          id="locations"
          queryKey={["locations", companyId]}
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
            { label: "Open location", onSelect: (rows) => rows[0] && void navigate({ search: { id: rows[0].id } }) },
            { label: "Archive", onSelect: setArchived(true) },
            { label: "Unarchive", onSelect: setArchived(false) },
          ]}
          {...(canWrite ? { onAdd: () => setDrawerOpen(true) } : {})}
        />
      )}
      <LocationCreateDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onCreated={(id) => {
          qc.invalidateQueries({ queryKey: ["locations", companyId] });
          void navigate({ search: { id } });
        }}
      />
    </div>
  );
}

function LocationCreateDrawer({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { companyId } = useCompany();
  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isDirty, isSubmitting } } = useForm<LocationForm>({
    defaultValues: { name: "", address: "", is_default: false },
  });
  useUnsavedWarning(open && isDirty);

  const onSubmit = async (f: LocationForm) => {
    const { data, error } = await supabase
      .from("locations")
      .insert({
        company_id: companyId,
        name: f.name.trim(),
        address: f.address.trim() || null,
        is_default: f.is_default,
      })
      .select("id")
      .single();
    if (error) return void toast.error(error.message);
    toast.success("Location created");
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
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New location</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="lc-name">Location name *</Label>
            <Input id="lc-name" className="mt-1 rounded-md" aria-invalid={!!errors.name} {...register("name", { required: "Name is required" })} />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div>
            <Label htmlFor="lc-addr">Address</Label>
            <Input id="lc-addr" className="mt-1 rounded-md" {...register("address")} />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Switch id="lc-def" checked={!!watch("is_default")} onCheckedChange={(v) => setValue("is_default", v, { shouldDirty: true })} />
            <Label htmlFor="lc-def">Default location</Label>
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
            <Button type="submit" disabled={isSubmitting}>Create location</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function LocationDetail({ locationId, onBack }: { locationId: string; onBack: () => void }) {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();

  const locQ = useQuery({
    queryKey: ["location", locationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("locations").select("*").eq("id", locationId).single();
      if (error) throw error;
      return data;
    },
  });

  const invQ = useQuery({
    queryKey: ["location_inv", locationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("inventory_levels")
        .select("id, qty, item:items(sku, name, uom, decimals_allowed), lot:item_lots(lot_no)")
        .eq("location_id", locationId)
        .gt("qty", 0);
      return data ?? [];
    },
  });

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isDirty, isSubmitting } } = useForm<LocationForm>();
  useUnsavedWarning(isDirty);

  useEffect(() => {
    const l = locQ.data;
    if (!l) return;
    reset({ name: l.name, address: l.address ?? "", is_default: l.is_default });
  }, [locQ.data, reset]);

  const onSave = async (f: LocationForm) => {
    const { error } = await supabase
      .from("locations")
      .update({ name: f.name.trim(), address: f.address.trim() || null, is_default: f.is_default })
      .eq("id", locationId);
    if (error) return void toast.error(error.message);
    toast.success("Location updated");
    qc.invalidateQueries({ queryKey: ["location", locationId] });
    qc.invalidateQueries({ queryKey: ["locations", companyId] });
  };

  if (locQ.isLoading) return <div className="p-6 text-muted-foreground">Loading location…</div>;
  if (!locQ.data) return <div className="p-6 text-destructive">Location not found.</div>;

  return (
    <div className="p-6">
      <div className="mb-3">
        <Button variant="ghost" size="sm" onClick={() => confirmDiscard(isDirty) && onBack()}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to locations
        </Button>
      </div>
      <PageHeader title={locQ.data.name} subtitle={locQ.data.address ?? "Warehouse / Store"} />
      <Tabs defaultValue="general">
        <TabsList className="mb-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="inventory">Inventory at location</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <form onSubmit={handleSubmit(onSave)} className="rounded-lg border bg-card p-5">
            <fieldset disabled={!canWrite} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="ld-name">Name *</Label>
                <Input id="ld-name" className="mt-1 rounded-md" aria-invalid={!!errors.name} {...register("name", { required: "Name is required" })} />
                {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div>
                <Label htmlFor="ld-addr">Address</Label>
                <Input id="ld-addr" className="mt-1 rounded-md" {...register("address")} />
              </div>
              <div className="flex items-center gap-2 md:col-span-2">
                <Switch id="ld-def" checked={!!watch("is_default")} onCheckedChange={(v) => setValue("is_default", v, { shouldDirty: true })} />
                <Label htmlFor="ld-def">Default location</Label>
              </div>
            </fieldset>
            {canWrite && <Button type="submit" className="mt-4" disabled={isSubmitting}>Save changes</Button>}
          </form>
        </TabsContent>
        <TabsContent value="inventory">
          <div className="rounded-lg border bg-card p-5">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">SKU</th>
                  <th className="py-2">Item</th>
                  <th className="py-2">Lot</th>
                  <th className="py-2 text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {(invQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted-foreground">No stock at this location.</td>
                  </tr>
                )}
                {(invQ.data ?? []).map((row) => {
                  const it = row.item as unknown as { sku: string; name: string; uom: string; decimals_allowed: number } | null;
                  const lot = row.lot as unknown as { lot_no: string } | null;
                  return (
                    <tr key={row.id} className="border-b">
                      <td className="py-2 font-medium">{it?.sku ?? "—"}</td>
                      <td className="py-2">{it?.name ?? "—"}</td>
                      <td className="py-2">{lot?.lot_no ?? "—"}</td>
                      <td className="py-2 text-right">{num(row.qty, it?.decimals_allowed ?? 0)} {it?.uom ?? ""}</td>
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
