import { cn } from "@/lib/utils";

interface AppLogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-10 w-10 text-sm",
};

/** Reusable ABL Inventory circular brand mark (50% circle, accent-red #D32F2F, white Roboto 500 lettering). */
export function AppLogo({ size = "sm", className }: AppLogoProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-[#D32F2F] font-medium tracking-wide text-white select-none",
        SIZE_CLASSES[size],
        className
      )}
      aria-label="ABL Inventory"
    >
      ABL
    </span>
  );
}
