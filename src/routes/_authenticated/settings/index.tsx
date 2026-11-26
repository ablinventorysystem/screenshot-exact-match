import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/settings/")({
  head: () => ({
    meta: [
      { title: "Settings — SOS Inventory" },
      { name: "description", content: "Company and tax settings." },
      { property: "og:title", content: "Settings — SOS Inventory" },
      { property: "og:description", content: "Company and tax settings." },
    ],
  }),
  component: () => (
    <div className="p-6">
      <PageHeader title="Settings" subtitle="Company preferences" />
      <Link to="/settings/tax" className="link-ref">Tax &amp; BIR</Link>
    </div>
  ),
});
