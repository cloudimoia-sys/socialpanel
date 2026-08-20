import { z } from "zod";
import { nextSlot, type Slot } from "@/domain/slots";
import { AppError } from "@/lib/logger";
import { run } from "@/lib/route";
import { userClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";

/**
 * Cola de publicación: qué sale, dónde y cuándo.
 *
 * Una fila por post Y RED, no por post. Es la unidad real: el mismo contenido
 * puede haber salido bien en Instagram y haber fallado en TikTok, y una sola
 * fila por post obligaría a abrirlo para saber cuál de las dos cosas pasó.
 */

const slotSchema = z.object({
  platform: z.string().min(1).max(40),
  weekday: z.number().int().min(0).max(6),
  atTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    const supabase = await userClient();

    const [{ data: posts }, { data: slots }, { data: brand }] = await Promise.all([
      supabase
        .from("posts")
        .select("id, status, caption, brief, scheduled_at, scheduled_platforms")
        .eq("tenant_id", tenant.tenantId)
        .is("deleted_at", null)
        .in("status", ["scheduled", "publishing", "published", "failed"])
        .order("scheduled_at", { ascending: true, nullsFirst: false })
        .limit(60),
      supabase
        .from("publish_slots")
        .select("platform, weekday, at_time")
        .eq("tenant_id", tenant.tenantId),
      supabase
        .from("brand_profiles")
        .select("timezone")
        .eq("tenant_id", tenant.tenantId)
        .maybeSingle(),
    ]);

    const ids = (posts ?? []).map((p) => p.id);
    const { data: targets } = ids.length
      ? await supabase
          .from("post_targets")
          .select("post_id, platform, status, remote_url, error, published_at")
          .eq("tenant_id", tenant.tenantId)
          .in("post_id", ids)
      : { data: [] };

    const timeZone = brand?.timezone ?? "Europe/Madrid";
    const grid: Slot[] = (slots ?? []).map((s) => ({
      platform: s.platform,
      weekday: s.weekday,
      at_time: s.at_time,
    }));

    // Un post programado todavía no tiene `post_targets` — esos se crean al
    // publicar. Así que la fila sale de `scheduled_platforms` mientras espera,
    // y del destino real en cuanto se intenta.
    const rows = (posts ?? []).flatMap((post) => {
      const mine = (targets ?? []).filter((t) => t.post_id === post.id);
      const platforms = mine.length > 0 ? mine.map((t) => t.platform) : post.scheduled_platforms;

      return platforms.map((platform) => {
        const target = mine.find((t) => t.platform === platform);
        return {
          postId: post.id,
          title: (post.caption ?? post.brief ?? "").slice(0, 90),
          platform,
          scheduledAt: post.scheduled_at,
          publishedAt: target?.published_at ?? null,
          // Sin destino registrado, el estado es el del post; con destino, el
          // suyo, que es más preciso (una red puede fallar y otra no).
          status: target?.status ?? post.status,
          remoteUrl: target?.remote_url ?? null,
          error: target?.error ?? null,
        };
      });
    });

    const platformsWithSlots = [...new Set(grid.map((s) => s.platform))];

    return {
      timeZone,
      slots: platformsWithSlots.map((platform) => ({
        platform,
        next: nextSlot(grid, platform, timeZone)?.toISOString() ?? null,
      })),
      grid: grid.map((s) => ({ platform: s.platform, weekday: s.weekday, atTime: s.at_time })),
      rows,
    };
  });
}

/** Añade un hueco a la rejilla semanal. */
export async function POST(request: Request) {
  return run(async () => {
    const body = slotSchema.parse(await request.json());
    const tenant = await requireCurrentTenant();

    const { error } = await (await userClient()).from("publish_slots").insert({
      tenant_id: tenant.tenantId,
      platform: body.platform,
      weekday: body.weekday,
      at_time: `${body.atTime}:00`,
    });

    if (error) {
      // 23505 = duplicado. Ese hueco ya existe, que no es un fallo del sistema.
      if (error.code === "23505") throw new AppError("Ese hueco ya está en la rejilla.", 409);
      throw new AppError("No se pudo guardar el hueco.", 500, error.message);
    }

    return { ok: true };
  });
}

/** Quita un hueco de la rejilla. */
export async function DELETE(request: Request) {
  return run(async () => {
    const params = new URL(request.url).searchParams;
    const platform = params.get("platform");
    const weekday = Number(params.get("weekday"));
    const atTime = params.get("atTime");

    if (!platform || !atTime || !Number.isInteger(weekday)) {
      throw new AppError("Falta indicar qué hueco quitar.", 400);
    }

    const tenant = await requireCurrentTenant();
    const { error } = await (await userClient())
      .from("publish_slots")
      .delete()
      .eq("tenant_id", tenant.tenantId)
      .eq("platform", platform)
      .eq("weekday", weekday)
      .eq("at_time", `${atTime}:00`);

    if (error) throw new AppError("No se pudo quitar el hueco.", 500, error.message);

    return { ok: true };
  });
}
