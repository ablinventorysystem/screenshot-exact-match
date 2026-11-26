import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Plus, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize, num, peso } from "@/lib/format";
import { isExpiringSoon } from "@/lib/inventory";
import { confirmDiscard, useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { BarcodeScanBar, Code128Svg, PrintLabelsDialog, QrCanvas } from "@/components/BarcodeTools";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type ItemRow = Database["public"]["Tables"]["items"]["Row"];
type ItemType = Database["public"]["Enums"]["item_type"];
type TrackingType = Database["public"]["Enums"]["tracking_type"];

interface ListRow extends ItemRow {
  on_hand: number;
  tax_code_name: string;
}

interface ItemForm {
  sku: string;
  name: string;
  description: string;
  category: string;
  type: ItemType;
  tracking: TrackingType;
  uom: string;
  decimals_allowed: number;
  barcode: string;
  reorder_point: string;
  cost: number;
  price: number;
  tax_code_id: string;
  preferred_vendor_id: string;
}

export const Route = createFileRoute("/_authenticated/items")({
  validateSearch: (s: Record<string, unknown>) => ({
    id: typeof s["id"] === "string" ? s["id"] : undefined,
    tab: typeof s["tab"] === "string" ? s["tab"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Items — SOS Inventory" },
      { name: "description", content: "Inventory items, lot/serial tracking, cost history, and barcodes." },
    ],
  }),
  component: ItemsPage,
});

function ItemsPage() {
  const { id: selectedId, tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDetail = (itemId: string, nextTab?: string) => {
    void navigate({ search: { id: itemId, tab: nextTab } });
  };

  const closeDetail = () => {
    void navigate({ search: { id: undefined, tab: undefined } });
  };

  if (selectedId) {
    return <ItemDetailView itemId={selectedId} initialTab={tab} onBack={closeDetail} />;
  }

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("items")
      .select("*, tax_code:tax_codes(code, name), inventory_levels(qty)", { count: "exact" })
      .eq("company_id", companyId);

    if (a.filter === "archived") q = q.eq("archived", true);
    else if (a.filter !== "all") q = q.eq("archived", false);

    if (a.search) {
      q = q.or(`sku.ilike.%${a.search}%,name.ilike.%${a.search}%,barcode.ilike.%${a.search}%,category.ilike.%${a.search}%`);
    }

    const sortMap: Record<string, string> = {
      sku: "sku",
      name: "name",
      category: "category",
      type: "type",
      price: "price",
      cost: "cost",
    };
    const { data, count, error } = await q
      .order(sortMap[a.sort.key] ?? "sku", { ascending: a.sort.dir === "asc" })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;

    let mapped: ListRow[] = (data ?? []).map((d) => {
      const levels = (d.inventory_levels as unknown as { qty: number }[] | null) ?? [];
      const onHand = levels.reduce((sum, l) => sum + Number(l.qty ?? 0), 0);
      const tc = d.tax_code as unknown as { code: string; name: string } | null;
      return {
        ...d,
        on_hand: onHand,
        tax_code_name: tc ? tc.code : "",
      };
    });

    if (a.filter === "low_stock") {
      mapped = mapped.filter((r) => r.reorder_point !== null && r.on_hand <= Number(r.reorder_point));
    }

    return {
      rows: mapped,
      total: a.filter === "low_stock" ? mapped.length : (count ?? 0),
    };
  };

  const setArchived = (archived: boolean) => async (rows: ListRow[]) => {
    if (!canWrite) return void toast.error("Read-only users cannot modify items");
    const { error } = await supabase
      .from("items")
      .update({ archived })
      .in("id", rows.map((r) => r.id));
    if (error) toast.error(error.message);
    else toast.success(`${rows.length} item(s) ${archived ? "archived" : "unarchived"}`);
  };

  const columns: Column<ListRow>[] = [
    {
      key: "sku",
      header: "SKU",
      sortable: true,
      cell: (r) => (
        <button type="button" className="link-ref text-left" onClick={() => openDetail(r.id)}>
          {r.sku}
        </button>
      ),
      csv: (r) => r.sku,
    },
    {
      key: "name",
      header: "Name",
      sortable: true,
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          <span className="truncate">{r.name}</span>
          {r.reorder_point !== null && r.on_hand <= Number(r.reorder_point) && (
            <Badge variant="destructive" className="shrink-0 text-[10px]">
              Low stock
            </Badge>
          )}
        </div>
      ),
      csv: (r) => r.name,
    },
    { key: "category", header: "Category", sortable: true, cell: (r) => r.category ?? "—", csv: (r) => r.category ?? "" },
    { key: "type", header: "Type", sortable: true, cell: (r) => labelize(r.type), csv: (r) => r.type },
    { key: "tracking", header: "Tracking", cell: (r) => labelize(r.tracking), csv: (r) => r.tracking },
    {
      key: "on_hand",
      header: "On hand",
      cell: (r) => `${num(r.on_hand, r.decimals_allowed)} ${r.uom}`,
      csv: (r) => String(r.on_hand),
    },
    { key: "cost", header: "Cost", sortable: true, cell: (r) => `₱${peso(r.cost)}`, csv: (r) => String(r.cost) },
    { key: "price", header: "Price", sortable: true, cell: (r) => `₱${peso(r.price)}`, csv: (r) => String(r.price) },
    { key: "tax", header: "Tax", cell: (r) => r.tax_code_name || "—", csv: (r) => r.tax_code_name },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Items" subtitle="Master catalog, lot/serial tracking, cost history, and barcodes" />
      <div className="mb-3 max-w-xl">
        <BarcodeScanBar
          onMatch={(m) => {
            if (m.kind === "serial") openDetail(m.itemId, "lots");
            else if (m.kind === "lot") openDetail(m.itemId, "lots");
            else openDetail(m.itemId);
          }}
        />
      </div>
      {companyId && (
        <DataTable<ListRow>
          id="items"
          queryKey={["items", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "sku", dir: "asc" }}
          filters={[
            { value: "active", label: "Active" },
            { value: "low_stock", label: "Low stock (below reorder point)" },
            { value: "archived", label: "Archived" },
            { value: "all", label: "All" },
          ]}
          batchActions={[
            { label: "Archive", onSelect: setArchived(true) },
            { label: "Unarchive", onSelect: setArchived(false) },
          ]}
          rowActions={[
            { label: "Open item", onSelect: (rows) => rows[0] && openDetail(rows[0].id) },
            { label: "Archive", onSelect: setArchived(true) },
            { label: "Unarchive", onSelect: setArchived(false) },
          ]}
          {...(canWrite ? { onAdd: () => setDrawerOpen(true) } : {})}
        />
      )}
      <ItemCreateDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onCreated={(newId) => {
          qc.invalidateQueries({ queryKey: ["items", companyId] });
          openDetail(newId);
        }}
      />
    </div>
  );
}

function ItemCreateDrawer({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { companyId } = useCompany();
  const { register, handleSubmit, reset, formState: { errors, isDirty, isSubmitting } } = useForm<ItemForm>({
    defaultValues: {
      sku: "",
      name: "",
      description: "",
      category: "",
      type: "inventory",
      tracking: "none",
      uom: "pc",
      decimals_allowed: 0,
      barcode: "",
      reorder_point: "",
      cost: 0,
      price: 0,
      tax_code_id: "",
      preferred_vendor_id: "",
    },
  });
  useUnsavedWarning(open && isDirty);

  const taxQ = useQuery({
    queryKey: ["tax_codes", companyId],
    enabled: !!companyId && open,
    queryFn: async () => {
      const { data } = await supabase.from("tax_codes").select("id, code, name").eq("company_id", companyId).eq("archived", false);
      return data ?? [];
    },
  });

  const vendorQ = useQuery({
    queryKey: ["vendors_min", companyId],
    enabled: !!companyId && open,
    queryFn: async () => {
      const { data } = await supabase.from("vendors").select("id, name").eq("company_id", companyId).eq("archived", false).order("name");
      return data ?? [];
    },
  });

  const onSubmit = async (f: ItemForm) => {
    const { data, error } = await supabase
      .from("items")
      .insert({
        company_id: companyId,
        sku: f.sku.trim(),
        name: f.name.trim(),
        description: f.description.trim() || null,
        category: f.category.trim() || null,
        type: f.type,
        tracking: f.tracking,
        uom: f.uom.trim() || "pc",
        decimals_allowed: Math.max(0, Math.min(6, Number(f.decimals_allowed) || 0)),
        barcode: f.barcode.trim() || null,
        reorder_point: f.reorder_point.trim() === "" ? null : Number(f.reorder_point),
        cost: Number(f.cost) || 0,
        price: Number(f.price) || 0,
        tax_code_id: f.tax_code_id || null,
        preferred_vendor_id: f.preferred_vendor_id || null,
      })
      .select("id")
      .single();

    if (error) return void toast.error(error.message);
    toast.success("Item created");
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
          <SheetTitle>New item</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-sku">SKU *</Label>
              <Input id="c-sku" className="mt-1 rounded-md" aria-invalid={!!errors.sku} {...register("sku", { required: "SKU is required" })} />
              {errors.sku && <p className="mt-1 text-xs text-destructive">{errors.sku.message}</p>}
            </div>
            <div>
              <Label htmlFor="c-uom">UOM</Label>
              <Input id="c-uom" className="mt-1 rounded-md" {...register("uom")} />
            </div>
          </div>
          <div>
            <Label htmlFor="c-name">Name *</Label>
            <Input id="c-name" className="mt-1 rounded-md" aria-invalid={!!errors.name} {...register("name", { required: "Name is required" })} />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-type">Type</Label>
              <select id="c-type" className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm" {...register("type")}>
                <option value="inventory">Inventory</option>
                <option value="non_inventory">Non-inventory</option>
                <option value="assembly">Assembly</option>
                <option value="service">Service</option>
              </select>
            </div>
            <div>
              <Label htmlFor="c-tracking">Tracking</Label>
              <select id="c-tracking" className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm" {...register("tracking")}>
                <option value="none">None</option>
                <option value="lot">Lot</option>
                <option value="serial">Serial</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="c-dec">Decimals (0–6)</Label>
              <Input
                id="c-dec"
                type="number"
                min={0}
                max={6}
                className="mt-1 rounded-md"
                {...register("decimals_allowed", { min: { value: 0, message: "0–6" }, max: { value: 6, message: "0–6" } })}
              />
            </div>
            <div>
              <Label htmlFor="c-cost">Cost (₱)</Label>
              <Input id="c-cost" type="number" step="any" className="mt-1 rounded-md" {...register("cost")} />
            </div>
            <div>
              <Label htmlFor="c-price">Price (₱)</Label>
              <Input id="c-price" type="number" step="any" className="mt-1 rounded-md" {...register("price")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-barcode">Barcode</Label>
              <Input id="c-barcode" className="mt-1 rounded-md" {...register("barcode")} />
            </div>
            <div>
              <Label htmlFor="c-reorder">Reorder point</Label>
              <Input id="c-reorder" type="number" step="any" className="mt-1 rounded-md" {...register("reorder_point")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-tax">Tax code</Label>
              <select id="c-tax" className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm" {...register("tax_code_id")}>
                <option value="">None</option>
                {(taxQ.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="c-vendor">Preferred vendor</Label>
              <select id="c-vendor" className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm" {...register("preferred_vendor_id")}>
                <option value="">None</option>
                {(vendorQ.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="c-cat">Category</Label>
            <Input id="c-cat" className="mt-1 rounded-md" {...register("category")} />
          </div>
          <div>
            <Label htmlFor="c-desc">Description</Label>
            <Textarea id="c-desc" className="mt-1 rounded-md" rows={2} {...register("description")} />
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
              Create item
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ItemDetailView({
  itemId,
  initialTab,
  onBack,
}: {
  itemId: string;
  initialTab?: string | undefined;
  onBack: () => void;
}) {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(initialTab || "general");
  const [printOpen, setPrintOpen] = useState(false);

  const itemQ = useQuery({
    queryKey: ["item", itemId],
    queryFn: async () => {
      const { data, error } = await supabase.from("items").select("*").eq("id", itemId).single();
      if (error) throw error;
      return data;
    },
  });

  const taxQ = useQuery({
    queryKey: ["tax_codes", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("tax_codes").select("id, code, name").eq("company_id", companyId).eq("archived", false);
      return data ?? [];
    },
  });

  const vendorQ = useQuery({
    queryKey: ["vendors_min", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("vendors").select("id, name").eq("company_id", companyId).eq("archived", false).order("name");
      return data ?? [];
    },
  });

  const invQ = useQuery({
    queryKey: ["item_inv", itemId],
    queryFn: async () => {
      const { data } = await supabase
        .from("inventory_levels")
        .select("id, qty, location:locations(id, name), lot:item_lots(id, lot_no, expiry_date)")
        .eq("item_id", itemId);
      return data ?? [];
    },
  });

  const lotsQ = useQuery({
    queryKey: ["item_lots", itemId],
    queryFn: async () => {
      const { data } = await supabase
        .from("item_lots")
        .select("*")
        .eq("item_id", itemId)
        .order("expiry_date", { ascending: true, nullsFirst: false });
      return data ?? [];
    },
  });

  const serialsQ = useQuery({
    queryKey: ["item_serials", itemId],
    queryFn: async () => {
      const { data } = await supabase
        .from("item_serials")
        .select("*, location:locations(name)")
        .eq("item_id", itemId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const costQ = useQuery({
    queryKey: ["item_cost_history", itemId],
    queryFn: async () => {
      const { data } = await supabase
        .from("item_cost_history")
        .select("*, serial:item_serials(serial_no)")
        .eq("item_id", itemId)
        .order("txn_date", { ascending: false })
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const txnsQ = useQuery({
    queryKey: ["item_txns", itemId],
    queryFn: async () => {
      const { data } = await supabase
        .from("transaction_lines")
        .select("id, qty, rate, amount, serial_id, lot_id, txn:transactions(id, ref_no, type, txn_date, status, party_name)")
        .eq("item_id", itemId)
        .limit(100);
      return data ?? [];
    },
  });

  const bomQ = useQuery({
    queryKey: ["item_bom", itemId],
    queryFn: async () => {
      const { data } = await supabase
        .from("item_bom_lines")
        .select("*, comp:items!item_bom_lines_component_item_id_fkey(sku, name, uom)")
        .eq("assembly_item_id", itemId)
        .order("created_at");
      return data ?? [];
    },
  });

  const allItemsQ = useQuery({
    queryKey: ["items_min", companyId],
    enabled: !!companyId && itemQ.data?.type === "assembly",
    queryFn: async () => {
      const { data } = await supabase.from("items").select("id, sku, name, uom").eq("company_id", companyId).neq("id", itemId).order("sku").limit(300);
      return data ?? [];
    },
  });

  const { register, handleSubmit, reset, formState: { errors, isDirty, isSubmitting } } = useForm<ItemForm>();
  useUnsavedWarning(isDirty);

  useEffect(() => {
    const it = itemQ.data;
    if (!it) return;
    reset({
      sku: it.sku,
      name: it.name,
      description: it.description ?? "",
      category: it.category ?? "",
      type: it.type,
      tracking: it.tracking,
      uom: it.uom,
      decimals_allowed: it.decimals_allowed,
      barcode: it.barcode ?? "",
      reorder_point: it.reorder_point === null ? "" : String(it.reorder_point),
      cost: Number(it.cost),
      price: Number(it.price),
      tax_code_id: it.tax_code_id ?? "",
      preferred_vendor_id: it.preferred_vendor_id ?? "",
    });
  }, [itemQ.data, reset]);

  const onSave = async (f: ItemForm) => {
    const { error } = await supabase
      .from("items")
      .update({
        sku: f.sku.trim(),
        name: f.name.trim(),
        description: f.description.trim() || null,
        category: f.category.trim() || null,
        type: f.type,
        tracking: f.tracking,
        uom: f.uom.trim() || "pc",
        decimals_allowed: Math.max(0, Math.min(6, Number(f.decimals_allowed) || 0)),
        barcode: f.barcode.trim() || null,
        reorder_point: f.reorder_point.trim() === "" ? null : Number(f.reorder_point),
        cost: Number(f.cost) || 0,
        price: Number(f.price) || 0,
        tax_code_id: f.tax_code_id || null,
        preferred_vendor_id: f.preferred_vendor_id || null,
      })
      .eq("id", itemId);
    if (error) return void toast.error(error.message);
    toast.success("Item updated");
    qc.invalidateQueries({ queryKey: ["item", itemId] });
    qc.invalidateQueries({ queryKey: ["items", companyId] });
  };

  // Add lot/serial quick state
  const [newLotNo, setNewLotNo] = useState("");
  const [newLotExp, setNewLotExp] = useState("");
  const [newSerialNo, setNewSerialNo] = useState("");
  const [newSerialCost, setNewSerialCost] = useState("");
  const [bomCompId, setBomCompId] = useState("");
  const [bomRole, setBomRole] = useState<"component" | "co_product" | "by_product">("component");
  const [bomQty, setBomQty] = useState("1");

  const it = itemQ.data;
  const totalOnHand = (invQ.data ?? []).reduce((s, r) => s + Number(r.qty ?? 0), 0);
  const lowStock = it?.reorder_point !== null && it?.reorder_point !== undefined && totalOnHand <= Number(it.reorder_point);

  if (itemQ.isLoading) return <div className="p-6 text-muted-foreground">Loading item…</div>;
  if (!it) return <div className="p-6 text-destructive">Item not found.</div>;

  const barcodeValue = it.barcode || it.sku;

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
          Back to items
        </Button>
      </div>
      <PageHeader
        title={it.name}
        subtitle={`${it.sku} · ${labelize(it.type)} · Tracking: ${labelize(it.tracking)} · On hand: ${num(totalOnHand, it.decimals_allowed)} ${it.uom}`}
        actions={
          lowStock ? (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Below reorder point ({it.reorder_point})
            </Badge>
          ) : undefined
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="pricing">Pricing & Cost</TabsTrigger>
          <TabsTrigger value="inventory">Inventory by Location</TabsTrigger>
          <TabsTrigger value="lots">Lots/Serials</TabsTrigger>
          <TabsTrigger value="cost-history">Cost History</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="barcode">Barcode</TabsTrigger>
        </TabsList>

        <form onSubmit={handleSubmit(onSave)}>
          <TabsContent value="general" className="space-y-4">
            <div className="rounded-lg border bg-card p-5">
              <fieldset disabled={!canWrite} className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="d-sku">SKU *</Label>
                  <Input id="d-sku" className="mt-1 rounded-md" aria-invalid={!!errors.sku} {...register("sku", { required: "SKU is required" })} />
                  {errors.sku && <p className="mt-1 text-xs text-destructive">{errors.sku.message}</p>}
                </div>
                <div>
                  <Label htmlFor="d-name">Name *</Label>
                  <Input id="d-name" className="mt-1 rounded-md" aria-invalid={!!errors.name} {...register("name", { required: "Name is required" })} />
                  {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
                </div>
                <div>
                  <Label htmlFor="d-type">Item type</Label>
                  <select id="d-type" className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm" {...register("type")}>
                    <option value="inventory">Inventory</option>
                    <option value="non_inventory">Non-inventory</option>
                    <option value="assembly">Assembly</option>
                    <option value="service">Service</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="d-track">Tracking mode</Label>
                  <select id="d-track" className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm" {...register("tracking")}>
                    <option value="none">None</option>
                    <option value="lot">Lot</option>
                    <option value="serial">Serial</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="d-uom">Unit of measure</Label>
                  <Input id="d-uom" className="mt-1 rounded-md" {...register("uom")} />
                </div>
                <div>
                  <Label htmlFor="d-dec">Decimal places allowed (0–6)</Label>
                  <Input id="d-dec" type="number" min={0} max={6} className="mt-1 rounded-md" {...register("decimals_allowed")} />
                </div>
                <div>
                  <Label htmlFor="d-cat">Category</Label>
                  <Input id="d-cat" className="mt-1 rounded-md" {...register("category")} />
                </div>
                <div>
                  <Label htmlFor="d-reorder">Reorder point</Label>
                  <Input id="d-reorder" type="number" step="any" className="mt-1 rounded-md" {...register("reorder_point")} />
                </div>
                <div>
                  <Label htmlFor="d-vendor">Preferred vendor</Label>
                  <select id="d-vendor" className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm" {...register("preferred_vendor_id")}>
                    <option value="">None</option>
                    {(vendorQ.data ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="d-desc">Description</Label>
                  <Textarea id="d-desc" className="mt-1 rounded-md" rows={2} {...register("description")} />
                </div>
              </fieldset>
              {canWrite && (
                <div className="mt-4">
                  <Button type="submit" disabled={isSubmitting}>
                    Save changes
                  </Button>
                </div>
              )}
            </div>

            {it.type === "assembly" && (
              <div className="rounded-lg border bg-card p-5">
                <h3 className="section-label mb-3">Bill of materials, co-products &amp; by-products</h3>
                <div className="mb-3 flex flex-wrap items-end gap-2">
                  <div className="min-w-[200px] flex-1">
                    <Label htmlFor="bom-item">Item</Label>
                    <select
                      id="bom-item"
                      value={bomCompId}
                      onChange={(e) => setBomCompId(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
                    >
                      <option value="">Select item…</option>
                      {(allItemsQ.data ?? []).map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.sku} — {x.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-36">
                    <Label htmlFor="bom-role">Role</Label>
                    <select
                      id="bom-role"
                      value={bomRole}
                      onChange={(e) => setBomRole(e.target.value as "component" | "co_product" | "by_product")}
                      className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
                    >
                      <option value="component">Component</option>
                      <option value="co_product">Co-product</option>
                      <option value="by_product">By-product</option>
                    </select>
                  </div>
                  <div className="w-28">
                    <Label htmlFor="bom-qty">Qty</Label>
                    <Input id="bom-qty" type="number" step="any" value={bomQty} onChange={(e) => setBomQty(e.target.value)} className="mt-1 rounded-md" />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canWrite || !bomCompId}
                    onClick={async () => {
                      const { error } = await supabase.from("item_bom_lines").insert({
                        company_id: companyId,
                        assembly_item_id: itemId,
                        component_item_id: bomCompId,
                        role: bomRole,
                        qty: Number(bomQty) || 1,
                      });
                      if (error) toast.error(error.message);
                      else {
                        toast.success("BOM line added");
                        setBomCompId("");
                        qc.invalidateQueries({ queryKey: ["item_bom", itemId] });
                      }
                    }}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add
                  </Button>
                </div>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5">Role</th>
                      <th className="py-1.5">Item</th>
                      <th className="py-1.5 text-right">Qty</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {(bomQ.data ?? []).length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-muted-foreground">
                          No components, co-products, or by-products defined.
                        </td>
                      </tr>
                    )}
                    {(bomQ.data ?? []).map((b) => {
                      const comp = b.comp as unknown as { sku: string; name: string; uom: string } | null;
                      return (
                        <tr key={b.id} className="border-b">
                          <td className="py-1.5">
                            <Badge variant={b.role === "component" ? "outline" : "secondary"}>{labelize(b.role)}</Badge>
                          </td>
                          <td className="py-1.5">{comp ? `${comp.sku} — ${comp.name}` : b.component_item_id}</td>
                          <td className="py-1.5 text-right">
                            {num(b.qty, 6)} {comp?.uom ?? ""}
                          </td>
                          <td className="py-1.5 text-right">
                            {canWrite && (
                              <button
                                type="button"
                                aria-label="Remove BOM line"
                                onClick={async () => {
                                  await supabase.from("item_bom_lines").delete().eq("id", b.id);
                                  qc.invalidateQueries({ queryKey: ["item_bom", itemId] });
                                }}
                                className="text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="pricing">
            <div className="rounded-lg border bg-card p-5">
              <fieldset disabled={!canWrite} className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <Label htmlFor="d-cost">Standard / Unit cost (₱)</Label>
                  <Input id="d-cost" type="number" step="any" className="mt-1 rounded-md" {...register("cost")} />
                </div>
                <div>
                  <Label htmlFor="d-price">Selling price (₱)</Label>
                  <Input id="d-price" type="number" step="any" className="mt-1 rounded-md" {...register("price")} />
                </div>
                <div>
                  <Label htmlFor="d-tax">Sales tax code</Label>
                  <select id="d-tax" className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm" {...register("tax_code_id")}>
                    <option value="">None</option>
                    {(taxQ.data ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.code} — {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </fieldset>
              {canWrite && (
                <div className="mt-4">
                  <Button type="submit" disabled={isSubmitting}>
                    Save pricing
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>
        </form>

        <TabsContent value="inventory">
          <div className="rounded-lg border bg-card p-5">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Location</th>
                  <th className="py-2">Lot</th>
                  <th className="py-2">Expiry</th>
                  <th className="py-2 text-right">Qty on hand</th>
                </tr>
              </thead>
              <tbody>
                {(invQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted-foreground">
                      No inventory recorded for this item.
                    </td>
                  </tr>
                )}
                {(invQ.data ?? []).map((row) => {
                  const loc = row.location as unknown as { name: string } | null;
                  const lot = row.lot as unknown as { lot_no: string; expiry_date: string | null } | null;
                  return (
                    <tr key={row.id} className="border-b">
                      <td className="py-2">{loc?.name ?? "—"}</td>
                      <td className="py-2">{lot?.lot_no ?? "—"}</td>
                      <td className="py-2">{lot?.expiry_date ? fmtDate(lot.expiry_date) : "—"}</td>
                      <td className="py-2 text-right font-medium">
                        {num(row.qty, it.decimals_allowed)} {it.uom}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="lots" className="space-y-4">
          {it.tracking === "lot" && (
            <div className="rounded-lg border bg-card p-5">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <h3 className="section-label">Lots (sorted FEFO)</h3>
                {canWrite && (
                  <div className="flex flex-wrap items-end gap-2">
                    <Input
                      placeholder="Lot #"
                      value={newLotNo}
                      onChange={(e) => setNewLotNo(e.target.value)}
                      className="h-8 w-36 rounded-md"
                    />
                    <Input
                      type="date"
                      value={newLotExp}
                      onChange={(e) => setNewLotExp(e.target.value)}
                      className="h-8 w-40 rounded-md"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!newLotNo.trim()}
                      onClick={async () => {
                        const { error } = await supabase.from("item_lots").insert({
                          company_id: companyId,
                          item_id: itemId,
                          lot_no: newLotNo.trim(),
                          received_date: new Date().toISOString().slice(0, 10),
                          expiry_date: newLotExp || null,
                        });
                        if (error) toast.error(error.message);
                        else {
                          toast.success("Lot added");
                          setNewLotNo("");
                          setNewLotExp("");
                          qc.invalidateQueries({ queryKey: ["item_lots", itemId] });
                        }
                      }}
                    >
                      Add lot
                    </Button>
                  </div>
                )}
              </div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2">Lot #</th>
                    <th className="py-2">Received</th>
                    <th className="py-2">Expiry</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(lotsQ.data ?? []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-muted-foreground">
                        No lots recorded.
                      </td>
                    </tr>
                  )}
                  {(lotsQ.data ?? []).map((l) => (
                    <tr key={l.id} className="border-b">
                      <td className="py-2 font-medium">{l.lot_no}</td>
                      <td className="py-2">{fmtDate(l.received_date)}</td>
                      <td className="py-2">{fmtDate(l.expiry_date) || "—"}</td>
                      <td className="py-2">
                        {isExpiringSoon(l.expiry_date) ? (
                          <Badge variant="destructive">Expiring soon</Badge>
                        ) : (
                          <Badge variant="outline">OK</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {it.tracking === "serial" && (
            <div className="rounded-lg border bg-card p-5">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <h3 className="section-label">Serial numbers</h3>
                {canWrite && (
                  <div className="flex flex-wrap items-end gap-2">
                    <Input
                      placeholder="Serial #"
                      value={newSerialNo}
                      onChange={(e) => setNewSerialNo(e.target.value)}
                      className="h-8 w-40 rounded-md"
                    />
                    <Input
                      type="number"
                      step="any"
                      placeholder="Unit cost"
                      value={newSerialCost}
                      onChange={(e) => setNewSerialCost(e.target.value)}
                      className="h-8 w-28 rounded-md"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!newSerialNo.trim()}
                      onClick={async () => {
                        const { error } = await supabase.from("item_serials").insert({
                          company_id: companyId,
                          item_id: itemId,
                          serial_no: newSerialNo.trim(),
                          unit_cost: Number(newSerialCost) || Number(it.cost),
                          status: "in_stock",
                        });
                        if (error) toast.error(error.message);
                        else {
                          toast.success("Serial added");
                          setNewSerialNo("");
                          setNewSerialCost("");
                          qc.invalidateQueries({ queryKey: ["item_serials", itemId] });
                        }
                      }}
                    >
                      Add serial
                    </Button>
                  </div>
                )}
              </div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2">Serial #</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Location</th>
                    <th className="py-2 text-right">Unit cost</th>
                    <th className="py-2 text-right">Est. P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {(serialsQ.data ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-muted-foreground">
                        No serial numbers recorded.
                      </td>
                    </tr>
                  )}
                  {(serialsQ.data ?? []).map((s) => {
                    const loc = s.location as unknown as { name: string } | null;
                    const cost = Number(s.unit_cost || it.cost);
                    const pnl = s.status === "sold" ? Number(it.price) - cost : null;
                    return (
                      <tr key={s.id} className="border-b">
                        <td className="py-2 font-medium">{s.serial_no}</td>
                        <td className="py-2">
                          <Badge variant={s.status === "scrapped" ? "destructive" : s.status === "sold" ? "secondary" : "outline"}>
                            {labelize(s.status)}
                          </Badge>
                        </td>
                        <td className="py-2">{loc?.name ?? "—"}</td>
                        <td className="py-2 text-right">₱{peso(cost)}</td>
                        <td className={`py-2 text-right ${pnl !== null && pnl < 0 ? "text-destructive" : ""}`}>
                          {pnl !== null ? `₱${peso(pnl)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {it.tracking === "none" && (
            <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
              Tracking mode is set to None. Switch to Lot or Serial on the General tab to track individual lots or serial numbers.
            </div>
          )}
        </TabsContent>

        <TabsContent value="cost-history">
          <div className="rounded-lg border bg-card p-5">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Date</th>
                  <th className="py-2">Txn</th>
                  <th className="py-2">Serial</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit cost</th>
                  <th className="py-2 text-right">Running avg cost</th>
                </tr>
              </thead>
              <tbody>
                {(costQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted-foreground">
                      No cost history entries yet.
                    </td>
                  </tr>
                )}
                {(costQ.data ?? []).map((h) => {
                  const ser = h.serial as unknown as { serial_no: string } | null;
                  return (
                    <tr key={h.id} className="border-b">
                      <td className="py-2">{fmtDate(h.txn_date)}</td>
                      <td className="py-2">{h.txn_ref ?? "—"}</td>
                      <td className="py-2">{ser?.serial_no ?? "—"}</td>
                      <td className="py-2 text-right">{num(h.qty, it.decimals_allowed)}</td>
                      <td className="py-2 text-right">₱{peso(h.unit_cost)}</td>
                      <td className="py-2 text-right font-medium">₱{peso(h.running_avg_cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="transactions">
          <div className="rounded-lg border bg-card p-5">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Date</th>
                  <th className="py-2">Ref #</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Party</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Rate</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(txnsQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted-foreground">
                      No transactions for this item.
                    </td>
                  </tr>
                )}
                {(txnsQ.data ?? []).map((l) => {
                  const txn = l.txn as unknown as { ref_no: string; type: string; txn_date: string; party_name: string | null } | null;
                  return (
                    <tr key={l.id} className="border-b">
                      <td className="py-2">{fmtDate(txn?.txn_date)}</td>
                      <td className="py-2 font-medium">{txn?.ref_no ?? "—"}</td>
                      <td className="py-2">{labelize(txn?.type)}</td>
                      <td className="py-2">{txn?.party_name ?? "—"}</td>
                      <td className="py-2 text-right">{num(l.qty, it.decimals_allowed)}</td>
                      <td className="py-2 text-right">₱{peso(l.rate)}</td>
                      <td className="py-2 text-right">₱{peso(l.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="barcode">
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="section-label">Barcode &amp; QR code</h3>
                <p className="text-sm text-muted-foreground">Value: {barcodeValue}</p>
              </div>
              <Button type="button" onClick={() => setPrintOpen(true)}>
                <Printer className="mr-1.5 h-4 w-4" />
                Print labels
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-8 rounded-md border bg-surface p-6">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Code128</p>
                <Code128Svg value={barcodeValue} />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">QR Code</p>
                <QrCanvas value={barcodeValue} size={112} />
              </div>
            </div>
            <PrintLabelsDialog
              open={printOpen}
              onOpenChange={setPrintOpen}
              sku={it.sku}
              name={it.name}
              barcode={barcodeValue}
              price={Number(it.price)}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
