import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { todayISO } from "@/lib/format";
import { computeTax, type TaxKind } from "@/lib/ph-tax";
import {
  fetchTxnLookups,
  nextDocRef,
  TAX_CODE_OPTIONS,
  writeAuditLog,
} from "@/lib/txn-lookups";
import {
  FloatingField,
  makeInitialLines,
  TransactionForm,
  type TxnFormLine,
  type TxnItemOption,
} from "@/components/TransactionForm";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface PurchaseOrderFormProps {
  poId?: string | undefined;
  onClose: () => void;
  onSaved?: (id: string) => void;
}

export function PurchaseOrderForm({ poId, onClose, onSaved }: PurchaseOrderFormProps) {
  const { company, companyId } = useCompany();
  const qc = useQueryClient();

  const [txnDate, setTxnDate] = useState(todayISO());
  const [refNo, setRefNo] = useState("Assigned upon save");
  const [vendorId, setVendorId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [vendorNotes, setVendorNotes] = useState("");
  const [dropShip, setDropShip] = useState(false);
  const [blanketPo, setBlanketPo] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [vendorAddress, setVendorAddress] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [lines, setLines] = useState<TxnFormLine[]>(() => makeInitialLines(5));
  const [shippingTaxCode, setShippingTaxCode] = useState("12% S");
  const [shippingTaxPct, setShippingTaxPct] = useState(12);
  const [termsId, setTermsId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [shipMethodId, setShipMethodId] = useState("");
  const [comment, setComment] = useState("");
  const [ewtAmount, setEwtAmount] = useState<number>(0);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: lookups } = useQuery({
    queryKey: ["txn-lookups", companyId],
    enabled: !!companyId,
    queryFn: () => fetchTxnLookups(companyId!),
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors-list", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase
        .from("vendors")
        .select("id, name, address, tin, tax_type, default_terms, default_atc")
        .eq("company_id", companyId!)
        .order("name");
      return (data ?? []) as any[];
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["items-list", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase
        .from("items")
        .select("*")
        .eq("company_id", companyId!)
        .order("name");
      return ((data ?? []) as any[]).map((it) => ({
        id: it.id,
        sku: it.sku,
        name: it.name,
        description: it.description ?? null,
        unit_price: Number(it.sale_price ?? it.unit_price ?? 0),
        cost_price: Number(it.cost_price ?? 0),
        uom: it.uom ?? "pcs",
      })) as TxnItemOption[];
    },
  });

  useEffect(() => {
    if (!lookups) return;
    if (!locationId && lookups.locations.length > 0) {
      const matina = lookups.locations.find((l) => l.name.toLowerCase().includes("matina")) ?? lookups.locations[0];
      if (matina) {
        setLocationId(matina.id);
        if (!shippingAddress && (matina as any).address) {
          setShippingAddress((matina as any).address);
        }
      }
    }
    if (!termsId && lookups.terms.length > 0) {
      const net30 = lookups.terms.find((t) => t.name === "Net 30" || t.is_default);
      if (net30) setTermsId(net30.id);
    }
  }, [lookups, locationId, termsId, shippingAddress]);

  useEffect(() => {
    if (!poId || !companyId) return;
    (async () => {
      const { data: txn } = await supabase.from("transactions").select("*").eq("id", poId).maybeSingle();
      if (!txn) return;
      const t = txn as any;
      setTxnDate(t.txn_date ?? todayISO());
      setRefNo(t.ref_no ?? "Assigned upon save");
      setVendorId(t.party_id ?? "");
      setVendorName(t.party_name ?? "");
      setVendorNotes(t.vendor_notes ?? "");
      setDropShip(Boolean(t.drop_ship));
      setBlanketPo(Boolean(t.blanket_po));
      setLocationId(t.location_id ?? "");
      setVendorAddress(t.billing_address ?? "");
      setShippingAddress(t.shipping_address ?? "");
      setTermsId(t.terms_id ?? "");
      setDueDate(t.due_date ?? "");
      setShipMethodId(t.ship_method_id ?? "");
      setComment(t.comment ?? "");
      setEwtAmount(Number(t.ewt_amount ?? 0));

      const { data: txnLines } = await supabase
        .from("transaction_lines")
        .select("*")
        .eq("transaction_id", poId)
        .order("line_no");
      if (txnLines && txnLines.length > 0) {
        setLines(
          (txnLines as any[]).map((l, idx) => ({
            key: `po-line-${idx}-${l.id}`,
            id: l.id,
            item_id: l.item_id ?? "",
            description: l.description ?? "",
            part_no: l.part_no ?? "",
            qty: Number(l.qty ?? 0),
            rate: Number(l.rate ?? 0),
            amount: Number(l.amount ?? 0),
            uom: l.uom ?? "pcs",
            class_id: l.class_id ?? "",
            tax_code: l.tax_code ?? "12% S",
            qty_received: Number(l.qty_received ?? 0),
          })),
        );
      }
    })();
  }, [poId, companyId]);

  const taxResult = useMemo(() => {
    const validLines = lines.filter((l) => l.item_id && l.qty > 0);
    return computeTax(
      validLines.map((l) => {
        const tc = TAX_CODE_OPTIONS.find((o) => o.code === l.tax_code) ?? TAX_CODE_OPTIONS[0]!;
        return { qty: l.qty, rate: l.rate, kind: tc.kind as TaxKind, taxRate: tc.rate };
      }),
      {
        priceMode: "exclusive",
        vatRegistered: company?.vat_registered ?? true,
        percentageTaxRate: 3,
        discountType: "none",
        discountRate: 0,
        ewtRate: 0,
      },
    );
  }, [lines, company?.vat_registered]);

  const handleSave = async (closeAfter: boolean) => {
    if (!companyId) return;
    const nextErrors: Record<string, string> = {};
    if (!vendorId) nextErrors["vendor"] = "Vendor is required";
    const validLines = lines.filter((l) => l.item_id && l.qty > 0);
    if (validLines.length === 0) nextErrors["lines"] = "At least one line with item and qty > 0 is required";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error(Object.values(nextErrors)[0]);
      return;
    }

    setSaving(true);
    try {
      let finalRef = refNo;
      if (!poId || refNo === "Assigned upon save") {
        const seq = await nextDocRef(companyId, "purchase_order", "PO-");
        finalRef = seq.refNo;
      }

      const payload: Record<string, unknown> = {
        company_id: companyId,
        type: "purchase_order",
        ref_no: finalRef,
        txn_date: txnDate,
        due_date: dueDate || null,
        party_id: vendorId,
        party_name: vendorName,
        location_id: locationId || null,
        status: "open",
        approved: false,
        drop_ship: dropShip,
        blanket_po: blanketPo,
        subtotal: taxResult.totalSales,
        tax_amount: taxResult.vatAmount,
        total: taxResult.totalAmountDue,
        amount_due: taxResult.totalAmountDue,
        billing_address: vendorAddress,
        shipping_address: shippingAddress,
        vendor_notes: vendorNotes,
        terms_id: termsId && termsId.length > 20 ? termsId : null,
        ship_method_id: shipMethodId && shipMethodId.length > 20 ? shipMethodId : null,
        comment: comment || null,
        ewt_amount: ewtAmount,
        shipping_tax_code: shippingTaxCode,
        shipping_tax_pct: shippingTaxPct,
      };

      let savedId = poId;
      if (poId) {
        const { error } = await supabase.from("transactions").update(payload as any).eq("id", poId);
        if (error) throw error;
        await supabase.from("transaction_lines").delete().eq("transaction_id", poId);
      } else {
        const { data: inserted, error } = await supabase
          .from("transactions")
          .insert(payload as any)
          .select("id")
          .single();
        if (error) throw error;
        savedId = inserted.id;
      }

      const lineRows = validLines.map((l, idx) => ({
        transaction_id: savedId,
        line_no: idx + 1,
        item_id: l.item_id,
        description: l.description,
        part_no: l.part_no || null,
        qty: l.qty,
        uom: l.uom,
        rate: l.rate,
        amount: l.amount,
        class_id: l.class_id && l.class_id.length > 20 ? l.class_id : null,
        tax_code: l.tax_code,
      }));
      const { error: lineErr } = await supabase.from("transaction_lines").insert(lineRows as any);
      if (lineErr) throw lineErr;

      await writeAuditLog(companyId, poId ? "update" : "create", "purchase_order", savedId!, { ref_no: finalRef });
      await qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success(`Purchase order ${finalRef} saved`);
      setRefNo(finalRef);
      setDirty(false);
      if (closeAfter) onClose();
      else onSaved?.(savedId!);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save purchase order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <TransactionForm
      title="Purchase order"
      mode="purchase_order"
      dirty={dirty}
      saving={saving}
      onClose={onClose}
      onSave={handleSave}
      billingLabel="Vendor address"
      billingAddress={vendorAddress}
      onBillingAddressChange={(v) => {
        setVendorAddress(v);
        setDirty(true);
      }}
      shippingAddress={shippingAddress}
      onShippingAddressChange={(v) => {
        setShippingAddress(v);
        setDirty(true);
      }}
      lines={lines}
      onLinesChange={(next) => {
        setLines(next);
        setDirty(true);
      }}
      items={items}
      classes={lookups?.classes ?? []}
      taxResult={taxResult}
      shippingTaxCode={shippingTaxCode}
      onShippingTaxCodeChange={setShippingTaxCode}
      shippingTaxPct={shippingTaxPct}
      onShippingTaxPctChange={setShippingTaxPct}
      ewtAmount={ewtAmount}
      topFields={
        <div className="grid gap-4 md:grid-cols-5">
          <FloatingField label="Date" required>
            <Input
              type="date"
              value={txnDate}
              onChange={(e) => {
                setTxnDate(e.target.value);
                setDirty(true);
              }}
            />
          </FloatingField>
          <FloatingField label="Purchase order reference #">
            <Input value={refNo} readOnly className="bg-muted/40" />
          </FloatingField>
          <FloatingField label="Vendor" required error={errors["vendor"]}>
            <select
              className="h-9 w-full rounded-[6px] border bg-background px-2.5 text-sm"
              value={vendorId}
              onChange={(e) => {
                const id = e.target.value;
                setVendorId(id);
                setDirty(true);
                const v = vendors.find((x) => x.id === id);
                if (v) {
                  setVendorName(v.name);
                  setVendorAddress(v.address ?? "");
                }
              }}
            >
              <option value="">Select vendor...</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Location">
            <select
              className="h-9 w-full rounded-[6px] border bg-background px-2.5 text-sm"
              value={locationId}
              onChange={(e) => {
                const id = e.target.value;
                setLocationId(id);
                const loc = lookups?.locations.find((l) => l.id === id) as any;
                if (loc?.address && !dropShip) setShippingAddress(loc.address);
                setDirty(true);
              }}
            >
              <option value="">Select location...</option>
              {(lookups?.locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Vendor notes">
            <Input
              value={vendorNotes}
              onChange={(e) => {
                setVendorNotes(e.target.value);
                setDirty(true);
              }}
            />
          </FloatingField>
          <div className="flex items-center gap-4 md:col-span-5">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={dropShip}
                onCheckedChange={(v) => {
                  setDropShip(Boolean(v));
                  setDirty(true);
                }}
              />
              Drop ship
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={blanketPo}
                onCheckedChange={(v) => {
                  setBlanketPo(Boolean(v));
                  setDirty(true);
                }}
              />
              Blanket PO
            </label>
          </div>
        </div>
      }
      bottomFields={
        <div className="grid gap-4 md:grid-cols-3">
          <FloatingField label="Terms">
            <select
              className="h-9 w-full rounded-[6px] border bg-background px-2.5 text-sm"
              value={termsId}
              onChange={(e) => {
                setTermsId(e.target.value);
                setDirty(true);
              }}
            >
              {(lookups?.terms ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Expected / due date">
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                setDirty(true);
              }}
            />
          </FloatingField>
          <FloatingField label="Ship method">
            <select
              className="h-9 w-full rounded-[6px] border bg-background px-2.5 text-sm"
              value={shipMethodId}
              onChange={(e) => {
                setShipMethodId(e.target.value);
                setDirty(true);
              }}
            >
              <option value="">Select ship method...</option>
              {(lookups?.shipMethods ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="EWT (Creditable Income Tax)">
            <Input
              type="number"
              min="0"
              step="any"
              value={ewtAmount || ""}
              onChange={(e) => {
                setEwtAmount(parseFloat(e.target.value) || 0);
                setDirty(true);
              }}
            />
          </FloatingField>
          <div className="md:col-span-2">
            <FloatingField label="Comment">
              <Textarea
                rows={2}
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  setDirty(true);
                }}
              />
            </FloatingField>
          </div>
        </div>
      }
    />
  );
}
