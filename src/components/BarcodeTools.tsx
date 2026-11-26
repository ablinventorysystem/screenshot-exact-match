import { useEffect, useId, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, Printer, QrCode, ScanLine, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Code128Svg({ value, height = 48 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        height,
        width: 1.6,
        displayValue: true,
        fontSize: 12,
        margin: 4,
      });
    } catch {
      // ignore invalid barcode characters
    }
  }, [value, height]);

  if (!value) return <span className="text-xs text-muted-foreground">No barcode</span>;
  return <svg ref={ref} className="max-w-full" />;
}

export function QrCanvas({ value, size = 120 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    QRCode.toCanvas(ref.current, value, { width: size, margin: 1 }).catch(() => {});
  }, [value, size]);

  if (!value) return <span className="text-xs text-muted-foreground">No QR value</span>;
  return <canvas ref={ref} />;
}

type LabelSize = "50x25" | "70x35" | "100x50";
const LABEL_DIMS: Record<LabelSize, { label: string; widthMm: number; heightMm: number }> = {
  "50x25": { label: "50 × 25 mm (Small)", widthMm: 50, heightMm: 25 },
  "70x35": { label: "70 × 35 mm (Standard)", widthMm: 70, heightMm: 35 },
  "100x50": { label: "100 × 50 mm (Shipping)", widthMm: 100, heightMm: 50 },
};

export function PrintLabelsDialog({
  open,
  onOpenChange,
  sku,
  name,
  barcode,
  price,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sku: string;
  name: string;
  barcode: string;
  price?: number;
}) {
  const [size, setSize] = useState<LabelSize>("70x35");
  const [copies, setCopies] = useState(1);
  const code = barcode || sku;
  const dims = LABEL_DIMS[size];

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-lg">
        <DialogHeader>
          <DialogTitle>Print labels</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="label-size">Label size</Label>
              <select
                id="label-size"
                value={size}
                onChange={(e) => setSize(e.target.value as LabelSize)}
                className="mt-1 h-9 w-full rounded-md border bg-surface px-3 text-sm"
              >
                {Object.entries(LABEL_DIMS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="label-copies">Copies</Label>
              <Input
                id="label-copies"
                type="number"
                min={1}
                max={100}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1 rounded-md"
              />
            </div>
          </div>

          <div className="rounded-lg border bg-muted p-4">
            <p className="mb-2 text-xs text-muted-foreground">
              Preview ({dims.widthMm}mm × {dims.heightMm}mm) — {copies} label(s)
            </p>
            <div
              className="mx-auto flex flex-col items-center justify-center rounded-md border bg-surface p-3 text-center"
              style={{ maxWidth: `${dims.widthMm * 3.5}px` }}
            >
              <div className="w-full truncate text-xs font-medium">{name}</div>
              <div className="text-[11px] text-muted-foreground">
                {sku}
                {price !== undefined ? ` · ₱${price.toFixed(2)}` : ""}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Code128Svg value={code} height={34} />
                <QrCanvas value={code} size={48} />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handlePrint}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface ScanMatch {
  kind: "item" | "lot" | "serial";
  itemId: string;
  lotId?: string;
  serialId?: string;
  label: string;
}

export function BarcodeScanBar({
  onMatch,
  placeholder = "Scan barcode, SKU, lot #, or serial # (Enter)",
}: {
  onMatch: (match: ScanMatch) => void;
  placeholder?: string;
}) {
  const { companyId } = useCompany();
  const [code, setCode] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const scannerId = useId().replace(/:/g, "");
  const qrRef = useRef<Html5Qrcode | null>(null);

  const lookup = async (raw: string) => {
    const q = raw.trim();
    if (!q || !companyId) return;
    setBusy(true);
    try {
      const { data: itemByCode } = await supabase
        .from("items")
        .select("id, sku, name")
        .eq("company_id", companyId)
        .or(`barcode.eq.${q},sku.eq.${q}`)
        .limit(1)
        .maybeSingle();

      if (itemByCode) {
        onMatch({ kind: "item", itemId: itemByCode.id, label: `${itemByCode.sku} — ${itemByCode.name}` });
        setCode("");
        return;
      }

      const { data: serialMatch } = await supabase
        .from("item_serials")
        .select("id, item_id, serial_no")
        .eq("company_id", companyId)
        .eq("serial_no", q)
        .limit(1)
        .maybeSingle();

      if (serialMatch) {
        onMatch({ kind: "serial", itemId: serialMatch.item_id, serialId: serialMatch.id, label: `Serial ${serialMatch.serial_no}` });
        setCode("");
        return;
      }

      const { data: lotMatch } = await supabase
        .from("item_lots")
        .select("id, item_id, lot_no")
        .eq("company_id", companyId)
        .eq("lot_no", q)
        .limit(1)
        .maybeSingle();

      if (lotMatch) {
        onMatch({ kind: "lot", itemId: lotMatch.item_id, lotId: lotMatch.id, label: `Lot ${lotMatch.lot_no}` });
        setCode("");
        return;
      }

      toast.error(`No item, lot, or serial matched "${q}"`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!cameraOpen) return;
    let active = true;
    const regionId = `qr-reader-${scannerId}`;
    const timer = setTimeout(async () => {
      try {
        const scanner = new Html5Qrcode(regionId);
        qrRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 140 } },
          (decodedText) => {
            if (!active) return;
            setCameraOpen(false);
            void lookup(decodedText);
          },
          () => {},
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Camera unavailable");
        setCameraOpen(false);
      }
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
      if (qrRef.current) {
        qrRef.current.stop().catch(() => {});
        qrRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen]);

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <ScanLine className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void lookup(code);
            }
          }}
          placeholder={placeholder}
          disabled={busy}
          className="h-9 rounded-md pl-8"
        />
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => void lookup(code)} disabled={busy || !code.trim()}>
        <QrCode className="mr-1 h-4 w-4" />
        Find
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setCameraOpen(true)} aria-label="Scan with camera">
        <Camera className="mr-1 h-4 w-4" />
        Camera
      </Button>

      <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
        <DialogContent className="max-w-md rounded-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Camera barcode scanner</span>
              <button type="button" onClick={() => setCameraOpen(false)} aria-label="Close scanner">
                <X className="h-4 w-4" />
              </button>
            </DialogTitle>
          </DialogHeader>
          <div id={`qr-reader-${scannerId}`} className="min-h-[240px] w-full overflow-hidden rounded-md border bg-muted" />
          <p className="text-xs text-muted-foreground">Point camera at a Code128 barcode or QR code.</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
