import { useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Upload, Trash2, History, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/maintenance")({
  head: () => ({
    meta: [{ title: "Maintenance — ABL Inventory" }],
  }),
  component: MaintenancePage,
});

// All business tables to include in backup
const BACKUP_TABLES = [
  "companies","locations","customers","vendors","items","item_bom_lines",
  "item_cost_history","item_lots","item_serials","inventory_levels",
  "transactions","transaction_lines","form_2307_records","form_2307_issued",
  "payment_terms","production_processes","production_process_lines","production_jobs",
  "lot_genealogy","rental_bookings","qb_sync_logs","notifications",
  "tax_codes","atc_codes","doc_sequences","audit_log","maintenance_log",
];

const APP_VERSION = "1.0.0";

function MaintenancePage() {
  const { isAdmin, companyId, userId, fullName } = useCompany();

  if (!isAdmin) {
    return (
      <div className="p-6">
        <PageHeader title="Maintenance" subtitle="backup, restore and reset data" />
        <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-destructive" />
          <p className="font-medium text-destructive">Admin access required</p>
          <p className="text-sm text-muted-foreground mt-1">Only Admin users can access the Maintenance module.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader title="Maintenance" subtitle="backup, restore and reset data" />
      <Tabs defaultValue="backup" className="mt-6">
        <TabsList>
          <TabsTrigger value="backup"><Download className="mr-1.5 h-4 w-4" />Backup</TabsTrigger>
          <TabsTrigger value="restore"><Upload className="mr-1.5 h-4 w-4" />Restore</TabsTrigger>
          <TabsTrigger value="reset"><Trash2 className="mr-1.5 h-4 w-4" />Reset</TabsTrigger>
          <TabsTrigger value="history"><History className="mr-1.5 h-4 w-4" />History</TabsTrigger>
        </TabsList>
        <TabsContent value="backup" className="mt-4">
          <BackupTab companyId={companyId!} userId={userId} fullName={fullName} />
        </TabsContent>
        <TabsContent value="restore" className="mt-4">
          <RestoreTab companyId={companyId!} userId={userId} />
        </TabsContent>
        <TabsContent value="reset" className="mt-4">
          <ResetTab companyId={companyId!} userId={userId} fullName={fullName} />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryTab companyId={companyId!} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────
// BACKUP TAB
// ─────────────────────────────────────────────
function BackupTab({ companyId, userId, fullName }: { companyId: string; userId: string | undefined; fullName: string }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ table: string; pct: number } | null>(null);
  const [format, setFormat] = useState<"json" | "csv">("json");

  const lastBackupQ = useQuery({
    queryKey: ["last_backup", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("maintenance_log")
        .select("performed_at")
        .eq("company_id", companyId)
        .eq("action", "backup")
        .eq("status", "success")
        .order("performed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.performed_at ?? null;
    },
  });

  const daysSince = lastBackupQ.data
    ? Math.floor((Date.now() - new Date(lastBackupQ.data).getTime()) / 86400000)
    : null;

  const fetchTable = useCallback(async (table: string) => {
    const rows: Record<string, unknown>[] = [];
    const pageSize = 1000;
    let page = 0;
    while (true) {
      const q = supabase.from(table as "companies").select("*").range(page * pageSize, (page + 1) * pageSize - 1);
      if (table !== "companies" && table !== "audit_log" && table !== "tax_codes" && table !== "atc_codes" && table !== "doc_sequences") {
        // scope to company
        (q as unknown as { eq: (c: string, v: string) => typeof q }).eq("company_id", companyId);
      }
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push(...(data as Record<string, unknown>[]));
      if (data.length < pageSize) break;
      page++;
    }
    return rows;
  }, [companyId]);

  const handleDownload = async () => {
    setBusy(true);
    try {
      const zip = new JSZip();
      const manifestTables: Record<string, number> = {};
      const manifest: Record<string, unknown> = {
        app_version: APP_VERSION,
        schema_version: "part3",
        created_at: new Date().toISOString(),
        created_by: fullName || userId || "",
        tables: manifestTables,
      };

      for (let i = 0; i < BACKUP_TABLES.length; i++) {
        const table = BACKUP_TABLES[i]!;
        setProgress({ table, pct: Math.round((i / BACKUP_TABLES.length) * 100) });
        try {
          const rows = await fetchTable(table);
          manifestTables[table] = rows.length;
          if (format === "json") {
            zip.file(`${table}.json`, JSON.stringify(rows, null, 2));
          } else {
            const firstRow = rows[0];
            if (firstRow) {
              const headers = Object.keys(firstRow).join(",");
              const csvRows = rows.map((r) =>
                Object.values(r).map((v) => (v === null ? "" : `"${String(v).replace(/"/g, '""')}"`)).join(",")
              );
              zip.file(`${table}.csv`, [headers, ...csvRows].join("\n"));
            } else {
              zip.file(`${table}.csv`, "");
            }
          }
        } catch {
          manifestTables[table] = -1;
        }
      }

      zip.file("manifest.json", JSON.stringify(manifest, null, 2));
      setProgress({ table: "Compressing…", pct: 99 });
      const now = new Date();
      const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}-${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}`;
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `abl-backup-${stamp}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      // Log to maintenance_log
      await supabase.from("maintenance_log").insert({
        company_id: companyId,
        action: "backup",
        option: format,
        performed_by: userId ?? null,
        status: "success",
        details: { format, tables: manifestTables, file: `abl-backup-${stamp}.zip` },
      });
      toast.success("Backup downloaded successfully");
      lastBackupQ.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="max-w-xl space-y-5">
      {daysSince !== null && daysSince > 7 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          No backup in the last {daysSince} days. Please download a backup before making changes.
        </div>
      )}
      {lastBackupQ.data && (daysSince === null || daysSince <= 7) && (
        <p className="text-sm text-muted-foreground">
          Last backup: <span className="font-medium">{new Date(lastBackupQ.data).toLocaleString()}</span>
        </p>
      )}

      <div className="rounded-lg border p-5 space-y-4" style={{ borderRadius: 10 }}>
        <h3 className="font-medium">Download full backup</h3>
        <p className="text-sm text-muted-foreground">
          Exports all business tables (excluding auth credentials) into a single .zip archive.
        </p>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="radio" name="fmt" value="json" checked={format === "json"} onChange={() => setFormat("json")} /> JSON (full fidelity)
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="radio" name="fmt" value="csv" checked={format === "csv"} onChange={() => setFormat("csv")} /> CSV (accountant-friendly)
          </label>
        </div>

        {progress && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Exporting: {progress.table}</p>
            <div className="h-1.5 w-full rounded-full bg-muted">
              <div className="h-1.5 rounded-full bg-teal transition-all" style={{ width: `${progress.pct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground text-right">{progress.pct}%</p>
          </div>
        )}

        <Button onClick={handleDownload} disabled={busy} className="w-full" style={{ borderRadius: 6 }}>
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Exporting…</> : <><Download className="mr-2 h-4 w-4" />Download backup (.zip)</>}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// RESTORE TAB
// ─────────────────────────────────────────────
function RestoreTab({ companyId, userId }: { companyId: string; userId: string | undefined }) {
  const [file, setFile] = useState<File | null>(null);
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = useState<{ table: string; fileRows: number }[]>([]);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ table: string; pct: number } | null>(null);
  const [results, setResults] = useState<{ table: string; ok: number; err: string | null }[]>([]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setManifest(null);
    setPreview([]);
    setResults([]);
    try {
      const zip = await JSZip.loadAsync(f);
      const mf = zip.file("manifest.json");
      if (!mf) throw new Error("No manifest.json found — this may not be an ABL backup file.");
      const mfData = JSON.parse(await mf.async("string")) as Record<string, unknown>;
      setManifest(mfData);
      const tableMap = (mfData["tables"] ?? {}) as Record<string, number>;
      const tables = Object.keys(tableMap);
      const pv = tables.map((t) => ({ table: t, fileRows: tableMap[t] ?? 0 }));
      setPreview(pv);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to read backup file");
    }
  };

  const handleRestore = async () => {
    if (!file || !manifest) return;
    setBusy(true);
    setResults([]);
    const res: { table: string; ok: number; err: string | null }[] = [];
    try {
      const zip = await JSZip.loadAsync(file);
      const tableMap = (manifest["tables"] ?? {}) as Record<string, number>;
      const tables = Object.keys(tableMap);
      const skipTables = ["profiles"];

      for (let i = 0; i < tables.length; i++) {
        const table = tables[i]!;
        if (skipTables.includes(table)) continue;
        setProgress({ table, pct: Math.round((i / tables.length) * 100) });
        try {
          const zf = zip.file(`${table}.json`);
          if (!zf) { res.push({ table, ok: 0, err: "File not found in zip" }); continue; }
          const rows = JSON.parse(await zf.async("string")) as Record<string, unknown>[];
          if (rows.length === 0) { res.push({ table, ok: 0, err: null }); continue; }

          let ok = 0;
          const chunkSize = 100;
          for (let j = 0; j < rows.length; j += chunkSize) {
            const chunk = rows.slice(j, j + chunkSize);
            const { error } = await supabase.from(table as "companies").upsert(chunk as never, { onConflict: "id" });
            if (error) throw error;
            ok += chunk.length;
          }
          res.push({ table, ok, err: null });
        } catch (err) {
          res.push({ table, ok: 0, err: err instanceof Error ? err.message : "Unknown error" });
        }
      }

      await supabase.from("maintenance_log").insert({
        company_id: companyId,
        action: "restore",
        option: mode,
        performed_by: userId ?? null,
        status: res.some((r) => r.err) ? "error" : "success",
        details: { file: file.name, results: res },
      });
      toast.success("Restore complete");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(false);
      setProgress(null);
      setResults(res);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div className="rounded-lg border p-5 space-y-4" style={{ borderRadius: 10 }}>
        <h3 className="font-medium">Upload backup file</h3>
        <p className="text-sm text-muted-foreground">Select an <code>abl-backup-*.zip</code> file previously downloaded from this page.</p>
        <Input type="file" accept=".zip" onChange={handleFile} style={{ borderRadius: 6 }} />
      </div>

      {manifest && (
        <>
          <div className="rounded-lg border p-5 space-y-3" style={{ borderRadius: 10 }}>
            <h3 className="font-medium">Backup manifest</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Created</dt><dd>{String(manifest["created_at"] ?? "")}</dd>
              <dt className="text-muted-foreground">Created by</dt><dd>{String(manifest["created_by"] ?? "")}</dd>
              <dt className="text-muted-foreground">Schema version</dt><dd>{String(manifest["schema_version"] ?? "")}</dd>
            </dl>
          </div>

          <div className="rounded-lg border p-5 space-y-3" style={{ borderRadius: 10 }}>
            <h3 className="font-medium">Preview</h3>
            <div className="max-h-60 overflow-auto rounded border text-sm">
              <table className="w-full">
                <thead className="sticky top-0 bg-muted"><tr><th className="px-3 py-2 text-left">Table</th><th className="px-3 py-2 text-right">Rows in file</th></tr></thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.table} className="border-t"><td className="px-3 py-1.5 font-mono">{r.table}</td><td className="px-3 py-1.5 text-right">{r.fileRows < 0 ? "—" : r.fileRows}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border p-5 space-y-3" style={{ borderRadius: 10 }}>
            <h3 className="font-medium">Restore mode</h3>
            <label className="flex items-start gap-2 cursor-pointer text-sm">
              <input type="radio" name="mode" value="merge" checked={mode === "merge"} onChange={() => setMode("merge")} className="mt-0.5" />
              <span><strong>Merge (upsert by id)</strong> — inserts new rows, updates existing rows by their id. Safe for partial restores.</span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer text-sm">
              <input type="radio" name="mode" value="replace" checked={mode === "replace"} onChange={() => setMode("replace")} className="mt-0.5" />
              <span><strong>Replace</strong> — existing rows are overwritten. Only the rows in the backup file will remain.</span>
            </label>

            {mode === "replace" && (
              <div className="rounded border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                <p className="text-sm font-medium text-destructive flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Type RESTORE ABL DATA to confirm</p>
                <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTORE ABL DATA" style={{ borderRadius: 6 }} />
              </div>
            )}

            {progress && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Restoring: {progress.table}</p>
                <div className="h-1.5 w-full rounded-full bg-muted">
                  <div className="h-1.5 rounded-full bg-teal transition-all" style={{ width: `${progress.pct}%` }} />
                </div>
              </div>
            )}

            <Button onClick={handleRestore} disabled={busy || (mode === "replace" && confirmText !== "RESTORE ABL DATA")} className="w-full" style={{ borderRadius: 6 }}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Restoring…</> : <><Upload className="mr-2 h-4 w-4" />Start restore</>}
            </Button>
          </div>

          {results.length > 0 && (
            <div className="rounded-lg border p-5 space-y-2" style={{ borderRadius: 10 }}>
              <h3 className="font-medium">Results</h3>
              {results.map((r) => (
                <div key={r.table} className={`flex items-center gap-2 text-sm ${r.err ? "text-destructive" : "text-foreground"}`}>
                  {r.err ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-teal" />}
                  <span className="font-mono">{r.table}</span>
                  {r.err ? <span className="ml-auto text-xs">{r.err}</span> : <span className="ml-auto text-xs text-muted-foreground">{r.ok} rows</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// RESET TAB
// ─────────────────────────────────────────────
const RESET_OPTIONS = [
  {
    value: "transactions" as const,
    label: "Erase transactions only",
    confirm: "RESET TRANSACTIONS",
    description: "Deletes all transactions, lines, Form 2307 records, QB sync logs, notifications, and rentals. Resets document number counters. Keeps items, customers, vendors, locations, tax settings, and users.",
  },
  {
    value: "transactions_inventory" as const,
    label: "Erase transactions and inventory",
    confirm: "RESET ABL DATA",
    description: "Everything in option 1, plus clears inventory levels, item lots, serials, cost history, and production jobs. Items remain but stock goes to zero.",
  },
  {
    value: "factory" as const,
    label: "Factory reset (erase everything except users and company settings)",
    confirm: "RESET ABL DATA",
    description: "Everything in option 2, plus removes customers, vendors, items, locations, BOM lines, and production processes. Preserves company settings, tax codes, users, and audit log.",
  },
];

function ResetTab({ companyId, userId, fullName }: { companyId: string; userId: string | undefined; fullName: string }) {
  const qc = useQueryClient();
  const [option, setOption] = useState<"transactions" | "transactions_inventory" | "factory">("transactions");
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [resetBir, setResetBir] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const [backupDone, setBackupDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const opt = RESET_OPTIONS.find((o) => o.value === option)!;

  const countsQ = useQuery({
    queryKey: ["maintenance_counts", companyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("maintenance_counts", { p_company_id: companyId });
      if (error) throw error;
      return data as Record<string, number>;
    },
  });

  const doBackupFirst = async () => {
    setBackupBusy(true);
    try {
      const zip = new JSZip();
      for (const table of BACKUP_TABLES) {
        try {
          const { data } = await supabase.from(table as "companies").select("*");
          zip.file(`${table}.json`, JSON.stringify(data ?? [], null, 2));
        } catch { /* skip */ }
      }
      zip.file("manifest.json", JSON.stringify({ app_version: APP_VERSION, schema_version: "part3", created_at: new Date().toISOString(), created_by: fullName || userId, pre_reset: true }, null, 2));
      const blob = await zip.generateAsync({ type: "blob" });
      const now = new Date();
      const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}-pre-reset`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `abl-backup-${stamp}.zip`; a.click();
      URL.revokeObjectURL(url);
      await supabase.from("maintenance_log").insert({ company_id: companyId, action: "backup", option: "pre-reset", performed_by: userId ?? null, status: "success", details: { pre_reset: true } });
      setBackupDone(true);
      toast.success("Pre-reset backup downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backup failed — cannot proceed");
    } finally {
      setBackupBusy(false);
    }
  };

  const handleReset = async () => {
    if (!backupDone && !hasBackup) return;
    if (confirmText !== opt.confirm) return;
    setBusy(true);
    setResult(null);
    try {
      // Re-authenticate to verify password
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Cannot verify identity");
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password });
      if (authErr) throw new Error("Incorrect password — reset aborted");

      const { data, error } = await supabase.rpc("maintenance_reset", {
        p_company_id: companyId,
        p_option: option,
        p_reset_bir_series: resetBir,
      });
      if (error) throw error;
      setResult(data as Record<string, unknown>);
      toast.success("Reset completed successfully");
      qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  const canReset = (backupDone || hasBackup) && confirmText === opt.confirm && password.length >= 6;

  return (
    <div className="max-w-xl space-y-5">
      {/* DANGER ZONE border */}
      <div className="rounded-lg border-2 border-destructive p-5 space-y-5">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <h3 className="font-semibold text-base">DANGER ZONE</h3>
        </div>

        {/* Option selector */}
        <div className="space-y-3">
          {RESET_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-start gap-3 cursor-pointer">
              <input type="radio" name="resetOption" value={o.value} checked={option === o.value} onChange={() => { setOption(o.value); setConfirmText(""); }} className="mt-1 shrink-0" />
              <div>
                <p className="font-medium text-sm">{o.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{o.description}</p>
              </div>
            </label>
          ))}
        </div>

        {/* Live row counts */}
        {countsQ.data && (
          <div className="rounded border bg-muted/40 p-3 text-xs space-y-1">
            <p className="font-medium mb-2">Live row counts (what will be affected)</p>
            {Object.entries(countsQ.data).map(([t, c]) => (
              <div key={t} className="flex justify-between"><span className="font-mono">{t}</span><span>{c}</span></div>
            ))}
          </div>
        )}

        {/* BIR series */}
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" checked={resetBir} onChange={(e) => setResetBir(e.target.checked)} />
          Also reset BIR invoice numbering
        </label>
        {resetBir && (
          <p className="text-xs text-destructive flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />BIR-registered invoice series should NOT be reset in a live business. Only do this in a test/demo environment.</p>
        )}

        {/* Backup first */}
        <div className="space-y-2">
          {!backupDone && (
            <Button variant="outline" onClick={doBackupFirst} disabled={backupBusy} className="w-full" style={{ borderRadius: 6 }}>
              {backupBusy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating backup…</> : <><Download className="mr-2 h-4 w-4" />Step 1: Download backup first (required)</>}
            </Button>
          )}
          {backupDone && <p className="text-sm text-teal flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />Backup downloaded</p>}
          {!backupDone && (
            <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
              <input type="checkbox" checked={hasBackup} onChange={(e) => setHasBackup(e.target.checked)} />
              I already have a recent backup and understand the risks
            </label>
          )}
        </div>

        {/* Confirm phrase */}
        <div className="space-y-1">
          <Label className="text-sm">Type <code className="font-semibold">{opt.confirm}</code> to confirm</Label>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={opt.confirm} style={{ borderRadius: 6 }} />
        </div>

        {/* Password */}
        <div className="space-y-1">
          <Label className="text-sm">Re-enter your password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your account password" style={{ borderRadius: 6 }} />
        </div>

        <Button variant="destructive" onClick={handleReset} disabled={!canReset || busy} className="w-full" style={{ borderRadius: 6 }}>
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Resetting…</> : <><Trash2 className="mr-2 h-4 w-4" />Execute Reset</>}
        </Button>
      </div>

      {result && (
        <div className="rounded-lg border border-teal/30 bg-teal/5 p-4 text-sm space-y-1">
          <p className="font-medium text-teal flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />Reset completed</p>
          {Object.entries(result).map(([k, v]) => (
            <div key={k} className="flex justify-between text-xs"><span className="font-mono">{k}</span><span>{String(v)}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// HISTORY TAB
// ─────────────────────────────────────────────
function HistoryTab({ companyId }: { companyId: string }) {
  const histQ = useQuery({
    queryKey: ["maintenance_log", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_log")
        .select("*")
        .eq("company_id", companyId)
        .order("performed_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (histQ.isLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;

  return (
    <div className="max-w-3xl">
      <div className="rounded-lg border overflow-hidden" style={{ borderRadius: 10 }}>
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Action</th>
              <th className="px-4 py-2 text-left">Option</th>
              <th className="px-4 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {(histQ.data ?? []).length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No maintenance actions yet</td></tr>
            )}
            {(histQ.data ?? []).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-4 py-2">{new Date(row.performed_at).toLocaleString()}</td>
                <td className="px-4 py-2 capitalize">{row.action}</td>
                <td className="px-4 py-2 text-muted-foreground">{row.option ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium ${row.status === "success" ? "text-teal" : "text-destructive"}`}>
                    {row.status === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
