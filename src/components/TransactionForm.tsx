import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  ChevronDown,
  GripVertical,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { peso } from "@/lib/format";
import { TAX_CODE_OPTIONS, PRICE_TIERS, type LookupItem } from "@/lib/txn-lookups";
import type { TaxResult } from "@/lib/ph-tax";

export interface TxnFormLine {
  key: string;
  id?: string;
  item_id: string;
  description: string;
  part_no?: string;
  qty: number;
  rate: number;
  amount: number;
  uom: string;
  class_id: string;
  tax_code: string;
  due_date?: string;
  qty_picked?: number;
  qty_shipped?: number;
  qty_invoiced?: number;
  qty_received?: number;
  expanded?: boolean;
}

export interface TxnItemOption {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  unit_price?: number | null;
  cost_price?: number | null;
  uom?: string | null;
  part_no?: string | null;
}

export interface MoreMenuAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export function makeEmptyLine(index: number): TxnFormLine {
  return {
    key: `line-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    item_id: "",
    description: "",
    part_no: "",
    qty: 0,
    rate: 0,
    amount: 0,
    uom: "pcs",
    class_id: "",
    tax_code: "12% S",
    due_date: "",
    qty_picked: 0,
    qty_shipped: 0,
    qty_invoiced: 0,
    qty_received: 0,
    expanded: false,
  };
}

export function makeInitialLines(count = 5): TxnFormLine[] {
  return Array.from({ length: count }, (_, i) => makeEmptyLine(i));
}

export function FloatingField({
  label,
  error,
  required,
  children,
  className = "",
}: {
  label: string;
  error?: string | undefined;
  required?: boolean | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-[12px] font-medium leading-none text-primary">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}

interface TransactionFormProps {
  title: string;
  mode: "invoice" | "sales_order" | "purchase_order";
  readOnly?: boolean;
  dirty?: boolean;
  saving?: boolean;
  onClose: () => void;
  onSave: (closeAfter: boolean) => void;
  onPrint?: () => void;
  onAttach?: () => void;
  moreActions?: MoreMenuAction[];
  topFields: ReactNode;
  billingLabel?: string;
  billingAddress: string;
  onBillingAddressChange: (v: string) => void;
  shippingAddress: string;
  onShippingAddressChange: (v: string) => void;
  onSameAsBilling?: () => void;
  addressOptions?: { label: string; value: string }[];
  priceTier?: string;
  onPriceTierChange?: (tier: string) => void;
  onApplyPriceTier?: () => void;
  lines: TxnFormLine[];
  onLinesChange: (lines: TxnFormLine[]) => void;
  items: TxnItemOption[];
  classes: LookupItem[];
  taxResult: TaxResult;
  shippingTaxCode: string;
  onShippingTaxCodeChange: (code: string) => void;
  shippingTaxPct: number;
  onShippingTaxPctChange: (pct: number) => void;
  ewtAmount?: number;
  depositAmount?: number;
  balance?: number;
  bottomFields: ReactNode;
  lineAvailability?: Record<string, { onHand: number; committed: number; available: number }>;
}

export function TransactionForm({
  title,
  mode,
  readOnly = false,
  dirty = false,
  saving = false,
  onClose,
  onSave,
  onPrint,
  onAttach,
  moreActions = [],
  topFields,
  billingLabel = "Billing address",
  billingAddress,
  onBillingAddressChange,
  shippingAddress,
  onShippingAddressChange,
  onSameAsBilling,
  addressOptions = [],
  priceTier = "List Price",
  onPriceTierChange,
  onApplyPriceTier,
  lines,
  onLinesChange,
  items,
  classes,
  taxResult,
  shippingTaxCode,
  onShippingTaxCodeChange,
  shippingTaxPct,
  onShippingTaxPctChange,
  ewtAmount = 0,
  depositAmount = 0,
  balance,
  bottomFields,
  lineAvailability,
}: TransactionFormProps) {
  const [editingBilling, setEditingBilling] = useState(false);
  const [editingShipping, setEditingShipping] = useState(false);

  const handleClose = () => {
    if (dirty && !window.confirm("You have unsaved changes. Discard and close?")) return;
    onClose();
  };

  const updateLine = (idx: number, patch: Partial<TxnFormLine>) => {
    const next = lines.map((l, i) => {
      if (i !== idx) return l;
      const updated = { ...l, ...patch };
      updated.amount = Math.round((updated.qty * updated.rate + Number.EPSILON) * 100) / 100;
      return updated;
    });
    onLinesChange(next);
  };

  const handleSelectItem = (idx: number, itemId: string) => {
    const item = items.find((it) => it.id === itemId);
    if (!item) {
      updateLine(idx, { item_id: itemId });
      return;
    }
    const baseRate =
      mode === "purchase_order"
        ? Number(item.cost_price ?? item.unit_price ?? 0)
        : Number(item.unit_price ?? 0);
    const cur = lines[idx];
    const qty = cur && cur.qty > 0 ? cur.qty : 1;
    updateLine(idx, {
      item_id: itemId,
      description: item.description || item.name,
      part_no: item.part_no ?? "",
      uom: item.uom || "pcs",
      rate: baseRate,
      qty,
    });
  };

  const fillColumn = (field: "class_id" | "tax_code" | "due_date") => {
    const firstVal = lines.find((l) => Boolean(l[field]))?.[field] ?? lines[0]?.[field];
    if (!firstVal) return;
    onLinesChange(lines.map((l) => ({ ...l, [field]: firstVal })));
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top Action Bar */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={handleClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-medium text-foreground">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {onPrint && (
            <Button variant="outline" size="icon" onClick={onPrint} title="Print / PDF">
              <Printer className="h-4 w-4" />
            </Button>
          )}
          {onAttach && (
            <Button variant="outline" size="icon" onClick={onAttach} title="Attachments">
              <Paperclip className="h-4 w-4" />
            </Button>
          )}
          {moreActions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  More <ChevronDown className="ml-1 h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {moreActions.map((act) => (
                  <DropdownMenuItem
                    key={act.label}
                    disabled={act.disabled}
                    onClick={act.onClick}
                    className={act.destructive ? "text-destructive" : undefined}
                  >
                    {act.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!readOnly && (
            <>
              <Button variant="outline" size="sm" disabled={saving} onClick={() => onSave(false)}>
                Save
              </Button>
              <Button size="sm" disabled={saving} onClick={() => onSave(true)}>
                {saving ? "Saving..." : "Save and close"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Main Form Body */}
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 p-4 md:p-6">
        {/* Top Fields Card */}
        <div className="rounded-[10px] border bg-card p-4">{topFields}</div>

        {/* Address & Price Tier Row */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Billing / Vendor Address */}
          <div className="rounded-[10px] border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-medium text-primary">{billingLabel}</span>
              <div className="flex items-center gap-1">
                {addressOptions.length > 0 && (
                  <select
                    className="h-7 rounded-[6px] border bg-background px-2 text-xs"
                    onChange={(e) => onBillingAddressChange(e.target.value)}
                    value=""
                  >
                    <option value="" disabled>
                      Address...
                    </option>
                    {addressOptions.map((o) => (
                      <option key={o.label} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setEditingBilling((v) => !v)}
                  disabled={readOnly}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {editingBilling && !readOnly ? (
              <Textarea
                rows={3}
                value={billingAddress}
                onChange={(e) => onBillingAddressChange(e.target.value)}
                placeholder="Enter address..."
              />
            ) : (
              <p className="whitespace-pre-line text-sm text-muted-foreground">
                {billingAddress.trim() || "No address entered"}
              </p>
            )}
          </div>

          {/* Shipping Address */}
          <div className="rounded-[10px] border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-medium text-primary">Ship to</span>
              <div className="flex items-center gap-1">
                {onSameAsBilling && !readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-primary"
                    onClick={onSameAsBilling}
                  >
                    Same as billing
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setEditingShipping((v) => !v)}
                  disabled={readOnly}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {editingShipping && !readOnly ? (
              <Textarea
                rows={3}
                value={shippingAddress}
                onChange={(e) => onShippingAddressChange(e.target.value)}
                placeholder="Enter shipping address..."
              />
            ) : (
              <p className="whitespace-pre-line text-sm text-muted-foreground">
                {shippingAddress.trim() || "No address entered"}
              </p>
            )}
          </div>

          {/* Price Tier */}
          {mode !== "purchase_order" && onPriceTierChange && (
            <div className="rounded-[10px] border bg-card p-4">
              <FloatingField label="Price tier">
                <div className="flex items-center gap-2">
                  <select
                    className="h-9 flex-1 rounded-[6px] border bg-background px-2.5 text-sm"
                    value={priceTier}
                    onChange={(e) => onPriceTierChange(e.target.value)}
                    disabled={readOnly}
                  >
                    {PRICE_TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {onApplyPriceTier && !readOnly && (
                    <Button type="button" variant="outline" size="sm" onClick={onApplyPriceTier}>
                      Apply
                    </Button>
                  )}
                </div>
              </FloatingField>
            </div>
          )}
        </div>

        {/* Line Items Grid */}
        <div className="overflow-x-auto rounded-[10px] border bg-card">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <th className="w-8 px-2 py-2" />
                <th className="w-8 px-1 py-2" />
                <th className="w-10 px-2 py-2">#</th>
                <th className="min-w-[180px] px-2 py-2">Item</th>
                <th className="min-w-[180px] px-2 py-2">Description</th>
                {mode === "purchase_order" && <th className="w-28 px-2 py-2">Part #</th>}
                <th className="w-24 px-2 py-2 text-right">Qty</th>
                <th className="w-28 px-2 py-2 text-right">Unit price</th>
                <th className="w-28 px-2 py-2 text-right">Amount</th>
                {mode === "sales_order" && (
                  <>
                    <th className="w-16 px-2 py-2 text-right">Picked</th>
                    <th className="w-16 px-2 py-2 text-right">Shipped</th>
                    <th className="w-16 px-2 py-2 text-right">Invoiced</th>
                    <th className="w-32 px-2 py-2">
                      <div className="flex items-center justify-between gap-1">
                        <span>Due date</span>
                        {!readOnly && (
                          <button
                            type="button"
                            className="text-[11px] text-primary hover:underline"
                            onClick={() => fillColumn("due_date")}
                          >
                            Fill
                          </button>
                        )}
                      </div>
                    </th>
                  </>
                )}
                {mode === "purchase_order" && <th className="w-20 px-2 py-2 text-right">Received</th>}
                <th className="w-32 px-2 py-2">
                  <div className="flex items-center justify-between gap-1">
                    <span>Class</span>
                    {!readOnly && (
                      <button
                        type="button"
                        className="text-[11px] text-primary hover:underline"
                        onClick={() => fillColumn("class_id")}
                      >
                        Fill
                      </button>
                    )}
                  </div>
                </th>
                <th className="w-32 px-2 py-2">
                  <div className="flex items-center justify-between gap-1">
                    <span>Tax</span>
                    {!readOnly && (
                      <button
                        type="button"
                        className="text-[11px] text-primary hover:underline"
                        onClick={() => fillColumn("tax_code")}
                      >
                        Fill
                      </button>
                    )}
                  </div>
                </th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const avail = line.item_id && lineAvailability ? lineAvailability[line.item_id] : undefined;
                const overAvail = avail && line.qty > avail.available;
                return (
                  <tr key={line.key} className="border-b last:border-b-0 align-top">
                    <td className="px-2 py-2 text-muted-foreground">
                      <GripVertical className="h-4 w-4 cursor-grab" />
                    </td>
                    <td className="px-1 py-2">
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() =>
                            onLinesChange(
                              lines.length > 1
                                ? lines.filter((_, i) => i !== idx)
                                : [makeEmptyLine(0)],
                            )
                          }
                          className="text-muted-foreground hover:text-destructive"
                          title="Delete line"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground">{idx + 1}</td>
                    <td className="px-2 py-1.5">
                      <select
                        className="h-8 w-full rounded-[6px] border bg-background px-2 text-xs"
                        value={line.item_id}
                        disabled={readOnly}
                        onChange={(e) => handleSelectItem(idx, e.target.value)}
                      >
                        <option value="">Select item...</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.sku} — {it.name}
                          </option>
                        ))}
                      </select>
                      {avail && (
                        <div className={`mt-1 text-[11px] ${overAvail ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                          OH: {avail.onHand} | Comm: {avail.committed} | Avail: {avail.available}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Textarea
                        rows={1}
                        className="min-h-[32px] resize-y text-xs"
                        value={line.description}
                        disabled={readOnly}
                        onChange={(e) => updateLine(idx, { description: e.target.value })}
                      />
                    </td>
                    {mode === "purchase_order" && (
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-8 text-xs"
                          value={line.part_no ?? ""}
                          disabled={readOnly}
                          onChange={(e) => updateLine(idx, { part_no: e.target.value })}
                        />
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        className="h-8 text-right text-xs"
                        value={line.qty || ""}
                        disabled={readOnly}
                        onChange={(e) => updateLine(idx, { qty: parseFloat(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        className="h-8 text-right text-xs"
                        value={line.rate || ""}
                        disabled={readOnly}
                        onChange={(e) => updateLine(idx, { rate: parseFloat(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-right text-xs font-medium">
                      {peso(line.amount)}
                    </td>
                    {mode === "sales_order" && (
                      <>
                        <td className="px-2 py-2.5 text-right text-xs text-muted-foreground">
                          {line.qty_picked ?? 0}
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs text-muted-foreground">
                          {line.qty_shipped ?? 0}
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs text-muted-foreground">
                          {line.qty_invoiced ?? 0}
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="date"
                            className="h-8 text-xs"
                            value={line.due_date ?? ""}
                            disabled={readOnly}
                            onChange={(e) => updateLine(idx, { due_date: e.target.value })}
                          />
                        </td>
                      </>
                    )}
                    {mode === "purchase_order" && (
                      <td className="px-2 py-2.5 text-right text-xs text-muted-foreground">
                        {line.qty_received ?? 0}
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <select
                        className="h-8 w-full rounded-[6px] border bg-background px-2 text-xs"
                        value={line.class_id}
                        disabled={readOnly}
                        onChange={(e) => updateLine(idx, { class_id: e.target.value })}
                      >
                        <option value="">—</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        className="h-8 w-full rounded-[6px] border bg-background px-2 text-xs"
                        value={line.tax_code}
                        disabled={readOnly}
                        onChange={(e) => updateLine(idx, { tax_code: e.target.value })}
                      >
                        {TAX_CODE_OPTIONS.map((t) => (
                          <option key={t.code} value={t.code}>
                            {t.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => updateLine(idx, { expanded: !line.expanded })}
                        className="text-muted-foreground hover:text-primary"
                        title="Line details"
                      >
                        <ArrowRight className={`h-4 w-4 transition-transform ${line.expanded ? "rotate-90" : ""}`} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!readOnly && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-emerald-600 text-emerald-700 hover:bg-emerald-50"
                  onClick={() => onLinesChange([...lines, makeEmptyLine(lines.length)])}
                >
                  <Plus className="mr-1 h-4 w-4" /> Add line
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fillColumn("tax_code")}
                >
                  Fill line tax
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-primary">Shipping/discount tax code</span>
                  <select
                    className="h-8 rounded-[6px] border bg-background px-2 text-xs"
                    value={shippingTaxCode}
                    disabled={readOnly}
                    onChange={(e) => onShippingTaxCodeChange(e.target.value)}
                  >
                    {TAX_CODE_OPTIONS.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-primary">Shipping/discount tax %</span>
                  <Input
                    type="number"
                    className="h-8 w-20 text-right text-xs"
                    value={shippingTaxPct}
                    disabled={readOnly}
                    onChange={(e) => onShippingTaxPctChange(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Section + Totals */}
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-[10px] border bg-card p-4 md:col-span-2">{bottomFields}</div>
          <div className="flex flex-col justify-between rounded-[10px] border bg-card p-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal (net of VAT)</span>
                <span>{peso(taxResult.totalSales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">VAT (12%)</span>
                <span>{peso(taxResult.vatAmount)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-medium">
                <span>Total</span>
                <span>{peso(taxResult.totalAmountDue)}</span>
              </div>
              {ewtAmount > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Less: Creditable Income Tax (EWT)</span>
                  <span>-{peso(ewtAmount)}</span>
                </div>
              )}
              {depositAmount > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Less: Deposit</span>
                  <span>-{peso(depositAmount)}</span>
                </div>
              )}
              {typeof balance === "number" && (
                <div className="flex justify-between border-t pt-2 text-sm font-medium text-primary">
                  <span>Balance due</span>
                  <span>{peso(balance)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
