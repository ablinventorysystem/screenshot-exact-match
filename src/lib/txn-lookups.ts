import { supabase } from "@/integrations/supabase/client";

export interface LookupItem {
  id: string;
  name: string;
  days?: number;
  is_default?: boolean;
  body?: string;
  title?: string;
}

export const DEFAULT_TERMS: LookupItem[] = [
  { id: "cod", name: "COD", days: 0 },
  { id: "due_on_receipt", name: "Due on receipt", days: 0 },
  { id: "net_15", name: "Net 15", days: 15 },
  { id: "net_30", name: "Net 30", days: 30, is_default: true },
  { id: "net_60", name: "Net 60", days: 60 },
];

export const DEFAULT_SALES_REPS: LookupItem[] = [
  { id: "office_sales", name: "Office Sales" },
  { id: "michael_white", name: "Michael White" },
];

export const DEFAULT_SHIP_METHODS: LookupItem[] = [
  { id: "pickup", name: "Pickup" },
  { id: "lbc", name: "LBC" },
  { id: "jt", name: "J&T" },
  { id: "jrs", name: "JRS" },
  { id: "2go", name: "2GO" },
  { id: "own_delivery", name: "Own delivery" },
];

export const DEFAULT_CHANNELS: LookupItem[] = [
  { id: "direct", name: "Direct" },
  { id: "online", name: "Online" },
  { id: "wholesale", name: "Wholesale" },
  { id: "retail", name: "Retail" },
];

export const DEFAULT_DEPARTMENTS: LookupItem[] = [
  { id: "sales", name: "Sales" },
  { id: "operations", name: "Operations" },
  { id: "warehouse", name: "Warehouse" },
  { id: "admin", name: "Admin" },
];

export const DEFAULT_CLASSES: LookupItem[] = [
  { id: "general", name: "General" },
  { id: "retail", name: "Retail" },
  { id: "wholesale", name: "Wholesale" },
  { id: "project", name: "Project" },
];

export const DEFAULT_PREDEFINED_MESSAGES: LookupItem[] = [
  { id: "thanks", name: "Standard Thank You", title: "Standard Thank You", body: "Thank you for your business!" },
  { id: "reminder", name: "Payment Reminder", title: "Payment Reminder", body: "Please remit payment within the agreed terms." },
];

export const TAX_CODE_OPTIONS = [
  { code: "12% S", label: "12% S (12%)", kind: "vat" as const, rate: 12 },
  { code: "0% Z", label: "0% Zero-rated (0%)", kind: "zero_rated" as const, rate: 0 },
  { code: "EX", label: "Exempt (0%)", kind: "exempt" as const, rate: 0 },
];

export const PRICE_TIERS = ["List Price", "Wholesale", "Retail", "Distributor"];

async function safeSelect(table: string, companyId: string, cols = "id, name"): Promise<LookupItem[]> {
  try {
    const { data, error } = await (supabase.from(table as any).select(cols).eq("company_id", companyId) as any);
    if (error || !data || data.length === 0) return [];
    return data as LookupItem[];
  } catch {
    return [];
  }
}

export async function fetchTxnLookups(companyId: string) {
  const [terms, salesReps, shipMethods, channels, departments, classes, messages, locations] = await Promise.all([
    safeSelect("terms", companyId, "id, name, days, is_default"),
    safeSelect("sales_reps", companyId),
    safeSelect("ship_methods", companyId),
    safeSelect("channels", companyId),
    safeSelect("departments", companyId),
    safeSelect("classes", companyId),
    safeSelect("predefined_messages", companyId, "id, title, body"),
    safeSelect("locations", companyId, "id, name, address"),
  ]);

  return {
    terms: terms.length ? terms : DEFAULT_TERMS,
    salesReps: salesReps.length ? salesReps : DEFAULT_SALES_REPS,
    shipMethods: shipMethods.length ? shipMethods : DEFAULT_SHIP_METHODS,
    channels: channels.length ? channels : DEFAULT_CHANNELS,
    departments: departments.length ? departments : DEFAULT_DEPARTMENTS,
    classes: classes.length ? classes : DEFAULT_CLASSES,
    messages: messages.length ? messages : DEFAULT_PREDEFINED_MESSAGES,
    locations,
  };
}

export async function nextDocRef(companyId: string, txnType: string, defaultPrefix: string): Promise<{ refNo: string; seriesNo: number }> {
  try {
    const { data: seq } = await supabase
      .from("doc_sequences")
      .select("prefix, next_no, padding")
      .eq("company_id", companyId)
      .eq("txn_type", txnType as any)
      .maybeSingle();

    if (seq) {
      const num = seq.next_no ?? 1;
      const prefix = seq.prefix ?? defaultPrefix;
      const pad = seq.padding ?? 5;
      await supabase
        .from("doc_sequences")
        .update({ next_no: num + 1 })
        .eq("company_id", companyId)
        .eq("txn_type", txnType as any);
      return { refNo: `${prefix}${String(num).padStart(pad, "0")}`, seriesNo: num };
    }
  } catch {
    // Fallback if doc_sequences row doesn't exist
  }
  const fallbackNum = Math.floor(10000 + Math.random() * 90000);
  return { refNo: `${defaultPrefix}${fallbackNum}`, seriesNo: fallbackNum };
}

export async function writeAuditLog(
  companyId: string,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>,
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      company_id: companyId,
      user_id: user?.id ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details: details ?? {},
    } as any);
  } catch {
    // Non-blocking audit log
  }
}
