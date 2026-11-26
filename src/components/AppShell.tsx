import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LifeBuoy, ChevronDown, Search, Plus, Settings, RefreshCw, Printer, Bell, HelpCircle,
  LayoutDashboard, Calendar, Package, ShoppingCart, BadgeDollarSign, Truck, Factory, KeyRound,
  BarChart3, ChevronsLeft, ChevronsRight, Menu, LogOut,
} from "lucide-react";
import { CompanyProvider, useCompany } from "@/lib/company";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Sub = { title: string; to: string };
type NavItem = { title: string; icon: typeof Package; to?: string; children?: Sub[] };

export const NAV: NavItem[] = [
  { title: "Dashboard", icon: LayoutDashboard, to: "/dashboard" },
  { title: "Calendar", icon: Calendar, to: "/calendar" },
  { title: "Inventory", icon: Package, children: [
    { title: "Items", to: "/items" }, { title: "Lots/Serials", to: "/lots-serials" }, { title: "Locations", to: "/locations" },
    { title: "Transfers", to: "/transfers" }, { title: "Adjustments", to: "/adjustments" }, { title: "Trace", to: "/trace" }] },
  { title: "Purchasing", icon: ShoppingCart, children: [
    { title: "Vendors", to: "/vendors" }, { title: "Purchase orders", to: "/purchase-orders" }, { title: "Receipts", to: "/receipts" }, { title: "Bills", to: "/bills" }] },
  { title: "Sales", icon: BadgeDollarSign, children: [
    { title: "Customers", to: "/customers" }, { title: "Estimates", to: "/estimates" }, { title: "Sales orders", to: "/sales-orders" },
    { title: "Invoices", to: "/invoices" }, { title: "Sales receipts", to: "/sales-receipts" }, { title: "Payments", to: "/payments" },
    { title: "Returns", to: "/returns" }, { title: "RMAs", to: "/rmas" }] },
  { title: "Fulfillment", icon: Truck, children: [
    { title: "Pick tickets", to: "/pick-tickets" }, { title: "Shipments", to: "/shipments" }, { title: "Ready to pick/ship", to: "/ready-to-ship" }] },
  { title: "Production", icon: Factory, children: [
    { title: "Builds", to: "/builds" }, { title: "Processes", to: "/processes" }, { title: "Jobs", to: "/jobs" }, { title: "Work orders", to: "/work-orders" }] },
  { title: "Rentals", icon: KeyRound, children: [{ title: "Rentals", to: "/rentals" }] },
  { title: "Reports", icon: BarChart3, to: "/reports" },
  { title: "Settings", icon: Settings, to: "/settings" },
];

const COLLAPSE_KEY = "sos.sidebarCollapsed";

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isOn = (to: string) => path === to || path.startsWith(to + "/");
  const activeGroup = NAV.find((n) => n.children?.some((c) => isOn(c.to)))?.title ?? null;
  const [open, setOpen] = useState<string | null>(activeGroup);
  useEffect(() => { if (activeGroup) setOpen(activeGroup); }, [activeGroup]);

  return (
    <nav className="flex-1 overflow-y-auto py-2">
      {NAV.map((n) => {
        const Icon = n.icon;
        const base = "flex w-full items-center gap-3 px-4 py-2 text-left transition-bg hover:bg-sidebar-accent";
        if (n.to) {
          return (
            <Link key={n.title} to={n.to} onClick={onNavigate} title={n.title}
              className={cn(base, isOn(n.to) && "font-medium text-sidebar-primary")}>
              <Icon className="h-4 w-4 shrink-0" />{!collapsed && <span>{n.title}</span>}
            </Link>
          );
        }
        const expanded = open === n.title && !collapsed;
        return (
          <div key={n.title}>
            <button type="button" title={n.title} onClick={() => setOpen(expanded ? null : n.title)}
              className={cn(base, activeGroup === n.title && "font-medium text-sidebar-primary")}>
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <><span className="flex-1">{n.title}</span><ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} /></>}
            </button>
            {expanded && n.children!.map((c) => (
              <Link key={c.to} to={c.to} onClick={onNavigate}
                className={cn("block py-1.5 pl-11 pr-4 text-muted-foreground transition-bg hover:bg-sidebar-accent", isOn(c.to) && "font-medium text-foreground")}>
                {c.title}
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { company, memberships, setCompanyId, fullName, email } = useCompany();
  const initials = (fullName || email || "U").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");
  const iconBtn = "icon-circle h-9 w-9 text-muted-foreground transition-bg hover:bg-muted";
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-surface px-3">
      <button className={cn(iconBtn, "md:hidden")} onClick={onMenu} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
      <LifeBuoy className="h-7 w-7 shrink-0 text-teal" />
      <DropdownMenu>
        <DropdownMenuTrigger className="flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-base font-medium transition-bg hover:bg-muted">
          <span className="truncate">{company?.name ?? "Jhaymarts Industries Incorporated"}</span><ChevronDown className="h-4 w-4 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Switch company</DropdownMenuLabel>
          {memberships.map((m) => (
            <DropdownMenuItem key={m.company.id} onClick={() => setCompanyId(m.company.id)}>{m.company.name}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="ml-auto flex items-center gap-1">
        <button className={cn(iconBtn, "hidden sm:inline-flex")} aria-label="Search"><Search className="h-5 w-5" /></button>
        <button className="icon-circle h-8 w-8 bg-teal text-teal-foreground" aria-label="Create new"><Plus className="h-5 w-5" /></button>
        <Link to="/settings" className={cn(iconBtn, "hidden sm:inline-flex")} aria-label="Settings"><Settings className="h-5 w-5" /></Link>
        <button className={cn(iconBtn, "hidden sm:inline-flex")} aria-label="Sync"><RefreshCw className="h-5 w-5" /></button>
        <button className={cn(iconBtn, "hidden md:inline-flex")} aria-label="Print" onClick={() => window.print()}><Printer className="h-5 w-5" /></button>
        <button className={cn(iconBtn, "relative")} aria-label="Notifications">
          <Bell className="h-5 w-5" />
          <span className="absolute -right-1 -top-1 rounded-lg bg-destructive px-1 text-[10px] leading-4 text-destructive-foreground">99+</span>
        </button>
        <button className={cn(iconBtn, "hidden md:inline-flex")} aria-label="Help"><HelpCircle className="h-5 w-5" /></button>
        <DropdownMenu>
          <DropdownMenuTrigger className="icon-circle h-8 w-8 bg-primary text-xs font-medium text-primary-foreground" aria-label="Account">{initials}</DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => supabase.auth.signOut()}><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); }, []);
  const toggle = () => setCollapsed((c) => { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); return !c; });

  return (
    <CompanyProvider>
      <div className="flex h-screen w-full flex-col">
        <TopBar onMenu={() => setDrawer(true)} />
        <div className="flex min-h-0 flex-1">
          <aside className={cn("hidden shrink-0 flex-col border-r bg-sidebar md:flex", collapsed ? "w-14" : "w-[200px]")}>
            <SidebarNav collapsed={collapsed} />
            <button onClick={toggle} className="flex items-center justify-center border-t py-2 text-muted-foreground transition-bg hover:bg-muted" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            </button>
          </aside>
          <Sheet open={drawer} onOpenChange={setDrawer}>
            <SheetContent side="left" className="flex w-[240px] flex-col bg-sidebar p-0">
              <SidebarNav collapsed={false} onNavigate={() => setDrawer(false)} />
            </SheetContent>
          </Sheet>
          <main className="min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </CompanyProvider>
  );
}
