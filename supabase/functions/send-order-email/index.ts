import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { to, cc, subject, bodyText, refNo, attachmentName } = body as {
      to?: string;
      cc?: string;
      subject?: string;
      bodyText?: string;
      refNo?: string;
      attachmentName?: string;
    };

    if (!to) {
      return new Response(JSON.stringify({ error: "Recipient 'to' is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mock send response (logged on the client via audit_log)
    return new Response(
      JSON.stringify({
        ok: true,
        messageId: `mock-${crypto.randomUUID()}`,
        to,
        cc: cc ?? null,
        subject: subject ?? `Order ${refNo ?? ""}`,
        bodyPreview: (bodyText ?? "").slice(0, 120),
        attachmentName: attachmentName ?? null,
        sentAt: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
