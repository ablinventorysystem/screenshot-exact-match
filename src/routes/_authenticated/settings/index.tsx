import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { companiesQueryKey, useCompany } from "@/lib/company";
import { labelize } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/settings/")({
  head: () => ({
    meta: [
      { title: "Settings — SOS Inventory" },
      { name: "description", content: "Company profile, number prefixes, payment terms, email templates, and custom fields." },
    ],
  }),
  component: SettingsIndexPage,
});

function SettingsIndexPage() {
  const { company, companyId, userId, canManageTax } = useCompany();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [fiscalMonth, setFiscalMonth] = useState(1);
  const [customEnabled, setCustomEnabled] = useState(false);
  const [customLabels, setCustomLabels] = useState("");
  const [soSubject, setSoSubject] = useState("Sales Order {{ref_no}} from {{company}}");
  const [soBody, setSoBody] = useState("Please find attached your Sales Order {{ref_no}}.");
  const [newTermName, setNewTermName] = useState("");
  const [newTermDays, setNewTermDays] = useState("30");

  useEffect(() => {
    if (!company) return;
    setName(company.name);
    setFiscalMonth(company.fiscal_year_start_month);
    setCustomEnabled(company.custom_fields_enabled);
    const lbls = Array.isArray(company.custom_field_labels) ? (company.custom_field_labels as string[]) : [];
    setCustomLabels(lbls.join(", "));
    const tmpl = (company.email_templates ?? {}) as { so_subject?: string; so_body?: string };
    if (tmpl.so_subject) setSoSubject(tmpl.so_subject);
    if (tmpl.so_body) setSoBody(tmpl.so_body);
  }, [company]);

  const seqQ = useQuery({
    queryKey: ["doc_sequences", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("doc_sequences").select("*").eq("company_id", companyId).order("txn_type");
      return data ?? [];
    },
  });

  const termsQ = useQuery({
    queryKey: ["payment_terms", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase.from("payment_terms").select("*").eq("company_id", companyId).order("days");
      return data ?? [];
    },
  });

  const saveProfile = async () => {
    if (!companyId) return;
    const labelsArr = customLabels.split(",").map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase
      .from("companies")
      .update({
        name: name.trim(),
        fiscal_year_start_month: fiscalMonth,
        custom_fields_enabled: customEnabled,
        custom_field_labels: labelsArr,
        email_templates: { so_subject: soSubject, so_body: soBody },
      })
      .eq("id", companyId);
    if (error) return void toast.error(error.message);
    toast.success("Company preferences saved");
    qc.invalidateQueries({ queryKey: companiesQueryKey(userId) });
  };

  const addTerm = async () => {
    if (!newTermName.trim() || !companyId) return;
    const { error } = await supabase.from("payment_terms").insert({
      company_id: companyId,
      name: newTermName.trim(),
      days: Number(newTermDays) || 0,
    });
    if (error) return void toast.error(error.message);
    setNewTermName("");
    qc.invalidateQueries({ queryKey: ["payment_terms", companyId] });
    toast.success("Payment term added");
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Settings"
        subtitle="Company preferences, number prefixes, payment terms, and templates"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild><Link to="/settings/tax">Tax &amp; BIR</Link></Button>
            <Button variant="outline" size="sm" asChild><Link to="/settings/users">Users &amp; Roles</Link></Button>
            <Button variant="outline" size="sm" asChild><Link to="/settings/integrations">Integrations</Link></Button>
            <Button variant="outline" size="sm" asChild><Link to="/settings/quickbooks">QuickBooks Online</Link></Button>
          </div>
        }
      />

      <Tabs defaultValue="profile" className="max-w-4xl">
        <TabsList className="mb-4">
          <TabsTrigger value="profile">Profile &amp; Custom Fields</TabsTrigger>
          <TabsTrigger value="prefixes">Number Prefixes</TabsTrigger>
          <TabsTrigger value="terms">Payment Terms</TabsTrigger>
          <TabsTrigger value="emails">Email Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="co-name">Company Display Name</Label>
                <Input id="co-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 rounded-md" />
              </div>
              <div>
                <Label htmlFor="co-fy">Fiscal Year Start Month (1–12)</Label>
                <Input id="co-fy" type="number" min={1} max={12} value={fiscalMonth} onChange={(e) => setFiscalMonth(Number(e.target.value) || 1)} className="mt-1 rounded-md" />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Switch id="co-cf" checked={customEnabled} onCheckedChange={setCustomEnabled} />
              <Label htmlFor="co-cf">Enable custom fields on orders and items</Label>
            </div>
            {customEnabled && (
              <div>
                <Label htmlFor="co-cfl">Custom Field Labels (comma-separated)</Label>
                <Input id="co-cfl" value={customLabels} onChange={(e) => setCustomLabels(e.target.value)} placeholder="Project Code, Department" className="mt-1 rounded-md" />
              </div>
            )}
            {canManageTax && <Button onClick={() => void saveProfile()}>Save Profile</Button>}
          </div>
        </TabsContent>

        <TabsContent value="prefixes">
          <div className="rounded-lg border bg-card p-5">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Document Type</th>
                  <th className="py-2">Prefix</th>
                  <th className="py-2">Padding</th>
                  <th className="py-2">Next #</th>
                </tr>
              </thead>
              <tbody>
                {(seqQ.data ?? []).map((s) => (
                  <tr key={s.txn_type} className="border-b">
                    <td className="py-2 font-medium">{labelize(s.txn_type)}</td>
                    <td className="py-2">
                      <Input
                        defaultValue={s.prefix}
                        disabled={!canManageTax}
                        onBlur={async (e) => {
                          if (e.target.value !== s.prefix) {
                            await supabase.from("doc_sequences").update({ prefix: e.target.value }).eq("company_id", companyId).eq("txn_type", s.txn_type);
                            toast.success("Prefix updated");
                          }
                        }}
                        className="h-8 w-24 rounded-md"
                      />
                    </td>
                    <td className="py-2">{s.padding}</td>
                    <td className="py-2">{s.next_no}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="terms">
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="pt-name">Term Name</Label>
                <Input id="pt-name" value={newTermName} onChange={(e) => setNewTermName(e.target.value)} placeholder="Net 45" className="mt-1 rounded-md" />
              </div>
              <div>
                <Label htmlFor="pt-days">Days</Label>
                <Input id="pt-days" type="number" value={newTermDays} onChange={(e) => setNewTermDays(e.target.value)} className="mt-1 w-24 rounded-md" />
              </div>
              {canManageTax && (
                <Button onClick={() => void addTerm()}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add Term
                </Button>
              )}
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground"><th className="py-2">Name</th><th className="py-2">Days</th><th className="py-2" /></tr>
              </thead>
              <tbody>
                {(termsQ.data ?? []).map((t) => (
                  <tr key={t.id} className="border-b">
                    <td className="py-2 font-medium">{t.name}</td>
                    <td className="py-2">{t.days} days</td>
                    <td className="py-2 text-right">
                      {canManageTax && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={async () => {
                            await supabase.from("payment_terms").delete().eq("id", t.id);
                            qc.invalidateQueries({ queryKey: ["payment_terms", companyId] });
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="emails">
          <div className="rounded-lg border bg-card p-5 space-y-3">
            <div>
              <Label htmlFor="et-subj">Order / Invoice Email Subject</Label>
              <Input id="et-subj" value={soSubject} onChange={(e) => setSoSubject(e.target.value)} className="mt-1 rounded-md" />
            </div>
            <div>
              <Label htmlFor="et-body">Default Email Body</Label>
              <Textarea id="et-body" rows={4} value={soBody} onChange={(e) => setSoBody(e.target.value)} className="mt-1 rounded-md" />
            </div>
            {canManageTax && <Button onClick={() => void saveProfile()}>Save Templates</Button>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
