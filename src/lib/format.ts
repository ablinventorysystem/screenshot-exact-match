export const peso = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (n: number | string | null | undefined, decimals = 0) =>
  Number(n ?? 0).toLocaleString("en-PH", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: Math.max(decimals, 0),
  });

export const fmtDate = (d: string | null | undefined) => {
  if (!d) return "";
  const dt = new Date(d.length === 10 ? `${d}T00:00:00` : d);
  return `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}/${dt.getFullYear()}`;
};

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const labelize = (s: string | null | undefined) =>
  (s ?? "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
