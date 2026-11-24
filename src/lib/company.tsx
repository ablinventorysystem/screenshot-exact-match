import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Company = Database["public"]["Tables"]["companies"]["Row"];
export type AppRole = Database["public"]["Enums"]["app_role"];

interface Membership {
  role: AppRole;
  company: Company;
}

interface CompanyCtx {
  userId: string;
  email: string;
  fullName: string;
  memberships: Membership[];
  company: Company | null;
  companyId: string;
  role: AppRole | null;
  canWrite: boolean;
  canManageTax: boolean;
  isAdmin: boolean;
  setCompanyId: (id: string) => void;
  loading: boolean;
}

const Ctx = createContext<CompanyCtx | null>(null);
const KEY = "sos.companyId";

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Admin",
  sales: "Sales",
  warehouse: "Warehouse",
  accounting: "Accounting",
  read_only: "Read-only",
};

export function companiesQueryKey(userId: string) {
  return ["memberships", userId] as const;
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const userQ = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
    staleTime: Infinity,
  });
  const userId = userQ.data?.id ?? "";

  const memQ = useQuery({
    queryKey: companiesQueryKey(userId),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_members")
        .select("role, company:companies(*)")
        .eq("user_id", userId);
      if (error) throw error;
      return (data ?? [])
        .filter((m) => m.company)
        .map((m) => ({ role: m.role, company: m.company as Company }))
        .sort((a, b) => a.company.name.localeCompare(b.company.name));
    },
  });

  const [selected, setSelected] = useState<string>(() =>
    typeof window === "undefined" ? "" : (localStorage.getItem(KEY) ?? ""),
  );

  const memberships = memQ.data ?? [];
  const current = memberships.find((m) => m.company.id === selected) ?? memberships[0] ?? null;

  useEffect(() => {
    if (current && current.company.id !== selected) setSelected(current.company.id);
  }, [current, selected]);

  const value = useMemo<CompanyCtx>(() => {
    const role = current?.role ?? null;
    const meta = (userQ.data?.user_metadata ?? {}) as Record<string, unknown>;
    return {
      userId,
      email: userQ.data?.email ?? "",
      fullName: typeof meta["full_name"] === "string" ? (meta["full_name"] as string) : (userQ.data?.email ?? ""),
      memberships,
      company: current?.company ?? null,
      companyId: current?.company.id ?? "",
      role,
      canWrite: !!role && role !== "read_only",
      canManageTax: role === "admin" || role === "accounting",
      isAdmin: role === "admin",
      setCompanyId: (id: string) => {
        localStorage.setItem(KEY, id);
        setSelected(id);
      },
      loading: userQ.isLoading || memQ.isLoading,
    };
  }, [current, memberships, userId, userQ.data, userQ.isLoading, memQ.isLoading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompany() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCompany must be used inside CompanyProvider");
  return v;
}
