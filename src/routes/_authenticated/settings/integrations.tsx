import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { companiesQueryKey, useCompany } from "@/lib/company";
import { PageHeader } from "@/components/PageHeader";
import { downloadShippingLabelPdf } from "@/components/ShippingPdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface ShipIntState {
  shipstation: { enabled: boolean; mode: string };
  ups: { enabled: boolean; mode: string };
}

export const Route = createFileRoute("/_authenticated/settings/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations — SOS Inventory" },
      { name: "description", content: "ShipStation and UPS shipping label integrations (sandbox/mock ready for Supabase secrets)." },
    ],
  }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { company, companyId, userId, canManageTax } = useCompany();
  const qc = useQueryClient();
  const [state, setState] = useState<ShipIntState>({
    shipstation: { enabled: false, mode: "mock" },
    ups: { enabled: false, mode: "mock" },
  });

  useEffect(() => {
    if (!company?.shipping_integrations) return;
    const raw = company.shipping_integrations as unknown as Partial<ShipIntState>;
    setState({
      shipstation: raw.shipstation ?? { enabled: false, mode: "mock" },
      ups: raw.ups ?? { enabled: false, mode: "mock" },
    });
  }, [company]);

  const save = async (next: ShipIntState) => {
    setState(next);
    const { error } = await supabase
      .from("companies")
      .update({ shipping_integrations: next as never })
      .eq("id", companyId);
    if (error) return void toast.error(error.message);
    toast.success("Integration settings updated");
    qc.invalidateQueries({ queryKey: companiesQueryKey(userId) });
  };

  return (
    <div className="p-6">
      <PageHeader title="Shipping Integrations" subtitle="Mock label & tracking generators structured for Supabase Edge Function secrets" />
      <div className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
        {(["shipstation", "ups"] as const).map((key) => {
          const title = key === "shipstation" ? "ShipStation" : "UPS Shipping";
          const cfg = state[key];
          return (
            <div key={key} className="rounded-lg border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-medium">{title}</h2>
                <Badge variant={cfg.enabled ? "secondary" : "outline"}>{cfg.enabled ? "Enabled (Mock)" : "Disabled"}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Generates sandbox tracking numbers and downloadable PDF shipping labels. Configure live API credentials later via Supabase Edge Function secrets (`{key.toUpperCase()}_API_KEY`).
              </p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm">Enable {title}</span>
                <Switch
                  checked={cfg.enabled}
                  disabled={!canManageTax}
                  onCheckedChange={(v) => void save({ ...state, [key]: { ...cfg, enabled: v } })}
                />
              </div>
              {company && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void downloadShippingLabelPdf({
                      provider: key,
                      carrier: key === "ups" ? "UPS" : "LBC Express",
                      trackingNo: `${key.toUpperCase()}-TEST-0001`,
                      refNo: "SAMPLE-001",
                      fromCompany: company.name,
                      toCustomer: "Sample Customer",
                      toAddress: "Makati City, Metro Manila",
                      weightKg: 1.5,
                    })
                  }
                >
                  <FileText className="mr-1.5 h-4 w-4" />
                  Test Sample Label PDF
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
