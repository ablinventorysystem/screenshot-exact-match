export const SUPPORTED_MERGE_FIELDS = [
  "CompanyName",
  "CompanyAddress",
  "CompanyTIN",
  "RefNo",
  "TxnDate",
  "DueDate",
  "PartyName",
  "PartyAddress",
  "PartyTIN",
  "Terms",
  "SalesRep",
  "CustomerPO",
  "Subtotal",
  "TaxAmount",
  "EwtAmount",
  "Total",
  "Balance",
  "Comment",
  "TableStart:Lines",
  "LineNo",
  "ItemSku",
  "ItemName",
  "Description",
  "PartNo",
  "Qty",
  "Uom",
  "Rate",
  "Amount",
  "TaxCode",
  "TableEnd:Lines",
] as const;

export interface ParsedDocxTemplate {
  recognized: string[];
  unknown: string[];
  hasLinesRegion: boolean;
}

const KNOWN_SET = new Set<string>(SUPPORTED_MERGE_FIELDS);

export async function parseDocxTemplate(file: File | ArrayBuffer): Promise<ParsedDocxTemplate> {
  const JSZip = (await import("jszip")).default;
  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  const xmlFiles = Object.keys(zip.files).filter(
    (name) => /^word\/(document|header\d*|footer\d*)\.xml$/i.test(name),
  );

  const found = new Set<string>();
  for (const name of xmlFiles) {
    const xml = await zip.file(name)?.async("string");
    if (!xml) continue;
    const text = xml.replace(/<[^>]+>/g, " ");

    // Match Word MERGEFIELD instructions: MERGEFIELD FieldName
    for (const m of text.matchAll(/MERGEFIELD\s+([A-Za-z0-9_:.-]+)/g)) {
      if (m[1]) found.add(m[1].trim());
    }
    // Match «FieldName»
    for (const m of text.matchAll(/«([A-Za-z0-9_:.-]+)»/g)) {
      if (m[1]) found.add(m[1].trim());
    }
    // Match {{FieldName}}
    for (const m of text.matchAll(/\{\{\s*([A-Za-z0-9_:.-]+)\s*\}\}/g)) {
      if (m[1]) found.add(m[1].trim());
    }
  }

  const recognized: string[] = [];
  const unknown: string[] = [];
  for (const f of found) {
    if (KNOWN_SET.has(f)) recognized.push(f);
    else unknown.push(f);
  }

  return {
    recognized: recognized.sort(),
    unknown: unknown.sort(),
    hasLinesRegion: found.has("TableStart:Lines"),
  };
}
