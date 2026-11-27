import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { fmtDate } from "@/lib/format";
import {
  parseDocxTemplate,
  SUPPORTED_MERGE_FIELDS,
  type ParsedDocxTemplate,
} from "@/lib/docx-templates";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type FetchArgs } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FormTemplateRow {
  id: string;
  name: string;
  doc_type: "invoice" | "sales_receipt" | "purchase_order";
  file_path: string;
  file_name: string;
  file_size: number;
  is_default: boolean;
  recognized_fields: string[];
  unknown_fields: string[];
  has_lines_region: boolean;
  uploaded_by_name: string | null;
  created_at: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  sales_receipt: "Sales receipt",
  purchase_order: "Purchase order",
};

export const Route = createFileRoute("/_authenticated/settings/form-templates")({
  head: () => ({
    meta: [
      { title: "Form templates — ABL Inventory" },
      { name: "description", content: "Upload Word (.docx) mail-merge templates for printing." },
    ],
  }),
  component: FormTemplatesPage,
});

function FormTemplatesPage() {
  const { companyId, canWrite } = useCompany();
  const qc = useQueryClient();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [name, setName] = useState("");
  const [docType, setDocType] = useState<"invoice" | "sales_receipt" | "purchase_order">("invoice");
  const [isDefault, setIsDefault] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedDocxTemplate | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchPage = async (a: FetchArgs) => {
    try {
      let q = (supabase.from("form_templates" as any) as any)
        .select("*", { count: "exact" })
        .eq("company_id", companyId);
      if (a.search) q = q.ilike("name", `%${a.search}%`);
      const { data, count, error } = await q
        .order("created_at", { ascending: false })
        .range((a.page - 1) * a.pageSize, a.page * a.pageSize - 1);
      if (error) return { rows: [], total: 0 };
      return { rows: (data ?? []) as FormTemplateRow[], total: count ?? 0 };
    } catch {
      return { rows: [], total: 0 };
    }
  };

  const handleFileChange = async (f: File | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".docx")) {
      toast.error("Only .docx files are supported");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast.error("File size must be 5 MB or less");
      return;
    }
    setFile(f);
    if (!name) setName(f.name.replace(/\.docx$/i, ""));
    try {
      const res = await parseDocxTemplate(f);
      setParsed(res);
    } catch {
      toast.error("Could not parse .docx file");
    }
  };

  const handleUpload = async () => {
    if (!companyId || !file || !name.trim()) {
      toast.error("Name and .docx file are required");
      return;
    }
    setSaving(true);
    try {
      const path = `${companyId}/templates/${Date.now()}-${file.name}`;
      await supabase.storage.from("backups").upload(path, file, { upsert: true });

      if (isDefault) {
        await (supabase.from("form_templates" as any) as any)
          .update({ is_default: false })
          .eq("company_id", companyId)
          .eq("doc_type", docType);
      }

      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (supabase.from("form_templates" as any) as any).insert({
        company_id: companyId,
        name: name.trim(),
        doc_type: docType,
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        is_default: isDefault,
        recognized_fields: parsed?.recognized ?? [],
        unknown_fields: parsed?.unknown ?? [],
        has_lines_region: parsed?.hasLinesRegion ?? false,
        uploaded_by: user?.id ?? null,
        uploaded_by_name: user?.email ?? "Admin",
      });
      if (error) throw error;

      toast.success("Template uploaded");
      setUploadOpen(false);
      setFile(null);
      setName("");
      setParsed(null);
      await qc.invalidateQueries({ queryKey: ["form-templates", companyId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to upload template");
    } finally {
      setSaving(false);
    }
  };

  const setAsDefault = async (row: FormTemplateRow) => {
    if (!companyId) return;
    await (supabase.from("form_templates" as any) as any)
      .update({ is_default: false })
      .eq("company_id", companyId)
      .eq("doc_type", row.doc_type);
    await (supabase.from("form_templates" as any) as any)
      .update({ is_default: true })
      .eq("id", row.id);
    toast.success(`${row.name} set as default`);
    await qc.invalidateQueries({ queryKey: ["form-templates", companyId] });
  };

  const deleteTemplate = async (row: FormTemplateRow) => {
    if (!window.confirm(`Delete template "${row.name}"?`)) return;
    await (supabase.from("form_templates" as any) as any).delete().eq("id", row.id);
    toast.success("Template deleted");
    await qc.invalidateQueries({ queryKey: ["form-templates", companyId] });
  };

  const columns: Column<FormTemplateRow>[] = [
    { key: "name", header: "Name", sortable: true, cell: (r) => r.name, csv: (r) => r.name },
    {
      key: "doc_type",
      header: "Document type",
      cell: (r) => DOC_TYPE_LABELS[r.doc_type] ?? r.doc_type,
      csv: (r) => r.doc_type,
    },
    {
      key: "default",
      header: "Default",
      cell: (r) => (r.is_default ? <Badge variant="secondary">Default</Badge> : "—"),
      csv: (r) => (r.is_default ? "Yes" : "No"),
    },
    { key: "uploaded", header: "Uploaded", cell: (r) => fmtDate(r.created_at), csv: (r) => fmtDate(r.created_at) },
    { key: "by", header: "Uploaded by", cell: (r) => r.uploaded_by_name ?? "—", csv: (r) => r.uploaded_by_name ?? "" },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="Form templates"
        subtitle="upload Word templates used for printing"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setRefOpen(true)}>
              <FileText className="mr-1.5 h-4 w-4" />
              Merge field reference
            </Button>
            {canWrite && (
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Upload template
              </Button>
            )}
          </div>
        }
      />

      {companyId && (
        <DataTable<FormTemplateRow>
          id="form-templates"
          queryKey={["form-templates", companyId]}
          columns={columns}
          fetchPage={fetchPage}
          defaultSort={{ key: "name", dir: "asc" }}
          rowActions={[
            { label: "Set as default", onSelect: (rows) => rows[0] && void setAsDefault(rows[0]) },
            { label: "Delete", onSelect: (rows) => rows[0] && void deleteTemplate(rows[0]) },
          ]}
        />
      )}

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Word (.docx) template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Template file (.docx, max 5 MB)</Label>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-[10px] border border-dashed p-6 text-center hover:bg-muted/30">
                <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium">{file ? file.name : "Click to select .docx file"}</span>
                <input
                  type="file"
                  accept=".docx"
                  className="hidden"
                  onChange={(e) => void handleFileChange(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <div className="space-y-1.5">
              <Label>Template name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard BIR Invoice" />
            </div>

            <div className="space-y-1.5">
              <Label>Document type</Label>
              <select
                className="h-9 w-full rounded-[6px] border bg-background px-2.5 text-sm"
                value={docType}
                onChange={(e) => setDocType(e.target.value as any)}
              >
                <option value="invoice">Invoice</option>
                <option value="sales_receipt">Sales receipt</option>
                <option value="purchase_order">Purchase order</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isDefault} onCheckedChange={(v) => setIsDefault(Boolean(v))} />
              Set as default for this document type
            </label>

            {parsed && (
              <div className="space-y-2 rounded-[6px] border bg-muted/20 p-3 text-xs">
                {!parsed.hasLinesRegion && (
                  <p className="font-medium text-amber-700">
                    Warning: No TableStart:Lines merge region detected. Line items will not repeat.
                  </p>
                )}
                <div>
                  <span className="font-medium">Recognized ({parsed.recognized.length}): </span>
                  <span className="text-muted-foreground">{parsed.recognized.join(", ") || "None"}</span>
                </div>
                {parsed.unknown.length > 0 && (
                  <div>
                    <span className="font-medium text-destructive">Unknown (will print blank): </span>
                    <span className="text-muted-foreground">{parsed.unknown.join(", ")}</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setUploadOpen(false)}>
                Cancel
              </Button>
              <Button disabled={saving} onClick={() => void handleUpload()}>
                {saving ? "Uploading..." : "Upload"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Merge Field Reference Dialog */}
      <Dialog open={refOpen} onOpenChange={setRefOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Supported Merge Fields</DialogTitle>
          </DialogHeader>
          <div className="grid max-h-80 grid-cols-2 gap-1.5 overflow-y-auto text-xs">
            {SUPPORTED_MERGE_FIELDS.map((f) => (
              <code key={f} className="rounded bg-muted px-2 py-1">
                {f}
              </code>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
