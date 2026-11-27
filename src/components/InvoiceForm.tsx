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
import { downloadBirPdf } from "@/components/BirInvoicePdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface InvoiceFormProps {
  invoiceId?: string | undefined;
  fromSoId?: string | undefined;
  onClose: () => void;
  onSaved?: (id: string) => void;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate || todayISO());
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function InvoiceForm({ invoiceId, fromSoId, onClose, onSaved }: InvoiceFormProps) {
  const { company, companyId } = useCompany();
  const qc = useQueryClient();

  const [txnDate, setTxnDate] = useState(todayISO());
  const [refNo, setRefNo] = useState("Assigned upon save");
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [locationId, setLocationId] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [priceTier, setPriceTier] = useState("List Price");
  const [lines, setLines] = useState<TxnFormLine[]>(() => makeInitialLines(5));
  const [shippingTaxCode, setShippingTaxCode] = useState("12% S");
  const [shippingTaxPct, setShippingTaxPct] = useState(12);

  const [termsId, setTermsId] = useState("");
  const [dueDate, setDueDate] = useState(() => addDays(todayISO(), 30));
  const [shipDate, setShipDate] = useState("");
  const [salesRepId, setSalesRepId] = useState("");
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [depositPct, setDepositPct] = useState<number>(0);
  const [shipMethodId, setShipMethodId] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [channelId, setChannelId] = useState("");
  const [customerPo, setCustomerPo] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [comment, setComment] = useState("");
  const [signature, setSignature] = useState("");
  const [ewtAmount, setEwtAmount] = useState<number>(0);
  const [ewtAtc, setEwtAtc] = useState("");
  const [voided, setVoided] = useState(false);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: lookups } = useQuery({
    queryKey: ["txn-lookups", companyId],
    enabled: !!companyId,
    queryFn: () => fetchTxnLookups(companyId!),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers-list", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, address, shipping_address, tin, tax_type, default_terms, default_atc")
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

  // Default location to Matina Warehouse & default terms to Net 30
  useEffect(() => {
    if (!lookups) return;
    if (!locationId && lookups.locations.length > 0) {
      const matina = lookups.locations.find((l) => l.name.toLowerCase().includes("matina")) ?? lookups.locations[0];
      if (matina) setLocationId(matina.id);
    }
    if (!termsId && lookups.terms.length > 0) {
      const net30 = lookups.terms.find((t) => t.name === "Net 30" || t.is_default);
      if (net30) setTermsId(net30.id);
    }
  }, [lookups, locationId, termsId]);

  // Load existing invoice or parent SO
  useEffect(() => {
    const loadId = invoiceId || fromSoId;
    if (!loadId || !companyId) return;
    (async () => {
      const { data: txn } = await supabase
        .from("transactions")
        .select("*")
        .eq("id", loadId)
        .maybeSingle();
      if (!txn) return;
      const t = txn as any;
      if (invoiceId) {
        setTxnDate(t.txn_date ?? todayISO());
        setRefNo(t.ref_no ?? "Assigned upon save");
        setVoided(Boolean(t.voided));
      }
      setCustomerId(t.party_id ?? "");
      setCustomerName(t.party_name ?? "");
      setCustomerNotes(t.customer_notes ?? "");
      setLocationId(t.location_id ?? "");
      setBillingAddress(t.billing_address ?? "");
      setShippingAddress(t.shipping_address ?? "");
      setPriceTier(t.price_tier ?? "List Price");
      setTermsId(t.terms_id ?? "");
      setDueDate(t.due_date ?? addDays(todayISO(), 30));
      setShipDate(t.ship_date ?? "");
      setSalesRepId(t.sales_rep_id ?? "");
      setDepositAmount(Number(t.deposit_amount ?? 0));
      setDepositPct(Number(t.deposit_pct ?? 0));
      setShipMethodId(t.ship_method_id ?? "");
      setTrackingNo(t.tracking_no ?? "");
      setChannelId(t.channel_id ?? "");
      setCustomerPo(t.customer_po ?? "");
      setDepartmentId(t.department_id ?? "");
      setCustomerMessage(t.customer_message ?? "");
      setComment(t.comment ?? "");
      setSignature(t.signature ?? "");
      setEwtAmount(Number(t.ewt_amount ?? 0));
      setEwtAtc(t.ewt_atc ?? "");

      const { data: txnLines } = await supabase
        .from("transaction_lines")
        .select("*")
        .eq("transaction_id", loadId)
        .order("line_no");
      if (txnLines && txnLines.length > 0) {
        setLines(
          (txnLines as any[]).map((l, idx) => ({
            key: `loaded-${idx}-${l.id}`,
            id: invoiceId ? l.id : undefined,
            item_id: l.item_id ?? "",
            description: l.description ?? "",
            qty: fromSoId ? Math.max(0, Number(l.qty ?? 0) - Number(l.qty_invoiced ?? 0)) : Number(l.qty ?? 0),
            rate: Number(l.rate ?? 0),
            amount: Number(l.amount ?? 0),
            uom: l.uom ?? "pcs",
            class_id: l.class_id ?? "",
            tax_code: l.tax_code ?? "12% S",
          })),
        );
      }
    })();
  }, [invoiceId, fromSoId, companyId]);

  const handleCustomerChange = (id: string) => {
    setCustomerId(id);
    setDirty(true);
    const c = customers.find((x) => x.id === id);
    if (c) {
      setCustomerName(c.name);
      setBillingAddress(c.address ?? "");
      setShippingAddress(c.shipping_address ?? c.address ?? "");
      if (c.default_atc) setEwtAtc(c.default_atc);
    }
  };

  const handleTermsChange = (id: string) => {
    setTermsId(id);
    setDirty(true);
    const t = lookups?.terms.find((x) => x.id === id);
    if (t && typeof t.days === "number") {
      setDueDate(addDays(txnDate, t.days));
    }
  };

  const taxResult = useMemo(() => {
    const validLines = lines.filter((l) => l.item_id && l.qty > 0);
    return computeTax(
      validLines.map((l) => {
        const tc = TAX_CODE_OPTIONS.find((o) => o.code === l.tax_code) ?? TAX_CODE_OPTIONS[0]!;
        return {
          qty: l.qty,
          rate: l.rate,
          kind: tc.kind as TaxKind,
          taxRate: tc.rate,
        };
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

  const computedDeposit =
    depositPct > 0
      ? Math.round(((taxResult.totalAmountDue * depositPct) / 100 + Number.EPSILON) * 100) / 100
      : depositAmount;
  const balance = Math.max(0, Math.round((taxResult.totalAmountDue - computedDeposit - ewtAmount + Number.EPSILON) * 100) / 100);

  const handleSave = async (closeAfter: boolean) => {
    if (!companyId) return;
    const nextErrors: Record<string, string> = {};
    if (!customerId) nextErrors["customer"] = "Customer is required";
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
      let birSeries: number | null = null;
      if (!invoiceId || refNo === "Assigned upon save") {
        const seq = await nextDocRef(companyId, "invoice", "INV-");
        finalRef = seq.refNo;
        birSeries = seq.seriesNo;
      }

      const payload: Record<string, unknown> = {
        company_id: companyId,
        type: "invoice",
        ref_no: finalRef,
        ...(birSeries ? { bir_series_no: birSeries } : {}),
        txn_date: txnDate,
        due_date: dueDate || null,
        party_id: customerId,
        party_name: customerName,
        location_id: locationId || null,
        parent_txn_id: fromSoId || null,
        status: balance <= 0 ? "paid" : "open",
        qb_sync_status: "unsent",
        subtotal: taxResult.totalSales,
        tax_amount: taxResult.vatAmount,
        total: taxResult.totalAmountDue,
        amount_due: balance,
        balance,
        billing_address: billingAddress,
        shipping_address: shippingAddress,
        price_tier: priceTier,
        customer_notes: customerNotes,
        terms_id: termsId && termsId.length > 20 ? termsId : null,
        sales_rep_id: salesRepId && salesRepId.length > 20 ? salesRepId : null,
        ship_method_id: shipMethodId && shipMethodId.length > 20 ? shipMethodId : null,
        channel_id: channelId && channelId.length > 20 ? channelId : null,
        department_id: departmentId && departmentId.length > 20 ? departmentId : null,
        ship_date: shipDate || null,
        tracking_no: trackingNo || null,
        customer_po: customerPo || null,
        deposit_amount: computedDeposit,
        deposit_pct: depositPct,
        customer_message: customerMessage || null,
        comment: comment || null,
        signature: signature || null,
        ewt_amount: ewtAmount,
        ewt_atc: ewtAtc || null,
        shipping_tax_code: shippingTaxCode,
        shipping_tax_pct: shippingTaxPct,
      };

      let savedId = invoiceId;
      if (invoiceId) {
        const { error } = await supabase.from("transactions").update(payload as any).eq("id", invoiceId);
        if (error) throw error;
        await supabase.from("transaction_lines").delete().eq("transaction_id", invoiceId);
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
        qty: l.qty,
        uom: l.uom,
        rate: l.rate,
        amount: l.amount,
        class_id: l.class_id && l.class_id.length > 20 ? l.class_id : null,
        tax_code: l.tax_code,
      }));
      const { error: lineErr } = await supabase.from("transaction_lines").insert(lineRows as any);
      if (lineErr) throw lineErr;

      // Update parent SO qty_invoiced if created from SO
      if (fromSoId) {
        const { data: soLines } = await supabase
          .from("transaction_lines")
          .select("id, item_id, qty_invoiced")
          .eq("transaction_id", fromSoId);
        for (const l of validLines) {
          const match = (soLines as any[])?.find((sl) => sl.item_id === l.item_id);
          if (match) {
            await supabase
              .from("transaction_lines")
              .update({ qty_invoiced: Number(match.qty_invoiced ?? 0) + l.qty } as any)
              .eq("id", match.id);
          }
        }
      }

      await writeAuditLog(companyId, invoiceId ? "update" : "create", "invoice", savedId!, { ref_no: finalRef });
      await qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(`Invoice ${finalRef} saved`);
      setRefNo(finalRef);
      setDirty(false);
      if (closeAfter) onClose();
      else onSaved?.(savedId!);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save invoice");
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    if (!company) return;
    const c = customers.find((x) => x.id === customerId);
    void downloadBirPdf(company, {
      docType: "invoice",
      refNo,
      birSeriesNo: null,
      txnDate,
      dueDate,
      partyName: customerName,
      partyTin: c?.tin ?? "",
      partyAddress: billingAddress,
      taxableSales: taxResult.vatableSales,
      vatExemptSales: taxResult.vatExemptSales,
      zeroRatedSales: taxResult.zeroRatedSales,
      vatAmount: taxResult.vatAmount,
      ewtAmount,
      total: taxResult.totalAmountDue,
      voided,
      lines: lines
        .filter((l) => l.item_id && l.qty > 0)
        .map((l) => ({
          description: l.description,
          qty: l.qty,
          uom: l.uom,
          rate: l.rate,
          amount: l.amount,
        })),
    } as any);
  };

  return (
    <TransactionForm
      title={voided ? `Invoice ${refNo} (Voided)` : "Invoice"}
      mode="invoice"
      readOnly={voided}
      dirty={dirty}
      saving={saving}
      onClose={onClose}
      onSave={handleSave}
      onPrint={handlePrint}
      billingAddress={billingAddress}
      onBillingAddressChange={(v) => {
        setBillingAddress(v);
        setDirty(true);
      }}
      shippingAddress={shippingAddress}
      onShippingAddressChange={(v) => {
        setShippingAddress(v);
        setDirty(true);
      }}
      onSameAsBilling={() => {
        setShippingAddress(billingAddress);
        setDirty(true);
      }}
      priceTier={priceTier}
      onPriceTierChange={(t) => {
        setPriceTier(t);
        setDirty(true);
      }}
      onApplyPriceTier={() => toast.info(`Applied ${priceTier} pricing`)}
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
      depositAmount={computedDeposit}
      balance={balance}
      topFields={
        <div className="grid gap-4 md:grid-cols-5">
          <FloatingField label="Date" required>
            <Input
              type="date"
              value={txnDate}
              disabled={voided}
              onChange={(e) => {
                setTxnDate(e.target.value);
                setDirty(true);
              }}
            />
          </FloatingField>
          <FloatingField label="Invoice reference #">
            <Input value={refNo} readOnly className="bg-muted/40" />
          </FloatingField>
          <FloatingField label="Customer" required error={errors["customer"]}>
            <select
              className="h-9 w-full rounded-[6px] border bg-background px-2.5 text-sm"
              value={customerId}
              disabled={voided}
              onChange={(e) => handleCustomerChange(e.target.value)}
            >
              <option value="">Select customer...</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Location">
            <select
              className="h-9 w-full rounded-[6px] border bg-background px-2.5 text-sm"
              value={locationId}
              disabled={voided}
              onChange={(e) => {
                setLocationId(e.target.value);
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
          <FloatingField label="Customer notes">
            <Input
              value={customerNotes}
              disabled={voided}
              onChange={(e) => {
                setCustomerNotes(e.target.value);
                setDirty(true);
              }}
              placeholder="Internal notes..."
            />
          </FloatingField>
        </div>
      }
      bottomFields={
        <div className="grid gap-4 md:grid-cols-3">
          <FloatingField label="Terms">
            <select
              className="h-9 w-full rounded-[6px] border bg-background px-2.5 text-sm"
              value={termsId}
              disabled={voided}
              onChange={(e) => handleTermsChange(e.target.value)}
            >
              {(lookups?.terms ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Due date">
            <Input
              type="date"
              value={dueDate}
              disabled={voided}
              onChange={(e) => {
                setDueDate(e.target.value);
                setDirty(true);
              }}
            />
          </FloatingField>
          <FloatingField label="Ship date">
            <Input
              type="date"
              value={shipDate}
              disabled={voided}
              onChange={(e) => {
                setShipDate(e.target.value);
                setDirty(true);
              }}
            />
          </FloatingField>
          <FloatingField label="Sales rep">
            <select
              className="h-9 w-full rounded-[6px] border bg-background px-2.5 text-sm"
              value={salesRepId}
              disabled={voided}
              onChange={(e) => {
                setSalesRepId(e.target.value);
                setDirty(true);
              }}
            >
              <option value="">Select sales rep...</option>
              {(lookups?.salesReps ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Deposit amount (₱)">
            <Input
              type="number"
              min="0"
              step="any"
              value={depositAmount || ""}
              disabled={voided || depositPct > 0}
              onChange={(e) => {
                setDepositAmount(parseFloat(e.target.value) || 0);
                setDepositPct(0);
                setDirty(true);
              }}
            />
          </FloatingField>
          <FloatingField label="Deposit %">
            <Input
              type="number"
              min="0"
              max="100"
              step="any"
              value={depositPct || ""}
              disabled={voided || depositAmount > 0}
              onChange={(e) => {
                setDepositPct(parseFloat(e.target.value) || 0);
                setDepositAmount(0);
                setDirty(true);
              }}
            />
          </FloatingField>
          <FloatingField label="Ship method">
            <select
              className="h-9 w-full rounded-[6px] border bg-background px-2.5 text-sm"
              value={shipMethodId}
              disabled={voided}
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
          <FloatingField label="Tracking number">
            <Input
              value={trackingNo}
              disabled={voided}
              onChange={(e) => {
                setTrackingNo(e.target.value);
                setDirty(true);
              }}
            />
          </FloatingField>
          <FloatingField label="Channel">
            <select
              className="h-9 w-full rounded-[6px] border bg-background px-2.5 text-sm"
              value={channelId}
              disabled={voided}
              onChange={(e) => {
                setChannelId(e.target.value);
                setDirty(true);
              }}
            >
              <option value="">Select channel...</option>
              {(lookups?.channels ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Customer PO">
            <Input
              value={customerPo}
              disabled={voided}
              onChange={(e) => {
                setCustomerPo(e.target.value);
                setDirty(true);
              }}
            />
          </FloatingField>
          <FloatingField label="Department">
            <select
              className="h-9 w-full rounded-[6px] border bg-background px-2.5 text-sm"
              value={departmentId}
              disabled={voided}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setDirty(true);
              }}
            >
              <option value="">Select department...</option>
              {(lookups?.departments ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </FloatingField>
          <FloatingField label="Creditable Income Tax Withheld (EWT)">
            <Input
              type="number"
              min="0"
              step="any"
              value={ewtAmount || ""}
              disabled={voided}
              onChange={(e) => {
                setEwtAmount(parseFloat(e.target.value) || 0);
                setDirty(true);
              }}
            />
          </FloatingField>
          <div className="md:col-span-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[12px] font-medium text-primary">Customer message</span>
              {!voided && (lookups?.messages ?? []).length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-primary"
                  onClick={() => {
                    const msg = lookups?.messages[0]?.body ?? "Thank you for your business!";
                    setCustomerMessage((prev) => (prev ? `${prev}\n${msg}` : msg));
                    setDirty(true);
                  }}
                >
                  Predefined messages
                </Button>
              )}
            </div>
            <Textarea
              rows={2}
              value={customerMessage}
              disabled={voided}
              onChange={(e) => {
                setCustomerMessage(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div className="md:col-span-2">
            <FloatingField label="Comment">
              <Textarea
                rows={2}
                value={comment}
                disabled={voided}
                onChange={(e) => {
                  setComment(e.target.value);
                  setDirty(true);
                }}
              />
            </FloatingField>
          </div>
          <div className="flex items-end">
            {signature ? (
              <div className="text-xs text-muted-foreground">Signed: {signature}</div>
            ) : (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => {
                  const sig = window.prompt("Enter signature name:");
                  if (sig) {
                    setSignature(sig);
                    setDirty(true);
                  }
                }}
              >
                No signature (add signature)
              </button>
            )}
          </div>
        </div>
      }
    />
  );
}
