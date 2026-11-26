import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronDown, Columns3, Download, Filter, Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  cell: (row: T) => ReactNode;
  csv?: (row: T) => string;
  width?: string;
}
export interface FetchArgs { page: number; pageSize: number; sort: { key: string; dir: "asc" | "desc" }; search: string; filter: string }
export interface Action<T> { label: string; onSelect: (rows: T[]) => void | Promise<void> }

interface Props<T extends { id: string }> {
  id: string;
  queryKey: readonly unknown[];
  columns: Column<T>[];
  fetchPage: (a: FetchArgs) => Promise<{ rows: T[]; total: number }>;
  defaultSort: { key: string; dir: "asc" | "desc" };
  rowActions?: Action<T>[];
  batchActions?: Action<T>[];
  filters?: { value: string; label: string }[];
  onAdd?: () => void;
  pageSize?: number;
}

export function DataTable<T extends { id: string }>(p: Props<T>) {
  const pageSize = p.pageSize ?? 25;
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(p.defaultSort);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState(p.filters?.[0]?.value ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<string[]>([]);
  const [favs, setFavs] = useState<string[]>([]);
  const colKey = `sos.cols.${p.id}`, favKey = `sos.favs.${p.id}`;

  useEffect(() => {
    setHidden(JSON.parse(localStorage.getItem(colKey) ?? "[]"));
    setFavs(JSON.parse(localStorage.getItem(favKey) ?? "[]"));
  }, [colKey, favKey]);
  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  const args: FetchArgs = { page, pageSize, sort, search: debounced, filter };
  const q = useQuery({ queryKey: [...p.queryKey, args], queryFn: () => p.fetchPage(args), placeholderData: keepPreviousData });
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cols = p.columns.filter((c) => !hidden.includes(c.key));
  const selRows = rows.filter((r) => selected.has(r.id));

  const toggleHidden = (k: string) => { const n = hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k]; setHidden(n); localStorage.setItem(colKey, JSON.stringify(n)); };
  const toggleFav = (id: string) => { const n = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id]; setFavs(n); localStorage.setItem(favKey, JSON.stringify(n)); };
  const sortBy = (k: string) => { setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" })); setPage(1); };

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const src = selRows.length ? selRows : rows;
    const lines = [cols.map((c) => esc(c.header)).join(","), ...src.map((r) => cols.map((c) => esc(c.csv ? c.csv(r) : String(c.cell(r) ?? ""))).join(","))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `${p.id}.csv`; a.click();
  };

  const pageNums = useMemo(() => {
    const out: (number | "…")[] = [];
    const start = Math.max(1, Math.min(page - 2, pages - 4));
    for (let i = start; i <= Math.min(pages, start + 4); i++) out.push(i);
    if (out[out.length - 1] !== pages) { if ((out[out.length - 1] as number) < pages - 1) out.push("…"); out.push(pages); }
    return out;
  }, [page, pages]);

  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        {p.onAdd && <Button size="sm" onClick={p.onAdd}><Plus className="h-4 w-4" />Add</Button>}
        {p.batchActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={!selRows.length}>Batch actions<ChevronDown className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              {p.batchActions.map((a) => <DropdownMenuItem key={a.label} onClick={async () => { await a.onSelect(selRows); setSelected(new Set()); q.refetch(); }}>{a.label}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={exportCsv} aria-label="Export CSV"><Download className="h-4 w-4" /></Button>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Quick search" className="h-8 w-44" />
        {p.filters && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Filter className="h-4 w-4" />Filter</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              {p.filters.map((f) => <DropdownMenuCheckboxItem key={f.value} checked={filter === f.value} onCheckedChange={() => { setFilter(f.value); setPage(1); }}>{f.label}</DropdownMenuCheckboxItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Columns3 className="h-4 w-4" />Columns</Button></DropdownMenuTrigger>
          <DropdownMenuContent>
            {p.columns.slice(1).map((c) => <DropdownMenuCheckboxItem key={c.key} checked={!hidden.includes(c.key)} onCheckedChange={() => toggleHidden(c.key)}>{c.header}</DropdownMenuCheckboxItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex items-center gap-1 text-sm">
          <span className="mr-2 text-muted-foreground">{from} - {to} of {total}</span>
          <button className="px-1.5 disabled:opacity-40" disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="Previous page">«</button>
          {pageNums.map((n, i) => n === "…" ? <span key={`e${i}`} className="px-1">…</span> : (
            <button key={n} onClick={() => setPage(n)} className={cn("min-w-7 rounded-md px-1.5 transition-bg hover:bg-muted", n === page && "bg-primary text-primary-foreground hover:bg-primary")}>{n}</button>
          ))}
          <button className="px-1.5 disabled:opacity-40" disabled={page === pages} onClick={() => setPage(page + 1)} aria-label="Next page">»</button>
        </div>
      </div>
      <div className="max-h-[calc(100vh-260px)] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-surface">
            <tr className="border-b">
              <th className="w-8 px-2 py-2"><Checkbox checked={rows.length > 0 && selRows.length === rows.length} onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="Select all" /></th>
              <th className="w-8" />
              {cols.map((c, i) => (
                <th key={c.key} style={{ width: c.width }} className={cn("whitespace-nowrap px-3 py-2 text-left font-medium", i === 0 && "sticky left-0 z-10 bg-surface")}>
                  {c.sortable ? (
                    <button className="inline-flex items-center gap-1" onClick={() => sortBy(c.key)}>
                      {c.header}{sort.key === c.key && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.isLoading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b"><td colSpan={cols.length + 2} className="p-2"><Skeleton className="h-5 w-full" /></td></tr>
            ))}
            {!q.isLoading && !rows.length && (
              <tr><td colSpan={cols.length + 2} className="p-10 text-center text-muted-foreground">No records found</td></tr>
            )}
            {rows.map((r, ri) => {
              const zebra = ri % 2 === 1 ? "bg-zebra" : "bg-surface";
              return (
                <tr key={r.id} className={cn("border-b", zebra)}>
                  <td className="px-2 py-1.5"><Checkbox checked={selected.has(r.id)} onCheckedChange={(v) => { const n = new Set(selected); if (v) n.add(r.id); else n.delete(r.id); setSelected(n); }} aria-label="Select row" /></td>
                  <td><button onClick={() => toggleFav(r.id)} aria-label="Favorite"><Star className={cn("h-4 w-4", favs.includes(r.id) ? "fill-current text-teal" : "text-border")} /></button></td>
                  {cols.map((c, i) => (
                    <td key={c.key} className={cn("max-w-[240px] px-3 py-1.5", i === 0 && cn("sticky left-0 z-10", zebra))}>
                      {i === 0 ? (
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <span className="link-ref cursor-pointer">{c.cell(r)}</span>
                          {p.rowActions && (
                            <DropdownMenu>
                              <DropdownMenuTrigger aria-label="Row actions" className="rounded-md p-0.5 hover:bg-muted"><ChevronDown className="h-3.5 w-3.5" /></DropdownMenuTrigger>
                              <DropdownMenuContent>{p.rowActions.map((a) => <DropdownMenuItem key={a.label} onClick={async () => { await a.onSelect([r]); q.refetch(); }}>{a.label}</DropdownMenuItem>)}</DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      ) : (
                        <div className="truncate" title={c.csv ? c.csv(r) : undefined}>{c.cell(r)}</div>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
