import { cookies } from "next/headers";
import { z } from "zod";
import { AppError } from "@/lib/logger";
import { run } from "@/lib/route";
import { userClient } from "@/lib/supabase";
import { requireCurrentTenant, TENANT_COOKIE } from "@/lib/tenant";

const bodySchema = z.object({ tenantId: z.string().uuid() });

/**
 * Cambia el tenant activo.
 *
 * Se valida la membresía aquí ANTES de escribir la cookie, con el cliente de
 * sesión (RLS), para devolver un 403 claro si alguien intenta apuntar a un
 * tenant ajeno. Pero esta comprobación es la segunda capa, no la única: la
 * de verdad es que `currentTenant()` la repite en cada carga con el mismo
 * criterio — si esta ruta tuviera un fallo, esa repetición sigue bloqueando
 * el acceso cruzado.
 */
export async function POST(request: Request) {
  return run(async () => {
    const body = bodySchema.parse(await request.json());
    await requireCurrentTenant();

    const { data: membership } = await (await userClient())
      .from("memberships")
      .select("tenant_id")
      .eq("tenant_id", body.tenantId)
      .maybeSingle();

    if (!membership) throw new AppError("No perteneces a ese tenant.", 403);

    const store = await cookies();
    store.set(TENANT_COOKIE, body.tenantId, {
      httpOnly: true,
      sameSite: "lax",
      // `secure` exige HTTPS: en local (http://localhost) la cookie no se
      // guardaría si fuera fija a true, y el cambio de tenant dejaría de
      // funcionar en desarrollo sin que hubiera ningún error visible.
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
    });

    return { ok: true, tenantId: body.tenantId };
  });
}
