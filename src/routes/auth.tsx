import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { AppLogo } from "@/components/AppLogo";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthSearch = { redirect?: string };

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): AuthSearch =>
    typeof s["redirect"] === "string" ? { redirect: s["redirect"] } : {},
  head: () => ({
    meta: [
      { title: "Sign in — ABL Inventory System" },
      { name: "description", content: "Sign in to your ABL Inventory System company account." },
      { property: "og:title", content: "Sign in — ABL Inventory System" },
      { property: "og:description", content: "Sign in to your ABL Inventory System company account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function safePath(p: string | undefined) {
  if (!p) return "/dashboard";
  try {
    const u = new URL(p, window.location.origin);
    if (u.origin !== window.location.origin) return "/dashboard";
    return u.pathname + u.search;
  } catch {
    return "/dashboard";
  }
}

const REMEMBER_EMAIL_KEY = "abl.rememberEmail";

function MolecularBackdrop() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-20"
      viewBox="0 0 800 600"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1">
        <line x1="120" y1="120" x2="280" y2="200" />
        <line x1="280" y1="200" x2="460" y2="140" />
        <line x1="460" y1="140" x2="640" y2="240" />
        <line x1="280" y1="200" x2="340" y2="380" />
        <line x1="340" y1="380" x2="540" y2="420" />
        <line x1="460" y1="140" x2="540" y2="420" />
        <line x1="120" y1="120" x2="180" y2="360" />
        <line x1="180" y1="360" x2="340" y2="380" />
      </g>
      <g fill="currentColor">
        <circle cx="120" cy="120" r="6" />
        <circle cx="280" cy="200" r="8" />
        <circle cx="460" cy="140" r="7" />
        <circle cx="640" cy="240" r="5" />
        <circle cx="340" cy="380" r="9" />
        <circle cx="540" cy="420" r="6" />
        <circle cx="180" cy="360" r="5" />
      </g>
    </svg>
  );
}

function AuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [showSplash, setShowSplash] = useState(true);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(REMEMBER_EMAIL_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => {
    try {
      return Boolean(localStorage.getItem(REMEMBER_EMAIL_KEY));
    } catch {
      return false;
    }
  });
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setShowSplash(false), 550);
    return () => window.clearTimeout(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setBusy(true);
    try {
      if (rememberMe && email) {
        localStorage.setItem(REMEMBER_EMAIL_KEY, email);
      } else {
        localStorage.removeItem(REMEMBER_EMAIL_KEY);
      }

      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: safePath(search.redirect), replace: true });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin, data: { full_name: fullName } },
        });
        if (error) throw error;
        if (data.session) navigate({ to: "/dashboard", replace: true });
        else setSent(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen bg-slate-50">
      {/* Brief non-blocking Splash Screen */}
      {showSplash && (
        <div
          onClick={() => setShowSplash(false)}
          className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-gradient-to-br from-[#0a192f] via-[#102a52] to-[#1d4ed8] text-white transition-opacity duration-300"
        >
          <MolecularBackdrop />
          <div className="relative z-10 flex flex-col items-center gap-4 px-4 text-center">
            <div className="rounded-2xl bg-white/10 p-4 backdrop-blur-sm">
              <AppLogo size="lg" />
            </div>
            <h1 className="text-2xl font-semibold tracking-wider sm:text-3xl">
              ABL INVENTORY SYSTEM
            </h1>
            <p className="text-sm text-blue-100">Smart Business. Simplified.</p>
            <Loader2 className="mt-2 h-5 w-5 animate-spin text-blue-200" />
          </div>
        </div>
      )}

      {/* Left Corporate Brand Panel (Desktop) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0a192f] via-[#102a52] to-[#1d4ed8] p-10 text-white lg:flex">
        <MolecularBackdrop />
        <div className="relative z-10 flex items-center gap-3">
          <div className="rounded-xl bg-white/10 p-2">
            <AppLogo size="lg" />
          </div>
          <div>
            <div className="text-lg font-semibold tracking-wide">ABL INVENTORY SYSTEM</div>
            <div className="text-xs text-blue-200">Smart Business. Simplified.</div>
          </div>
        </div>

        <div className="relative z-10 max-w-md space-y-4">
          <h2 className="text-3xl font-semibold leading-tight">
            Enterprise Inventory, Sales &amp; BIR-Ready Accounting
          </h2>
          <p className="text-sm leading-relaxed text-blue-100">
            Manage multi-warehouse stock, sales orders, purchase orders, fulfillment, and Philippine
            BIR VAT &amp; EWT compliance in one unified workspace.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-xs text-blue-200">
          <ShieldCheck className="h-4 w-4" />
          <span>Secured with Supabase Row-Level Security</span>
        </div>
      </div>

      {/* Right Login Form Panel */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md rounded-[10px] border border-slate-200 bg-white p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <AppLogo size="lg" />
            <div>
              <div className="text-lg font-semibold text-[#0a192f]">ABL INVENTORY SYSTEM</div>
              <div className="text-xs text-slate-500">Smart Business. Simplified.</div>
            </div>
          </div>

          {sent ? (
            <div className="space-y-4">
              <h1 className="text-2xl font-semibold text-slate-900">Check your email</h1>
              <p className="text-sm text-slate-600">
                We sent a confirmation link to <span className="font-medium">{email}</span>. Confirm
                your account, then sign in.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSent(false);
                  setMode("signin");
                }}
              >
                Back to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">
                  {mode === "signin" ? "Sign in to your account" : "Create your account"}
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  {mode === "signin"
                    ? "Enter your work email and password to continue."
                    : "Set up your ABL Inventory System credentials."}
                </p>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="rounded-[6px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  {errorMsg}
                </div>
              )}

              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="fullName" className="text-xs font-medium text-slate-700">
                    Full name
                  </Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Juan Dela Cruz"
                    required
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-slate-700">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  autoComplete="email"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium text-slate-700">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {mode === "signin" && (
                <div className="flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                    <Checkbox
                      checked={rememberMe}
                      onCheckedChange={(v) => setRememberMe(Boolean(v))}
                    />
                    Remember me
                  </label>
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-[#1d4ed8] text-white hover:bg-[#1e40af]"
                disabled={busy}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Please wait...
                  </>
                ) : mode === "signin" ? (
                  "Sign in"
                ) : (
                  "Create account"
                )}
              </Button>

              <p className="text-center text-xs text-slate-500">
                {mode === "signin" ? "No account yet? " : "Already have an account? "}
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setMode(mode === "signin" ? "signup" : "signin");
                  }}
                  className="font-medium text-[#1d4ed8] hover:underline"
                >
                  {mode === "signin" ? "Create one" : "Sign in"}
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
