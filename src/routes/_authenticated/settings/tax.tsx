import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany, companiesQueryKey } from "@/lib/company";
import { isValidTin, formatTin } from "@/lib/tin";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/settings/tax")({
  head: () => ({
    meta: [
      { title: "Tax & BIR settings — ABL Inventory" },
      { name: "description", content: "VAT registration, TIN, ATP and invoice series settings." },
      { property: "og:title", content: "Tax & BIR settings — ABL Inventory" },
      { property: "og:description", content: "VAT registration, TIN, ATP and invoice series settings." },
    ],
  }),
  component: TaxSettings,
});

interface F {
  name: string; trade_name: string; tin: string; branch_code: string; rdo_code: string; registered_address: string; zip_code: string;
  vat_registered: boolean; default_vat_rate: number; percentage_tax_rate: number; price_mode: string;
  atp_no: string; atp_date_issued: string; atp_validity_date: string; bir_validity_notice: string;
  invoice_series_start: number | null; invoice_series_end: number | null;
  invoice_series_next: number | null; atp_warning_threshold: number;
  printer_name: string; printer_tin: string; printer_accreditation_no: string; printer_accreditation_date: string;
}

function TaxSettings() {
  const { company, userId, canManageTax } = useCompany();
  const qc = useQueryClient();
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<F>();

  useEffect(() => {
    if (!company) return;
    const s = (v: string | null) => v ?? "";
    reset({
      name: company.name, trade_name: s(company.trade_name), tin: s(company.tin), branch_code: s(company.branch_code) || "00000", rdo_code: s(company.rdo_code),
      registered_address: s(company.registered_address), zip_code: s(company.zip_code), vat_registered: company.vat_registered,
      default_vat_rate: Number(company.default_vat_rate), percentage_tax_rate: Number(company.percentage_tax_rate), price_mode: company.price_mode,
      atp_no: s(company.atp_no), atp_date_issued: s(company.atp_date_issued), atp_validity_date: s(company.atp_validity_date),
      bir_validity_notice: s(company.bir_validity_notice) || "THIS SALES INVOICE SHALL BE VALID FOR FIVE (5) YEARS FROM THE DATE OF ATP",
      invoice_series_start: company.invoice_series_start,
      invoice_series_end: company.invoice_series_end, invoice_series_next: company.invoice_series_next,
      atp_warning_threshold: company.atp_warning_threshold, printer_name: s(company.printer_name), printer_tin: s(company.printer_tin),
      printer_accreditation_no: s(company.printer_accreditation_no), printer_accreditation_date: s(company.printer_accreditation_date),
    });
  }, [company, reset]);

  const onSubmit = async (f: F) => {
    if (!company) return;
    const nul = (v: string) => (v.trim() === "" ? null : v.trim());
    const int = (v: unknown) => (v === "" || v === null || Number.isNaN(Number(v)) ? null : Number(v));
    const { error } = await supabase.from("companies").update({
      name: f.name.trim(), trade_name: nul(f.trade_name), tin: nul(f.tin), branch_code: f.branch_code.trim() || "00000", rdo_code: nul(f.rdo_code),
      registered_address: nul(f.registered_address), zip_code: nul(f.zip_code), vat_registered: f.vat_registered,
      default_vat_rate: Number(f.default_vat_rate), percentage_tax_rate: Number(f.percentage_tax_rate), price_mode: f.price_mode,
      atp_no: nul(f.atp_no), atp_date_issued: nul(f.atp_date_issued), atp_validity_date: nul(f.atp_validity_date),
      bir_validity_notice: f.bir_validity_notice.trim() || "THIS SALES INVOICE SHALL BE VALID FOR FIVE (5) YEARS FROM THE DATE OF ATP",
      invoice_series_start: int(f.invoice_series_start),
      invoice_series_end: int(f.invoice_series_end), invoice_series_next: int(f.invoice_series_next),
      atp_warning_threshold: Number(f.atp_warning_threshold), printer_name: nul(f.printer_name), printer_tin: nul(f.printer_tin),
      printer_accreditation_no: nul(f.printer_accreditation_no), printer_accreditation_date: nul(f.printer_accreditation_date),
    }).eq("id", company.id);
    if (error) return void toast.error(error.message);
    toast.success("Tax & BIR settings saved");
    qc.invalidateQueries({ queryKey: companiesQueryKey(userId) });
  };

  const tinRule = (v: string) => !v || isValidTin(v) || "TIN must be 000-000-000-00000";
  const Err = ({ k }: { k: keyof F }) => (errors[k] ? <p className="mt-1 text-xs text-destructive">{String(errors[k]?.message)}</p> : null);
  const Field = ({ k, label, type = "text", rules = {} }: { k: keyof F; label: string; type?: string; rules?: object }) => (
    <div>
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} type={type} step="any" className="mt-1 rounded-md" aria-invalid={!!errors[k]} {...register(k, rules)} />
      <Err k={k} />
    </div>
  );
  const grid = "grid grid-cols-1 gap-4 md:grid-cols-2";
  const card = "rounded-lg border bg-card p-5";

  return (
    <div className="p-6">
      <PageHeader title="Tax & BIR" subtitle="Registration, VAT and invoice series for BIR compliance" />
      {!canManageTax && <p className="mb-4 text-muted-foreground">Only Admin or Accounting users can change these settings.</p>}
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-4xl space-y-4">
        <fieldset disabled={!canManageTax} className="space-y-4">
          <section className={card}>
            <h2 className="section-label mb-3">Registration</h2>
            <div className={grid}>
              <Field k="name" label="Registered name" rules={{ required: "Registered name is required" }} />
              <Field k="trade_name" label="Trade name" />
              <div>
                <Label htmlFor="tin">TIN</Label>
                <Input id="tin" className="mt-1" placeholder="000-000-000-00000" aria-invalid={!!errors.tin}
                  {...register("tin", { validate: tinRule, onChange: (e) => setValue("tin", formatTin(e.target.value)) })} />
                <Err k="tin" />
              </div>
              <Field k="rdo_code" label="RDO code" rules={{ pattern: { value: /^\d{3}[A-Z]?$/, message: "RDO code is 3 digits, e.g. 113" } }} />
              <Field k="branch_code" label="Branch code" />
              <Field k="registered_address" label="Registered address" />
              <Field k="zip_code" label="ZIP code" rules={{ pattern: { value: /^\d{4}$/, message: "ZIP code is 4 digits" } }} />
            </div>
          </section>
          <section className={card}>
            <h2 className="section-label mb-3">VAT</h2>
            <div className={grid}>
              <div className="flex items-center gap-3">
                <Switch id="vat_registered" checked={!!watch("vat_registered")} onCheckedChange={(v) => setValue("vat_registered", v, { shouldDirty: true })} />
                <Label htmlFor="vat_registered">VAT-registered (otherwise 3% percentage tax)</Label>
              </div>
              <div>
                <Label htmlFor="price_mode">Item prices are</Label>
                <select id="price_mode" className="mt-1 h-9 w-full rounded-md border bg-surface px-3" {...register("price_mode")}>
                  <option value="exclusive">VAT-exclusive</option>
                  <option value="inclusive">VAT-inclusive</option>
                </select>
              </div>
              <Field k="default_vat_rate" label="Default VAT rate (%)" type="number" rules={{ required: "Required", min: { value: 0, message: "Must be 0–100" }, max: { value: 100, message: "Must be 0–100" } }} />
              <Field k="percentage_tax_rate" label="Percentage tax rate (%)" type="number" rules={{ required: "Required", min: { value: 0, message: "Must be 0–100" }, max: { value: 100, message: "Must be 0–100" } }} />
            </div>
          </section>
          <section className={card}>
            <h2 className="section-label mb-3">Authority to Print & invoice series</h2>
            <div className={grid}>
              <Field k="atp_no" label="ATP number" />
              <Field k="atp_date_issued" label="ATP date issued" type="date" />
              <Field k="atp_validity_date" label="ATP validity date" type="date" />
              <Field k="bir_validity_notice" label="BIR validity notice (invoice footer)" />
              <Field k="invoice_series_start" label="Series start" type="number" rules={{ min: { value: 1, message: "Must be at least 1" } }} />
              <Field k="invoice_series_end" label="Series end" type="number"
                rules={{ validate: (v: unknown, f: F) => !v || !f.invoice_series_start || Number(v) > Number(f.invoice_series_start) || "End must be after start" }} />
              <Field k="invoice_series_next" label="Next invoice number" type="number"
                rules={{ validate: (v: unknown, f: F) => !v || ((!f.invoice_series_start || Number(v) >= Number(f.invoice_series_start)) && (!f.invoice_series_end || Number(v) <= Number(f.invoice_series_end))) || "Must be within the series" }} />
              <Field k="atp_warning_threshold" label="Warn when this many numbers remain" type="number" rules={{ required: "Required", min: { value: 0, message: "Can't be negative" } }} />
            </div>
          </section>
          <section className={card}>
            <h2 className="section-label mb-3">Accredited printer</h2>
            <div className={grid}>
              <Field k="printer_name" label="Printer name" />
              <Field k="printer_tin" label="Printer TIN" rules={{ validate: tinRule }} />
              <Field k="printer_accreditation_no" label="Accreditation no." />
              <Field k="printer_accreditation_date" label="Accreditation date" type="date" />
            </div>
          </section>
          <Button type="submit" disabled={isSubmitting}>Save</Button>
        </fieldset>
      </form>
    </div>
  );
}
