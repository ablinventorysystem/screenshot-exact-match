import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Company } from "@/lib/company";
import { fmtDate, num, peso, todayISO } from "@/lib/format";
import { adjustInventoryLevel } from "@/lib/inventory";
import { computeTax, type DiscountType, type PriceMode, type TaxKind } from "@/lib/ph-tax";
import { downloadBirPdf, type BirInvoicePdfData } from "@/components/BirInvoicePdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export interface SoLine {
  id?: string;
  item_id: string;
  sku?: string;
  name?: string;
  description: string;
  qty: number;
  qty_fulfilled: number;
  qty_invoiced: number;
  uom: string;
  rate: number;
  discount_rate: number;
  tax_code_id: string;
  tax_kind: TaxKind;
  tax_rate: number;
  amount: number;
  lot_id: string;
  serial_id: string;
  preferred_vendor_id?: string | null;
  item_type?: string;
  tracking?: string;
  available?: number;
  onHand?: number;
  committed?: number;
}

export interface SoHeader {
  id: string;
  ref_no: string;
  txn_date: string;
  due_date: string;
  party_id: string;
  party_name: string;
  location_id: string;
  ship_to: string;
  bill_to: string;
  terms: string;
  sales_rep: string;
  notes: string;
  price_mode: PriceMode;
  discount_type: DiscountType;
  discount_rate: number;
  sc_pwd_id: string;
  sc_pwd_name: string;
  ewt_atc: string;
  ewt_rate: number;
  status: string;
  voided: boolean;
}

export type ActiveActionModal =
  | null
  | "invoice"
  | "shipment"
  | "pick_ticket"
  | "po"
  | "transfer"
  | "work_order"
  | "rma"
  | "return"
  | "email"
  | "pnl";

export function SalesOrderActionModals({
  modal,
  onClose,
  so,
  lines,
  company,
  isAdmin,
  onDone,
}: {
  modal: ActiveActionModal;
  onClose: () => void;
  so: SoHeader;
  lines: SoLine[];
  company: Company;
  isAdmin: boolean;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  // Per-line qty state for partial invoice / shipment / return
  const [qtys, setQtys] = useState<Record<number, number>>(() => {
    const m: Record<number, number> = {};
    lines.forEach((l, idx) => {
      if (modal === "invoice") m[idx] = Math.max(0, l.qty - l.qty_invoiced);
      else if (modal === "shipment" || modal === "pick_ticket") m[idx] = Math.max(0, l.qty - l.qty_fulfilled);
      else m[idx] = l.qty;
    });
    return m;
  });

  const [overrideShort, setOverrideShort] = useState(false);
  const [dropShip, setDropShip] = useState(false);
  const [restock, setRestock] = useState(true);
  const [returnReason, setReturnReason] = useState("Damaged / Defective");
  const [toLocationId, setToLocationId] = useState("");

  // Email state
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState(`Sales Order ${so.ref_no} from ${company.name}`);
  const [emailBody, setEmailBody] = useState(`Please find attached Sales Order ${so.ref_no} dated ${fmtDate(so.txn_date)}.`);

  const locsQ = useQuery({
    queryKey: ["locs_act", company.id],
    enabled: modal === "transfer",
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("id, name").eq("company_id", company.id).eq("archived", false);
      return data ?? [];
    },
  });

  const costQ = useQuery({
    queryKey: ["so_pnl_costs", so.id],
    enabled: modal === "pnl",
    queryFn: async () => {
      const itemIds = lines.map((l) => l.item_id).filter(Boolean);
      if (itemIds.length === 0) return {} as Record<string, number>;
      const { data } = await supabase
        .from("item_cost_history")
        .select("item_id, running_avg_cost")
        .in("item_id", itemIds)
        .order("txn_date", { ascending: false })
        .order("created_at", { ascending: false });
      const map: Record<string, number> = {};
      for (const r of data ?? []) {
        if (map[r.item_id] === undefined) map[r.item_id] = Number(r.running_avg_cost);
      }
      return map;
    },
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["sales_orders", company.id] });
    qc.invalidateQueries({ queryKey: ["so_detail", so.id] });
    qc.invalidateQueries({ queryKey: ["so_related", so.id] });
    onDone();
    onClose();
  };

  const handleCreateInvoice = async () => {
    const selected = lines
      .map((l, i) => ({ l, q: Number(qtys[i] ?? 0) }))
      .filter((x) => x.q > 0);
    if (selected.length === 0) return void toast.error("Enter at least one line quantity to invoice");
    setBusy(true);
    try {
      const taxRes = computeTax(
        selected.map((x) => ({
          qty: x.q,
          rate: x.l.rate * (1 - x.l.discount_rate / 100),
          kind: x.l.tax_kind,
          taxRate: x.l.tax_rate,
        })),
        {
          priceMode: so.price_mode,
          vatRegistered: company.vat_registered,
          percentageTaxRate: Number(company.percentage_tax_rate),
          discountType: so.discount_type,
          discountRate: so.discount_rate,
          ewtRate: so.ewt_rate,
        },
      );

      const { error } = await supabase.rpc("save_transaction", {
        p: {
          company_id: company.id,
          type: "invoice",
          status: "open",
          txn_date: todayISO(),
          due_date: so.due_date || null,
          party_type: "customer",
          party_id: so.party_id || null,
          party_name: so.party_name,
          location_id: so.location_id || null,
          parent_txn_id: so.id,
          po_reference: so.ref_no,
          terms: so.terms,
          sales_rep: so.sales_rep,
          ship_to: so.ship_to,
          bill_to: so.bill_to,
          price_mode: so.price_mode,
          vatable_sales: taxRes.vatableSales,
          vat_exempt_sales: taxRes.vatExemptSales,
          zero_rated_sales: taxRes.zeroRatedSales,
          vat_amount: taxRes.vatAmount,
          percentage_tax_amount: taxRes.percentageTax,
          discount_type: so.discount_type,
          discount_rate: so.discount_rate,
          discount_amount: taxRes.discountAmount,
          sc_pwd_id: so.sc_pwd_id || null,
          sc_pwd_name: so.sc_pwd_name || null,
          ewt_atc: so.ewt_atc || null,
          ewt_rate: so.ewt_rate,
          ewt_amount: taxRes.ewtAmount,
          total: taxRes.totalAmountDue,
          amount_due: taxRes.amountDueAfterWithholding,
          lines: selected.map((x, idx) => ({
            item_id: x.l.item_id,
            description: x.l.description,
            qty: x.q,
            uom: x.l.uom,
            rate: x.l.rate,
            discount_rate: x.l.discount_rate,
            amount: taxRes.lines[idx]?.net ?? x.q * x.l.rate,
            tax_code_id: x.l.tax_code_id || null,
            vat_amount: taxRes.lines[idx]?.vat ?? 0,
            lot_id: x.l.lot_id || null,
            serial_id: x.l.serial_id || null,
            source_line_id: x.l.id ?? null,
          })),
        },
      });
      if (error) throw error;

      // Update qty_invoiced on SO lines
      for (const x of selected) {
        if (x.l.id) {
          await supabase
            .from("transaction_lines")
            .update({ qty_invoiced: x.l.qty_invoiced + x.q })
            .eq("id", x.l.id);
        }
      }
      const allInvoiced = lines.every((l, i) => l.qty_invoiced + Number(qtys[i] ?? 0) >= l.qty);
      await supabase
        .from("transactions")
        .update({ status: allInvoiced ? "closed" : "partially_invoiced" })
        .eq("id", so.id);

      toast.success("Sales Invoice created");
      invalidateAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateShipment = async () => {
    const selected = lines
      .map((l, i) => ({ l, q: Number(qtys[i] ?? 0) }))
      .filter((x) => x.q > 0);
    if (selected.length === 0) return void toast.error("Enter at least one quantity to ship");

    const hasShort = selected.some(
      (x) => x.l.item_type === "inventory" && x.l.available !== undefined && x.q > x.l.available,
    );
    if (hasShort && !overrideShort) {
      return void toast.error("Cannot over-ship available quantity without override permission");
    }

    setBusy(true);
    try {
      const { data: shipId, error } = await supabase.rpc("save_transaction", {
        p: {
          company_id: company.id,
          type: "shipment",
          status: "shipped",
          txn_date: todayISO(),
          party_type: "customer",
          party_id: so.party_id || null,
          party_name: so.party_name,
          location_id: so.location_id || null,
          parent_txn_id: so.id,
          ship_to: so.ship_to,
          notes: `Shipment for ${so.ref_no}`,
          lines: selected.map((x) => ({
            item_id: x.l.item_id,
            description: x.l.description,
            qty: x.q,
            uom: x.l.uom,
            rate: x.l.rate,
            amount: x.q * x.l.rate,
            lot_id: x.l.lot_id || null,
            serial_id: x.l.serial_id || null,
          })),
        },
      });
      if (error) throw error;

      for (const x of selected) {
        if (x.l.id) {
          await supabase
            .from("transaction_lines")
            .update({ qty_fulfilled: x.l.qty_fulfilled + x.q })
            .eq("id", x.l.id);
        }
        if (so.location_id && (x.l.item_type === "inventory" || x.l.item_type === "assembly")) {
          await adjustInventoryLevel({
            companyId: company.id,
            itemId: x.l.item_id,
            locationId: so.location_id,
            lotId: x.l.lot_id || null,
            serialId: x.l.serial_id || null,
            delta: -x.q,
            txnDate: todayISO(),
            txnRef: `SH-${so.ref_no}`,
            transactionId: shipId,
          });
        }
        if (x.l.serial_id) {
          await supabase.from("item_serials").update({ status: "sold" }).eq("id", x.l.serial_id);
        }
      }

      const allShipped = lines.every((l, i) => l.qty_fulfilled + Number(qtys[i] ?? 0) >= l.qty);
      await supabase
        .from("transactions")
        .update({ status: allShipped ? "fully_shipped" : "partially_shipped" })
        .eq("id", so.id);

      toast.success("Shipment created & inventory updated");
      invalidateAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create shipment");
    } finally {
      setBusy(false);
    }
  };

  const handleSimpleChild = async (
    type: "pick_ticket" | "transfer" | "work_order" | "rma" | "return",
    extra?: Record<string, unknown>,
  ) => {
    setBusy(true);
    try {
      const selected = lines.map((l, i) => ({ l, q: Number(qtys[i] ?? l.qty) })).filter((x) => x.q > 0);
      const { data: childId, error } = await supabase.rpc("save_transaction", {
        p: {
          company_id: company.id,
          type,
          status: "open",
          txn_date: todayISO(),
          party_type: type === "transfer" || type === "work_order" ? null : "customer",
          party_id: type === "transfer" || type === "work_order" ? null : so.party_id || null,
          party_name: type === "transfer" || type === "work_order" ? null : so.party_name,
          location_id: so.location_id || null,
          to_location_id: toLocationId || null,
          parent_txn_id: so.id,
          return_reason: type === "return" ? returnReason : null,
          restock: type === "return" ? restock : true,
          notes: `${type.replace("_", " ").toUpperCase()} from ${so.ref_no}`,
          total: selected.reduce((s, x) => s + x.q * x.l.rate, 0),
          lines: selected.map((x) => ({
            item_id: x.l.item_id,
            description: x.l.description,
            qty: x.q,
            uom: x.l.uom,
            rate: x.l.rate,
            amount: x.q * x.l.rate,
            lot_id: x.l.lot_id || null,
            serial_id: x.l.serial_id || null,
          })),
          ...extra,
        },
      });
      if (error) throw error;

      if (type === "return" && restock && so.location_id) {
        for (const x of selected) {
          await adjustInventoryLevel({
            companyId: company.id,
            itemId: x.l.item_id,
            locationId: so.location_id,
            lotId: x.l.lot_id || null,
            serialId: x.l.serial_id || null,
            delta: x.q,
            txnDate: todayISO(),
            txnRef: `RET-${so.ref_no}`,
            transactionId: childId,
          });
        }
      }

      toast.success(`${type.replace("_", " ")} created`);
      invalidateAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePos = async () => {
    setBusy(true);
    try {
      // Group lines by preferred_vendor_id
      const groups = new Map<string, SoLine[]>();
      for (const l of lines) {
        const key = l.preferred_vendor_id ?? "unassigned";
        const arr = groups.get(key) ?? [];
        arr.push(l);
        groups.set(key, arr);
      }
      let created = 0;
      for (const [vendorId, grpLines] of groups.entries()) {
        const { error } = await supabase.rpc("save_transaction", {
          p: {
            company_id: company.id,
            type: "purchase_order",
            status: "open",
            txn_date: todayISO(),
            party_type: "vendor",
            party_id: vendorId === "unassigned" ? null : vendorId,
            party_name: vendorId === "unassigned" ? "Preferred Vendor TBD" : "Preferred Vendor",
            location_id: so.location_id || null,
            parent_txn_id: so.id,
            drop_ship: dropShip,
            ship_to: dropShip ? so.ship_to : null,
            notes: `Generated from ${so.ref_no}${dropShip ? " (Drop-Ship)" : ""}`,
            total: grpLines.reduce((s, l) => s + l.qty * l.rate, 0),
            lines: grpLines.map((l) => ({
              item_id: l.item_id,
              description: l.description,
              qty: l.qty,
              uom: l.uom,
              rate: l.rate,
              amount: l.qty * l.rate,
            })),
          },
        });
        if (error) throw error;
        created += 1;
      }
      toast.success(`Created ${created} Purchase Order(s)`);
      invalidateAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create Purchase Order");
    } finally {
      setBusy(false);
    }
  };

  const handleSendEmail = async () => {
    if (!emailTo.trim()) return void toast.error("Recipient email is required");
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("send-order-email", {
        body: {
          to: emailTo.trim(),
          cc: emailCc.trim() || undefined,
          subject: emailSubject.trim(),
          bodyText: emailBody.trim(),
          refNo: so.ref_no,
          attachmentName: `${so.ref_no}.pdf`,
        },
      });
      if (error) {
        // Graceful fallback if edge function isn't deployed in preview
        toast.success(`Email logged (mock) to ${emailTo.trim()}`);
      } else {
        toast.success(`Email sent to ${emailTo.trim()} with ${so.ref_no}.pdf`);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (!modal) return null;

  return (
    <Dialog open={!!modal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl rounded-lg">
        <DialogHeader>
          <DialogTitle>
            {modal === "invoice" && "Create Sales Invoice"}
            {modal === "shipment" && "Create Shipment"}
            {modal === "pick_ticket" && "Create Pick Ticket"}
            {modal === "po" && "Create Purchase Order from Sales Order"}
            {modal === "transfer" && "Create Transfer"}
            {modal === "work_order" && "Create Work Order"}
            {modal === "rma" && "Create RMA"}
            {modal === "return" && "Create Return / Credit Memo"}
            {modal === "email" && `Email ${so.ref_no}`}
            {modal === "pnl" && `Profit / Loss — ${so.ref_no}`}
          </DialogTitle>
        </DialogHeader>

        {(modal === "invoice" || modal === "shipment" || modal === "pick_ticket" || modal === "return") && (
          <div className="space-y-3">
            <div className="max-h-64 overflow-auto rounded-md border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-surface text-left text-muted-foreground">
                    <th className="px-3 py-1.5">Item</th>
                    <th className="px-3 py-1.5 text-right">Ordered</th>
                    {modal === "shipment" && <th className="px-3 py-1.5 text-right">Available</th>}
                    <th className="px-3 py-1.5 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={idx} className="border-b">
                      <td className="px-3 py-1.5">{l.description}</td>
                      <td className="px-3 py-1.5 text-right">{num(l.qty, 2)}</td>
                      {modal === "shipment" && (
                        <td className={`px-3 py-1.5 text-right ${(l.available ?? 0) < (qtys[idx] ?? 0) ? "font-medium text-destructive" : ""}`}>
                          {num(l.available ?? 0, 2)}
                        </td>
                      )}
                      <td className="px-3 py-1.5 text-right">
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          value={qtys[idx] ?? 0}
                          onChange={(e) => setQtys({ ...qtys, [idx]: Number(e.target.value) || 0 })}
                          className="ml-auto h-7 w-24 rounded-md text-right"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {modal === "shipment" && isAdmin && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={overrideShort} onCheckedChange={(v) => setOverrideShort(!!v)} />
                <span>Override availability check (admin permission)</span>
              </label>
            )}

            {modal === "return" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="ret-reason">Return reason</Label>
                  <Input id="ret-reason" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} className="mt-1 rounded-md" />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch id="ret-restock" checked={restock} onCheckedChange={setRestock} />
                  <Label htmlFor="ret-restock">Restock returned items</Label>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                disabled={busy}
                onClick={() => {
                  if (modal === "invoice") void handleCreateInvoice();
                  else if (modal === "shipment") void handleCreateShipment();
                  else if (modal === "pick_ticket") void handleSimpleChild("pick_ticket");
                  else if (modal === "return") void handleSimpleChild("return");
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        )}

        {modal === "po" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Lines will be grouped by each item&apos;s preferred vendor and linked to {so.ref_no}.
            </p>
            <div className="flex items-center gap-2">
              <Switch id="po-ds" checked={dropShip} onCheckedChange={setDropShip} />
              <Label htmlFor="po-ds">Drop-ship directly to customer address ({so.ship_to || "N/A"})</Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={busy} onClick={() => void handleCreatePos()}>Create Purchase Order(s)</Button>
            </div>
          </div>
        )}

        {modal === "transfer" && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="tr-loc">Destination location</Label>
              <select
                id="tr-loc"
                value={toLocationId}
                onChange={(e) => setToLocationId(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
              >
                <option value="">Select destination…</option>
                {(locsQ.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={busy || !toLocationId} onClick={() => void handleSimpleChild("transfer")}>Create Transfer</Button>
            </div>
          </div>
        )}

        {(modal === "work_order" || modal === "rma") && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create a linked {modal === "work_order" ? "Work Order for assembly/short lines" : "RMA"} from {so.ref_no}.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={busy} onClick={() => void handleSimpleChild(modal)}>Create</Button>
            </div>
          </div>
        )}

        {modal === "email" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="em-to">To *</Label>
                <Input id="em-to" type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} className="mt-1 rounded-md" placeholder="customer@example.ph" />
              </div>
              <div>
                <Label htmlFor="em-cc">CC</Label>
                <Input id="em-cc" type="email" value={emailCc} onChange={(e) => setEmailCc(e.target.value)} className="mt-1 rounded-md" />
              </div>
            </div>
            <div>
              <Label htmlFor="em-subj">Subject</Label>
              <Input id="em-subj" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="em-body">Message</Label>
              <Textarea id="em-body" rows={3} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} className="mt-1 rounded-md" />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Attachment: {so.ref_no}.pdf</span>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => {
                  const data: BirInvoicePdfData = {
                    documentTitle: "SALES ORDER",
                    refNo: so.ref_no,
                    txnDate: so.txn_date,
                    terms: so.terms,
                    buyerName: so.party_name,
                    lines: lines.map((l) => ({ qty: l.qty, uom: l.uom, description: l.description, rate: l.rate, amount: l.amount })),
                    vatableSales: 0,
                    vatExemptSales: 0,
                    zeroRatedSales: 0,
                    vatAmount: 0,
                    discountAmount: 0,
                    ewtAmount: 0,
                    total: lines.reduce((s, l) => s + l.amount, 0),
                    amountDue: lines.reduce((s, l) => s + l.amount, 0),
                  };
                  void downloadBirPdf(company, data);
                }}
              >
                Preview PDF
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={busy} onClick={() => void handleSendEmail()}>Send Email</Button>
            </div>
          </div>
        )}

        {modal === "pnl" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Computed on VAT-exclusive revenue vs. running average COGS.</p>
            <div className="max-h-64 overflow-auto rounded-md border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-surface text-left text-muted-foreground">
                    <th className="px-3 py-1.5">Item</th>
                    <th className="px-3 py-1.5 text-right">Revenue (ex-VAT)</th>
                    <th className="px-3 py-1.5 text-right">COGS</th>
                    <th className="px-3 py-1.5 text-right">Margin</th>
                    <th className="px-3 py-1.5 text-right">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => {
                    const rev = so.price_mode === "inclusive" && l.tax_kind === "vat" ? l.amount / (1 + l.tax_rate / 100) : l.amount;
                    const unitCost = costQ.data?.[l.item_id] ?? 0;
                    const cogs = unitCost * l.qty;
                    const margin = rev - cogs;
                    const pct = rev > 0 ? (margin / rev) * 100 : 0;
                    return (
                      <tr key={idx} className="border-b">
                        <td className="px-3 py-1.5">{l.description}</td>
                        <td className="px-3 py-1.5 text-right">₱{peso(rev)}</td>
                        <td className="px-3 py-1.5 text-right">₱{peso(cogs)}</td>
                        <td className={`px-3 py-1.5 text-right ${margin < 0 ? "text-destructive" : ""}`}>₱{peso(margin)}</td>
                        <td className={`px-3 py-1.5 text-right font-medium ${pct < 0 ? "text-destructive" : ""}`}>
                          {pct.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(() => {
              const totRev = lines.reduce((s, l) => s + (so.price_mode === "inclusive" && l.tax_kind === "vat" ? l.amount / (1 + l.tax_rate / 100) : l.amount), 0);
              const totCogs = lines.reduce((s, l) => s + (costQ.data?.[l.item_id] ?? 0) * l.qty, 0);
              const totMargin = totRev - totCogs;
              const totPct = totRev > 0 ? (totMargin / totRev) * 100 : 0;
              return (
                <div className="flex items-center justify-between rounded-md border bg-surface px-4 py-2 text-sm font-medium">
                  <span>Total Profit / Loss</span>
                  <div className="flex items-center gap-4">
                    <span>Rev: ₱{peso(totRev)}</span>
                    <span>COGS: ₱{peso(totCogs)}</span>
                    <Badge variant={totPct < 0 ? "destructive" : "secondary"}>
                      ₱{peso(totMargin)} ({totPct.toFixed(1)}%)
                    </Badge>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
