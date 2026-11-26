import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ComingNext({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="p-6">
      <PageHeader title={title} subtitle={subtitle} />
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">Coming next</div>
    </div>
  );
}
