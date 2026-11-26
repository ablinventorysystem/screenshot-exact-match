import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL, useCompany, type AppRole } from "@/lib/company";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";

const ROLES: AppRole[] = ["admin", "sales", "warehouse", "accounting", "read_only"];

export const Route = createFileRoute("/_authenticated/settings/users")({
  head: () => ({
    meta: [
      { title: "Users & Roles — ABL Inventory" },
      { name: "description", content: "Manage company members and RLS-enforced roles." },
    ],
  }),
  component: UsersRolesPage,
});

function UsersRolesPage() {
  const { companyId, isAdmin, userId } = useCompany();
  const qc = useQueryClient();

  const membersQ = useQuery({
    queryKey: ["company_members", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_members")
        .select("user_id, role, created_at, profile:profiles(full_name, email)")
        .eq("company_id", companyId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const changeRole = async (memberId: string, nextRole: AppRole) => {
    if (!isAdmin) return void toast.error("Only Admin users can change member roles");
    const { error } = await supabase
      .from("company_members")
      .update({ role: nextRole })
      .eq("company_id", companyId)
      .eq("user_id", memberId);
    if (error) return void toast.error(error.message);
    toast.success("Role updated");
    qc.invalidateQueries({ queryKey: ["company_members", companyId] });
  };

  return (
    <div className="p-6">
      <PageHeader title="Users & Roles" subtitle="Role-based access control enforced by Supabase Row-Level Security (RLS)" />
      <div className="max-w-3xl rounded-lg border bg-card p-5">
        {!isAdmin && (
          <p className="mb-3 text-sm text-muted-foreground">Only Admins can modify user roles.</p>
        )}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">User</th>
              <th className="py-2">Email</th>
              <th className="py-2">Role</th>
            </tr>
          </thead>
          <tbody>
            {(membersQ.data ?? []).map((m) => {
              const p = m.profile as unknown as { full_name: string | null; email: string | null } | null;
              return (
                <tr key={m.user_id} className="border-b">
                  <td className="py-2 font-medium">
                    {p?.full_name || "Member"} {m.user_id === userId && <Badge variant="outline" className="ml-1">You</Badge>}
                  </td>
                  <td className="py-2 text-muted-foreground">{p?.email ?? m.user_id.slice(0, 8)}</td>
                  <td className="py-2">
                    <select
                      aria-label={`Role for ${p?.email ?? m.user_id}`}
                      value={m.role}
                      disabled={!isAdmin}
                      onChange={(e) => void changeRole(m.user_id, e.target.value as AppRole)}
                      className="h-8 rounded-md border bg-surface px-2 text-sm"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
