import type { Database } from "@/integrations/supabase/types";

export type TxnType = Database["public"]["Enums"]["txn_type"];

export interface TxnMeta {
  type: TxnType;
  title: string;
  singular: string;
  path: string;
  party: "customer" | "vendor" | null;
  /** Uses item lines */
  hasLines: boolean;
  /** Sales-side document: output VAT, sales tax codes */
  side: "sales" | "purchases" | "internal";
  statuses: string[];
  /** Gets a BIR-registered invoice series number */
  birSeries?: boolean;
}

export const TXN_META: Record<TxnType, TxnMeta> = {
  estimate: { type: "estimate", title: "Estimates", singular: "Estimate", path: "/estimates", party: "customer", hasLines: true, side: "sales", statuses: ["pending", "accepted", "closed"] },
  sales_order: { type: "sales_order", title: "Sales orders", singular: "Sales order", path: "/sales-orders", party: "customer", hasLines: true, side: "sales", statuses: ["open", "closed"] },
  invoice: { type: "invoice", title: "Invoices", singular: "Sales invoice", path: "/invoices", party: "customer", hasLines: true, side: "sales", statuses: ["open", "paid", "void"], birSeries: true },
  sales_receipt: { type: "sales_receipt", title: "Sales receipts", singular: "Sales receipt", path: "/sales-receipts", party: "customer", hasLines: true, side: "sales", statuses: ["open", "closed", "void"], birSeries: true },
  payment: { type: "payment", title: "Payments", singular: "Payment", path: "/payments", party: "customer", hasLines: false, side: "sales", statuses: ["closed", "void"] },
  return: { type: "return", title: "Returns", singular: "Return", path: "/returns", party: "customer", hasLines: true, side: "sales", statuses: ["open", "closed"] },
  rma: { type: "rma", title: "RMAs", singular: "RMA", path: "/rmas", party: "customer", hasLines: true, side: "sales", statuses: ["open", "closed"] },
  purchase_order: { type: "purchase_order", title: "Purchase orders", singular: "Purchase order", path: "/purchase-orders", party: "vendor", hasLines: true, side: "purchases", statuses: ["open", "received", "closed"] },
  receipt: { type: "receipt", title: "Receipts", singular: "Item receipt", path: "/receipts", party: "vendor", hasLines: true, side: "purchases", statuses: ["open", "closed"] },
  bill: { type: "bill", title: "Bills", singular: "Bill", path: "/bills", party: "vendor", hasLines: true, side: "purchases", statuses: ["open", "paid", "void"] },
  pick_ticket: { type: "pick_ticket", title: "Pick tickets", singular: "Pick ticket", path: "/pick-tickets", party: "customer", hasLines: true, side: "internal", statuses: ["open", "picked"] },
  shipment: { type: "shipment", title: "Shipments", singular: "Shipment", path: "/shipments", party: "customer", hasLines: true, side: "internal", statuses: ["unshipped", "shipped"] },
  transfer: { type: "transfer", title: "Transfers", singular: "Transfer", path: "/transfers", party: null, hasLines: true, side: "internal", statuses: ["open", "closed"] },
  adjustment: { type: "adjustment", title: "Adjustments", singular: "Adjustment", path: "/adjustments", party: null, hasLines: true, side: "internal", statuses: ["open", "closed"] },
  work_order: { type: "work_order", title: "Work orders", singular: "Work order", path: "/work-orders", party: null, hasLines: true, side: "internal", statuses: ["open", "closed"] },
  build: { type: "build", title: "Builds", singular: "Build", path: "/builds", party: null, hasLines: true, side: "internal", statuses: ["open", "closed"] },
};
