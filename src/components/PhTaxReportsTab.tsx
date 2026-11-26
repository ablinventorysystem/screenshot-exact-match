import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate, peso } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function downloadText(filename: string, content: string, mime = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
}

export function PhTaxReportsTab({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const { company, companyId } = useCompany();
  const [sub, setSub] = useState<"sls" | "slp" | "vat" | "ewt" | "pct">("sls");
  const [datKind, setDatKind] = useState<"sales" | "purchases" | null>(null);
  const [delimiter, setDelimiter] = useState<"," | "|">(",");
  const [colOrder, setColOrder] = useState("tin,name,address,exempt,zero,taxable,vat,gross");

  const q = useQuery({
    queryKey: ["ph_tax_reports", companyId, fromDate, toDate],
    enabled: !!companyId,
    queryFn: async () => {
      const [{ data: txns }, { data: custs }, { data: vends }] = await Promise.all([
        supabase
          .from("transactions")
          .select("*")
          .eq("company_id", companyId)
          .eq("voided", false)
          .gte("txn_date", fromDate)
          .lte("txn_date", toDate)
          .order("txn_date", { ascending: false }),
        supabase.from("customers").select("id, name, registered_name, tin, registered_address").eq("company_id", companyId),
        supabase.from("vendors").select("id, name, registered_name, tin, registered_address").eq("company_id", companyId),
      ]);
      const cmap = new Map((custs ?? []).map((c) => [c.id, c]));
      const vmap = new Map((vends ?? []).map((v) => [v.id, v]));
      return { txns: txns ?? [], cmap, vmap };
    },
  });

  const slsRows = useMemo(() => {
    const txns = (q.data?.txns ?? []).filter((t) => t.type === "invoice" || t.type === "sales_receipt" || t.type === "credit_memo");
    return txns.map((t) => {
      const c = t.party_id ? q.data?.cmap.get(t.party_id) : undefined;
      const taxable = Number(t.vatable_sales);
      const exempt = Number(t.vat_exempt_sales);
      const zero = Number(t.zero_rated_sales);
      const vat = Number(t.vat_amount);
      return {
        id: t.id,
        date: t.txn_date,
        ref: t.ref_no,
        tin: c?.tin ?? "",
        name: c?.registered_name || t.party_name || "",
        address: c?.registered_address ?? "",
        exempt,
        zero,
        taxable,
        vat,
        gross: taxable + exempt + zero + vat,
        pctTax: Number(t.percentage_tax_amount ?? 0),
      };
    });
  }, [q.data]);

  const slpRows = useMemo(() => {
    const bills = (q.data?.txns ?? []).filter((t) => t.type === "bill");
    return bills.map((t) => {
      const v = t.party_id ? q.data?.vmap.get(t.party_id) : undefined;
      const taxable = Number(t.vatable_sales);
      const exempt = Number(t.vat_exempt_sales);
      const zero = Number(t.zero_rated_sales);
      const vat = Number(t.input_vat_amount ?? 0);
      return {
        id: t.id,
        date: t.txn_date,
        ref: t.ref_no,
        tin: v?.tin ?? "",
        name: v?.registered_name || t.party_name || "",
        address: v?.registered_address ?? "",
        exempt,
        zero,
        taxable,
        vat,
        claimable: t.input_vat_claimable,
        gross: taxable + exempt + zero + vat,
      };
    });
  }, [q.data]);

  const ewtSummary = useMemo(() => {
    const txns = (q.data?.txns ?? []).filter((t) => (t.type === "payment" || t.type === "bill") && Number(t.ewt_amount) > 0);
    const byAtc = new Map<string, { atc: string; dir: string; base: number; withheld: number; count: number }>();
    const payees: { tin: string; name: string; atc: string; dir: string; base: number; withheld: number }[] = [];

    for (const t of txns) {
      const dir = t.type === "bill" ? "Issued (Vendor)" : "Received (Customer)";
      const atc = t.ewt_atc || "WC010";
      const base = Number(t.vatable_sales) + Number(t.vat_exempt_sales) + Number(t.zero_rated_sales);
      const withheld = Number(t.ewt_amount);
      const key = `${dir}::${atc}`;
      const cur = byAtc.get(key) ?? { atc, dir, base: 0, withheld: 0, count: 0 };
      cur.base += base;
      cur.withheld += withheld;
      cur.count += 1;
      byAtc.set(key, cur);

      const party = t.type === "bill"
        ? (t.party_id ? q.data?.vmap.get(t.party_id) : undefined)
        : (t.party_id ? q.data?.cmap.get(t.party_id) : undefined);
      payees.push({
        tin: party?.tin ?? "",
        name: party?.registered_name || t.party_name || "",
        atc,
        dir,
        base,
        withheld,
      });
    }
    return { byAtc: Array.from(byAtc.values()), payees };
  }, [q.data]);

  const outVat = slsRows.reduce((s, r) => s + r.vat, 0);
  const inVatClaimable = slpRows.filter((r) => r.claimable).reduce((s, r) => s + r.vat, 0);
  const netVatPayable = outVat - inVatClaimable;
  const nonVatSales = slsRows.reduce((s, r) => s + r.taxable + r.exempt, 0);
  const pctTaxDue = (q.data?.txns ?? []).filter((t) => t.type === "invoice" || t.type === "sales_receipt").reduce((s, t) => s + Number(t.percentage_tax_amount ?? 0), 0);

  const buildDatPreview = (kind: "sales" | "purchases") => {
    const rows = kind === "sales" ? slsRows : slpRows;
    const cols = colOrder.split(",").map((c) => c.trim()).filter(Boolean);
    const header = `H,${kind.toUpperCase()},${company?.tin ?? "000-000-000-00000"},${company?.name ?? ""},${fromDate},${toDate}`;
    const body = rows.map((r) => {
      const map: Record<string, string> = {
        tin: r.tin.replace(/-/g, ""),
        name: r.name,
        address: r.address,
        exempt: r.exempt.toFixed(2),
        zero: r.zero.toFixed(2),
        taxable: r.taxable.toFixed(2),
        vat: r.vat.toFixed(2),
        gross: r.gross.toFixed(2),
      };
      return cols.map((c) => map[c] ?? "").join(delimiter);
    });
    return [header, ...body].join("\n");
  };

  const exportAlphalistCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head = ["TIN", "Registered Name", "Direction", "ATC", "Income Base", "Tax Withheld"].map(esc).join(",");
    const rows = ewtSummary.payees.map((p) =>
      [p.tin, p.name, p.dir, p.atc, p.base.toFixed(2), p.withheld.toFixed(2)].map(esc).join(","),
    );
    downloadText(`alphalist-ewt-${fromDate}-${toDate}.csv`, [head, ...rows].join("\n"));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={sub === "sls" ? "default" : "outline"} onClick={() => setSub("sls")}>Summary List of Sales (SLS)</Button>
        <Button size="sm" variant={sub === "slp" ? "default" : "outline"} onClick={() => setSub("slp")}>Summary List of Purchases (SLP)</Button>
        <Button size="sm" variant={sub === "vat" ? "default" : "outline"} onClick={() => setSub("vat")}>2550M/Q VAT Worksheet</Button>
        <Button size="sm" variant={sub === "ewt" ? "default" : "outline"} onClick={() => setSub("ewt")}>Withholding (ATC &amp; Alphalist)</Button>
        <Button size="sm" variant={sub === "pct" ? "default" : "outline"} onClick={() => setSub("pct")}>Percentage Tax (Non-VAT)</Button>
      </div>

      {sub === "sls" && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Summary List of Sales (SLS)</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setDatKind("sales")}>
                <Eye className="mr-1.5 h-4 w-4" />
                RELIEF .DAT Export
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const csv = ["Date,Ref,TIN,Name,Exempt,Zero-Rated,Taxable,Output VAT,Gross", ...slsRows.map((r) => `${r.date},${r.ref},"${r.tin}","${r.name}",${r.exempt.toFixed(2)},${r.zero.toFixed(2)},${r.taxable.toFixed(2)},${r.vat.toFixed(2)},${r.gross.toFixed(2)}`)].join("\n");
                  downloadText(`sls-${fromDate}-${toDate}.csv`, csv);
                }}
              >
                <Download className="mr-1.5 h-4 w-4" />
                CSV
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Date</th><th className="py-2">Ref #</th><th className="py-2">TIN</th><th className="py-2">Buyer</th>
                  <th className="py-2 text-right">Exempt</th><th className="py-2 text-right">Zero-Rated</th><th className="py-2 text-right">Taxable</th><th className="py-2 text-right">Output VAT</th><th className="py-2 text-right">Gross</th>
                </tr>
              </thead>
              <tbody>
                {slsRows.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="py-1.5">{fmtDate(r.date)}</td><td>{r.ref}</td><td>{r.tin || "—"}</td><td>{r.name}</td>
                    <td className="text-right">₱{peso(r.exempt)}</td><td className="text-right">₱{peso(r.zero)}</td>
                    <td className="text-right">₱{peso(r.taxable)}</td><td className="text-right">₱{peso(r.vat)}</td>
                    <td className="text-right font-medium">₱{peso(r.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sub === "slp" && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Summary List of Purchases (SLP)</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setDatKind("purchases")}>
                <Eye className="mr-1.5 h-4 w-4" />
                RELIEF .DAT Export
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const csv = ["Date,Ref,TIN,Vendor,Exempt,Zero-Rated,Taxable,Input VAT,Claimable,Gross", ...slpRows.map((r) => `${r.date},${r.ref},"${r.tin}","${r.name}",${r.exempt.toFixed(2)},${r.zero.toFixed(2)},${r.taxable.toFixed(2)},${r.vat.toFixed(2)},${r.claimable},${r.gross.toFixed(2)}`)].join("\n");
                  downloadText(`slp-${fromDate}-${toDate}.csv`, csv);
                }}
              >
                <Download className="mr-1.5 h-4 w-4" />
                CSV
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Date</th><th className="py-2">Bill #</th><th className="py-2">TIN</th><th className="py-2">Supplier</th>
                  <th className="py-2 text-right">Taxable</th><th className="py-2 text-right">Input VAT</th><th className="py-2">Mode</th><th className="py-2 text-right">Gross</th>
                </tr>
              </thead>
              <tbody>
                {slpRows.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="py-1.5">{fmtDate(r.date)}</td><td>{r.ref}</td><td>{r.tin || "—"}</td><td>{r.name}</td>
                    <td className="text-right">₱{peso(r.taxable)}</td><td className="text-right">₱{peso(r.vat)}</td>
                    <td><Badge variant={r.claimable ? "secondary" : "outline"}>{r.claimable ? "Claimable" : "Capitalized"}</Badge></td>
                    <td className="text-right font-medium">₱{peso(r.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sub === "vat" && (
        <div className="max-w-xl rounded-lg border bg-card p-5 space-y-2 text-sm">
          <h3 className="font-medium text-base">BIR Form 2550M / 2550Q VAT Summary Worksheet</h3>
          <div className="flex justify-between py-1"><span>Total Output VAT (Sales)</span><span>₱{peso(outVat)}</span></div>
          <div className="flex justify-between py-1"><span>Less: Claimable Input VAT (Purchases)</span><span>-₱{peso(inVatClaimable)}</span></div>
          <div className="flex justify-between border-t pt-2 font-medium text-base">
            <span>{netVatPayable >= 0 ? "Net VAT Payable" : "Excess Input VAT Carry-Over"}</span>
            <span>₱{peso(Math.abs(netVatPayable))}</span>
          </div>
        </div>
      )}

      {sub === "ewt" && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Withholding Summary by ATC (Form 2307 Received &amp; Issued)</h3>
            <Button size="sm" variant="outline" onClick={exportAlphalistCsv}>
              <Download className="mr-1.5 h-4 w-4" />
              Alphalist Payee CSV
            </Button>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2">Direction</th><th className="py-2">ATC</th><th className="py-2 text-right">Txns</th><th className="py-2 text-right">Income Base</th><th className="py-2 text-right">Tax Withheld</th>
              </tr>
            </thead>
            <tbody>
              {ewtSummary.byAtc.map((r, i) => (
                <tr key={i} className="border-b">
                  <td className="py-1.5">{r.dir}</td><td className="font-medium">{r.atc}</td>
                  <td className="text-right">{r.count}</td><td className="text-right">₱{peso(r.base)}</td><td className="text-right font-medium">₱{peso(r.withheld)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === "pct" && (
        <div className="max-w-xl rounded-lg border bg-card p-5 space-y-2 text-sm">
          <h3 className="font-medium text-base">Percentage Tax Summary (2551Q — Non-VAT Mode)</h3>
          <div className="flex justify-between py-1"><span>Seller Tax Mode</span><Badge variant="outline">{company?.vat_registered ? "VAT-Registered" : "Non-VAT (3% Percentage Tax)"}</Badge></div>
          <div className="flex justify-between py-1"><span>Gross Non-VAT Sales</span><span>₱{peso(nonVatSales)}</span></div>
          <div className="flex justify-between border-t pt-2 font-medium text-base"><span>Percentage Tax Due ({company?.percentage_tax_rate ?? 3}%)</span><span>₱{peso(pctTaxDue)}</span></div>
        </div>
      )}

      <Dialog open={!!datKind} onOpenChange={(o) => !o && setDatKind(null)}>
        <DialogContent className="max-w-2xl rounded-lg">
          <DialogHeader>
            <DialogTitle>BIR eSubmission / RELIEF .DAT Export ({datKind?.toUpperCase()})</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="dat-cols">Column Mapping</Label>
                <Input id="dat-cols" value={colOrder} onChange={(e) => setColOrder(e.target.value)} className="mt-1 rounded-md text-xs" />
              </div>
              <div>
                <Label htmlFor="dat-delim">Delimiter</Label>
                <select id="dat-delim" value={delimiter} onChange={(e) => setDelimiter(e.target.value as "," | "|")} className="mt-1 h-9 w-full rounded-md border bg-surface px-2 text-sm">
                  <option value=",">Comma (,)</option>
                  <option value="|">Pipe (|)</option>
                </select>
              </div>
            </div>
            <div>
              <Label>Preview</Label>
              <pre className="mt-1 max-h-56 overflow-auto rounded-md border bg-muted p-3 text-xs">{datKind ? buildDatPreview(datKind) : ""}</pre>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDatKind(null)}>Close</Button>
              <Button onClick={() => datKind && downloadText(`relief-${datKind}-${fromDate}.dat`, buildDatPreview(datKind), "text/plain")}>
                <Download className="mr-1.5 h-4 w-4" />
                Download .DAT
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
