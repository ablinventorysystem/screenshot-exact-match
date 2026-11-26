import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, labelize } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { downloadShippingLabelPdf } from "@/components/ShippingPdf";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Row {
  id: string;
  ref_no: string;
  txn_date: string;
  party_name: string | null;
  notes: string | null;
  location: string;
  archived: boolean;
  carrier: string | null;
  tracking_no: string | null;
}

const SORT_COL: Record<string, string> = { ref: "ref_no", date: "txn_date", customer: "party_name" };

export const Route = createFileRoute("/_authenticated/shipments")({
  head: () => ({
    meta: [
      { title: "Shipments — SOS Inventory" },
      { name: "description", content: "Customer shipments and delivery receipts." },
      { property: "og:title", content: "Shipments — SOS Inventory" },
      { property: "og:description", content: "Customer shipments and delivery receipts." },
    ],
  }),
  component: Shipments,
});

function Shipments() {
  const { company, companyId, canWrite } = useCompany();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const detailQ = useQuery({
    queryKey: ["shipment_detail", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase.from("transactions").select("*").eq("id", selectedId!).single();
      if (error) throw error;
      return data;
    },
  });

  const fetchPage = async (a: FetchArgs) => {
    let q = supabase
      .from("transactions")
      .select("id, ref_no, txn_date, party_name, notes, archived, carrier, tracking_no, location:locations!transactions_location_id_fkey(name)", { count: "exact" })
      .eq("company_id", companyId)
      .eq("type", "shipment");
    if (a.filter !== "all") q = q.eq("archived", a.filter === "archived");
    if (a.search) q = q.or(`ref_no.ilike.%${a.search}%,party_name.ilike.%${a.search}%,notes.ilike.%${a.search}%`);
    const { data, count, error } = await q
      .order(SORT_COL[a.sort.key] ?? "txn_date", { ascending: a.sort.dir === "asc" })
      .order("ref_no", { ascending: false })
      .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
    if (error) throw error;
    return {
      total: count ?? 0,
      rows: (data ?? []).map((d) => ({ ...d, location: (d.location as { name: string } | null)?.name ?? "" })) as Row[],
    };
  };

  const setArchived = (archived: boolean) => async (rows: Row[]) => {
    if (!canWrite) return void toast.error("You don't have permission to change shipments");
    const { error } = await supabase.from("transactions").update({ archived }).in("id", rows.map((r) => r.id));
    if (error) toast.error(error.message);
    else toast.success(`${rows.length} shipment(s) ${archived ? "archived" : "unarchived"}`);
  };

  const columns: Column<Row>[] = [
    {
      key: "ref",
      header: "Ref #",
      sortable: true,
      cell: (r) => (
        <button type="button" className="link-ref text-left" onClick={() => setSelectedId(r.id)}>
          {r.ref_no}
        </button>
      ),
      csv: (r) => r.ref_no,
    },
    { key: "date", header: "Txn date", sortable: true, cell: (r) => fmtDate(r.txn_date), csv: (r) => fmtDate(r.txn_date) },
    { key: "customer", header: "Customer", sortable: true, cell: (r) => r.party_name, csv: (r) => r.party_name ?? "" },
    { key: "location", header: "Location", cell: (r) => r.location, csv: (r) => r.location },
    { key: "comment", header: "Comment", cell: (r) => r.notes, csv: (r) => r.notes ?? "" },
    {
      key: "docs",
      header: "Documents",
      cell: (r) => (r.tracking_no ? `${r.carrier ?? "Carrier"} · ${r.tracking_no}` : <span className="text-muted-foreground">—</span>),
      csv: (r) => r.tracking_no ?? "",
    },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Shipments" subtitle="showing unarchived shipments" />
      {companyId && (
        <DataTable<Row>
          id="shipments"
          queryKey={["shipments", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "date", dir: "desc" }}
          filters={[
            { value: "unarchived", label: "Unarchived" },
            { value: "archived", label: "Archived" },
            { value: "all", label: "All" },
          ]}
          batchActions={[
            { label: "Archive", onSelect: setArchived(true) },
            { label: "Unarchive", onSelect: setArchived(false) },
          ]}
          rowActions={[
            { label: "View / Label", onSelect: (rows) => rows[0] && setSelectedId(rows[0].id) },
            { label: "Archive", onSelect: setArchived(true) },
            { label: "Unarchive", onSelect: setArchived(false) },
          ]}
        />
      )}

      <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-md rounded-lg">
          <DialogHeader>
            <DialogTitle>Shipment {detailQ.data?.ref_no ?? ""}</DialogTitle>
          </DialogHeader>
          {detailQ.data && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted p-3 space-y-1">
                <div><span className="text-muted-foreground">Customer:</span> {detailQ.data.party_name ?? "—"}</div>
                <div><span className="text-muted-foreground">Carrier:</span> {detailQ.data.carrier ?? "Manual"}</div>
                <div><span className="text-muted-foreground">Tracking #:</span> {detailQ.data.tracking_no ?? "—"}</div>
                <div><span className="text-muted-foreground">Weight:</span> {detailQ.data.package_weight ?? 1} kg</div>
                <div><span className="text-muted-foreground">Status:</span> {labelize(detailQ.data.status)}</div>
              </div>
              {company && (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() =>
                    void downloadShippingLabelPdf({
                      provider: detailQ.data.shipping_provider ?? "shipstation",
                      carrier: detailQ.data.carrier ?? "LBC Express",
                      trackingNo: detailQ.data.tracking_no ?? `TRK-${detailQ.data.ref_no}`,
                      refNo: detailQ.data.ref_no,
                      fromCompany: company.name,
                      toCustomer: detailQ.data.party_name ?? "Customer",
                      toAddress: detailQ.data.ship_to,
                      weightKg: detailQ.data.package_weight,
                    })
                  }
                >
                  <FileText className="mr-1.5 h-4 w-4" />
                  Download Shipping Label PDF
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
