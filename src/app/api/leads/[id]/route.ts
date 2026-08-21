import { z } from "zod";
import { AppError } from "@/lib/logger";
import type { Lead } from "@/lib/database.types";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";

const patchSchema = z.object({
  status: z.enum(["nuevo", "contactado", "presupuesto", "ganado", "perdido"]).optional(),
  name: z.string().max(120).nullable().optional(),
  company: z.string().max(120).nullable().optional(),
  valueCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await ctx.params;
    const leadId = z.string().uuid().parse(id);
    const body = patchSchema.parse(await request.json());
    const tenant = await requireCurrentTenant();
    await enforceRateLimit("lead", `update:${tenant.tenantId}`);

    if (Object.keys(body).length === 0) throw new AppError("Nada que actualizar.", 400);

    const patch: Partial<Lead> = { updated_at: new Date().toISOString() };
    if (body.status !== undefined) patch.status = body.status;
    if (body.name !== undefined) patch.name = body.name;
    if (body.company !== undefined) patch.company = body.company;
    if (body.valueCents !== undefined) patch.value_cents = body.valueCents;

    const db = adminClient();
    const { data, error } = await db
      .from("leads")
      .update(patch)
      // tenant_id en el propio UPDATE: el id de la URL nunca basta solo.
      .eq("id", leadId)
      .eq("tenant_id", tenant.tenantId)
      .select("*")
      .single();

    if (error || !data) throw new AppError("Lead no encontrado.", 404);
    return { lead: data };
  });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await ctx.params;
    const leadId = z.string().uuid().parse(id);
    const tenant = await requireCurrentTenant();

    const db = adminClient();
    const { error, count } = await db
      .from("leads")
      .delete({ count: "exact" })
      .eq("id", leadId)
      .eq("tenant_id", tenant.tenantId);

    if (error) throw error;
    if (!count) throw new AppError("Lead no encontrado.", 404);
    return { ok: true };
  });
}
