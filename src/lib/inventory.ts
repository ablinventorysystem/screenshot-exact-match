import { supabase } from "@/integrations/supabase/client";

export function roundQty(qty: number, decimalsAllowed = 0): number {
  const d = Math.max(0, Math.min(6, decimalsAllowed));
  const f = 10 ** d;
  return Math.round((qty + Number.EPSILON) * f) / f;
}

export interface Availability {
  onHand: number;
  committed: number;
  available: number;
}

export async function getItemAvailability(
  companyId: string,
  itemId: string,
  locationId?: string | null,
): Promise<Availability> {
  let invQ = supabase
    .from("inventory_levels")
    .select("qty")
    .eq("company_id", companyId)
    .eq("item_id", itemId);
  if (locationId) invQ = invQ.eq("location_id", locationId);
  const { data: invRows } = await invQ;
  const onHand = (invRows ?? []).reduce((s, r) => s + Number(r.qty ?? 0), 0);

  // Committed = open sales_order lines where qty > qty_fulfilled
  const { data: soLines } = await supabase
    .from("transaction_lines")
    .select("qty, qty_fulfilled, txn:transactions!inner(company_id, type, status, voided, location_id)")
    .eq("item_id", itemId)
    .eq("txn.company_id", companyId)
    .eq("txn.type", "sales_order")
    .eq("txn.voided", false)
    .in("txn.status", ["open", "pending", "partially_shipped", "partially_invoiced"]);

  const committed = (soLines ?? []).reduce((s, l) => {
    const txn = l.txn as unknown as { location_id: string | null } | null;
    if (locationId && txn?.location_id && txn.location_id !== locationId) return s;
    const rem = Math.max(0, Number(l.qty ?? 0) - Number(l.qty_fulfilled ?? 0));
    return s + rem;
  }, 0);

  return {
    onHand,
    committed,
    available: onHand - committed,
  };
}

export async function adjustInventoryLevel(params: {
  companyId: string;
  itemId: string;
  locationId: string;
  lotId?: string | null;
  serialId?: string | null;
  delta: number;
  unitCost?: number;
  txnDate: string;
  txnRef: string;
  transactionId?: string | null;
}): Promise<void> {
  const { companyId, itemId, locationId, lotId = null, serialId = null, delta, unitCost, txnDate, txnRef, transactionId = null } = params;

  // Find existing inventory_levels row
  let q = supabase
    .from("inventory_levels")
    .select("id, qty")
    .eq("company_id", companyId)
    .eq("item_id", itemId)
    .eq("location_id", locationId);
  q = lotId ? q.eq("lot_id", lotId) : q.is("lot_id", null);
  const { data: existing } = await q.maybeSingle();

  if (existing) {
    const nextQty = Number(existing.qty) + delta;
    const { error } = await supabase
      .from("inventory_levels")
      .update({ qty: nextQty })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("inventory_levels").insert({
      company_id: companyId,
      item_id: itemId,
      location_id: locationId,
      lot_id: lotId,
      qty: delta,
    });
    if (error) throw error;
  }

  // Record cost history when unitCost is provided or on inbound/outbound movements
  if (delta !== 0) {
    const { data: prevHist } = await supabase
      .from("item_cost_history")
      .select("running_avg_cost")
      .eq("company_id", companyId)
      .eq("item_id", itemId)
      .order("txn_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const prevAvg = Number(prevHist?.running_avg_cost ?? unitCost ?? 0);
    const effCost = unitCost !== undefined ? unitCost : prevAvg;

    const { data: totInv } = await supabase
      .from("inventory_levels")
      .select("qty")
      .eq("company_id", companyId)
      .eq("item_id", itemId);
    const newTotalQty = (totInv ?? []).reduce((s, r) => s + Number(r.qty ?? 0), 0);
    const oldTotalQty = Math.max(0, newTotalQty - delta);

    let newAvg = prevAvg;
    if (delta > 0 && newTotalQty > 0) {
      newAvg = (oldTotalQty * prevAvg + delta * effCost) / newTotalQty;
    }

    await supabase.from("item_cost_history").insert({
      company_id: companyId,
      item_id: itemId,
      serial_id: serialId,
      lot_id: lotId,
      transaction_id: transactionId,
      txn_date: txnDate,
      txn_ref: txnRef,
      qty: delta,
      unit_cost: effCost,
      running_avg_cost: Math.round(newAvg * 10000) / 10000,
    });
  }
}

export function isExpiringSoon(expiryDate: string | null | undefined, days = 30): boolean {
  if (!expiryDate) return false;
  const exp = new Date(`${expiryDate}T00:00:00`).getTime();
  const now = new Date().setHours(0, 0, 0, 0);
  const diffDays = (exp - now) / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}
