import { z } from "zod";
import { AppError } from "@/lib/logger";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await ctx.params;
    const planId = z.string().uuid().parse(id);
    const tenant = await requireCurrentTenant();

    const db = adminClient();

    const { data: plan } = await db
      .from("content_plans")
      .select("id, title, period_start, period_end, status")
      .eq("id", planId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle();

    if (!plan) throw new AppError("Plan no encontrado.", 404);

    // La hora por defecto de la marca sirve para prerrellenar los selectores
    // del plan sin que el navegador tenga que adivinarla.
    const { data: brand } = await db
      .from("brand_profiles")
      .select("publish_hour, timezone")
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle();

    const { data: items } = await db
      .from("content_plan_items")
      .select(
        "id, idea, headline, rationale, suggested_platforms, suggested_media, scheduled_for, status, post_id, source_url, source_title",
      )
      .eq("plan_id", planId)
      .eq("tenant_id", tenant.tenantId)
      .order("position", { ascending: true });

    return {
      plan,
      items: items ?? [],
      defaults: {
        publishHour: brand?.publish_hour ?? 10,
        timezone: brand?.timezone ?? "Europe/Madrid",
      },
    };
  });
}
