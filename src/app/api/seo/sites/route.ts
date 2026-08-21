import { z } from "zod";
import { assertModule } from "@/domain/quota";
import { requireSearchConsoleToken, searchConsoleToken } from "@/domain/seo";
import { planFor } from "@/domain/plans";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";
import { listSites, searchConsoleConfigured } from "@/providers/seo/search-console";

/**
 * Webs del cliente: las que ya sigue y las que Google le ofrece.
 *
 * Se devuelven las dos cosas en la misma respuesta porque la pantalla las
 * necesita juntas: no se puede pintar "elige una web" sin saber cuáles ya
 * están elegidas.
 */
export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    await assertModule(tenant.tenantId, "seo");

    const { data: sites } = await adminClient()
      .from("seo_sites")
      .select("id, site_url, created_at")
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: true });

    const token = await searchConsoleToken(tenant.tenantId);
    if (!token) {
      return {
        connected: false,
        configured: searchConsoleConfigured(),
        sites: sites ?? [],
        available: [],
      };
    }

    // Que la cuenta de Google haya caducado no debe dejar la pantalla en
    // blanco: las webs ya elegidas se siguen listando y se avisa de que hay
    // que reconectar.
    let available: { siteUrl: string; permissionLevel: string }[] = [];
    let expired = false;
    try {
      available = await listSites(token);
    } catch (error) {
      if (error instanceof AppError && error.status === 401) expired = true;
      else throw error;
    }

    return {
      connected: !expired,
      configured: searchConsoleConfigured(),
      sites: sites ?? [],
      available,
    };
  });
}

const addSchema = z.object({ siteUrl: z.string().min(3).max(300) });

export async function POST(request: Request) {
  return run(async () => {
    const body = addSchema.parse(await request.json());
    const tenant = await requireCurrentTenant();
    await assertModule(tenant.tenantId, "seo");
    await enforceRateLimit("competitor", `seo-site:${tenant.tenantId}`);

    const token = await requireSearchConsoleToken(tenant.tenantId);

    // La web tiene que estar de verdad entre las que esa cuenta de Google
    // controla. Sin esta comprobación, cualquiera podría guardar el dominio
    // de otra empresa y la pantalla intentaría pedir sus datos — se
    // rechazaría en Google, pero es una consulta a nombre de este tenant que
    // no tiene por qué llegar a hacerse.
    const available = await listSites(token);
    if (!available.some((s) => s.siteUrl === body.siteUrl)) {
      throw new AppError("Esa web no aparece en tu Search Console.", 403);
    }

    const db = adminClient();

    // Tope del plan. Se cuenta antes de insertar y sobre las filas reales,
    // no sobre lo que diga el cliente.
    const { data: tenantRow } = await db
      .from("tenants")
      .select("plan")
      .eq("id", tenant.tenantId)
      .single();
    const plan = planFor(tenantRow?.plan ?? "trial");
    const max = plan.seo?.sites ?? 0;

    const { count } = await db
      .from("seo_sites")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.tenantId);

    if ((count ?? 0) >= max) {
      throw new AppError(`El plan ${plan.name} permite seguir ${max} web(s).`, 402);
    }

    const { data, error } = await db
      .from("seo_sites")
      .insert({ tenant_id: tenant.tenantId, site_url: body.siteUrl })
      .select("id, site_url, created_at")
      .single();

    if (error || !data) throw new AppError("No se pudo guardar la web.", 500, error?.message);
    return { site: data };
  });
}

export async function DELETE(request: Request) {
  return run(async () => {
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    const tenant = await requireCurrentTenant();
    await assertModule(tenant.tenantId, "seo");

    const { error, count } = await adminClient()
      .from("seo_sites")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("tenant_id", tenant.tenantId);

    if (error) throw new AppError("No se pudo quitar la web.", 500, error.message);
    if (!count) throw new AppError("Web no encontrada.", 404);
    return { ok: true };
  });
}
