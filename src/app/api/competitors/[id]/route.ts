import { z } from "zod";
import { AppError } from "@/lib/logger";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await ctx.params;
    const competitorId = z.string().uuid().parse(id);
    const tenant = await requireCurrentTenant();

    const db = adminClient();
    // Filtro por tenant_id en el propio DELETE, no solo confiar en el id: sin
    // esto, adivinar el UUID de un competidor ajeno bastaría para borrarlo.
    const { error, count } = await db
      .from("competitors")
      .delete({ count: "exact" })
      .eq("id", competitorId)
      .eq("tenant_id", tenant.tenantId);

    if (error) throw error;
    if (!count) throw new AppError("Competidor no encontrado.", 404);

    return { ok: true };
  });
}
