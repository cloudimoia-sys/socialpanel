import { z } from "zod";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { userClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";
import { LIMITS_BY_PLATFORM } from "@/domain/platform-rules";
import { assertQuota } from "@/domain/quota";
import { inngest, mediaSpec } from "@/inngest/client";
import { fetchArticle } from "@/providers/news/article";

const bodySchema = z.object({
  brief: z.string().min(5).max(4000),
  platforms: z
    .array(z.enum(Object.keys(LIMITS_BY_PLATFORM) as [string, ...string[]]))
    .min(1)
    .max(9),
  language: z.string().min(2).max(20).default("es"),
  tone: z.string().max(100).optional(),
  media: mediaSpec.default({ mode: "none" }),
  // URL de una noticia real que el operador elige a mano, para comentarla en
  // el post. Se vuelve a descargar en el servidor: nunca se confía en el
  // titular que pudiera venir del cliente.
  sourceUrl: z.string().url().max(2000).optional(),
});

const POST_STATUSES = [
  "draft",
  "generating",
  "ready",
  "scheduled",
  "publishing",
  "published",
  "failed",
] as const;

const listSchema = z.object({
  /** Rango por fecha PROGRAMADA, para el calendario. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Se validan contra la lista real en vez de pasar el texto tal cual: un
  // estado inventado en la URL debe dar 422, no una consulta que no filtra.
  status: z
    .string()
    .max(200)
    .transform((raw) => raw.split(","))
    .pipe(z.array(z.enum(POST_STATUSES)).min(1))
    .optional(),
  flag: z.enum(["favorite", "winner"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/**
 * Listado de posts. Lo consumen el calendario y la biblioteca.
 *
 * Un solo endpoint con filtros en vez de uno por pantalla: las dos piden lo
 * mismo con distinto recorte, y duplicarlo garantizaría que se separen en
 * cuanto una añada un campo.
 */
export async function GET(request: Request) {
  return run(async () => {
    const params = new URL(request.url).searchParams;
    const filters = listSchema.parse(Object.fromEntries(params));
    const tenant = await requireCurrentTenant();

    const supabase = await userClient();
    let query = supabase
      .from("posts")
      .select(
        "id, status, caption, brief, scheduled_at, scheduled_platforms, asset_id, is_favorite, is_winner, created_at",
      )
      .eq("tenant_id", tenant.tenantId)
      .is("deleted_at", null);

    if (filters.from) query = query.gte("scheduled_at", `${filters.from}T00:00:00Z`);
    if (filters.to) query = query.lte("scheduled_at", `${filters.to}T23:59:59Z`);
    if (filters.flag === "favorite") query = query.eq("is_favorite", true);
    if (filters.flag === "winner") query = query.eq("is_winner", true);
    if (filters.status) query = query.in("status", filters.status);

    // Por fecha programada cuando la hay: en el calendario y la cola importa
    // cuándo sale, no cuándo se creó.
    const { data, error } = await query
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(filters.limit);

    if (error) throw new AppError("No se pudieron cargar los posts.", 500, error.message);

    return { posts: data ?? [] };
  });
}

/** Crea un post y encola su generación. */
export async function POST(request: Request) {
  return run(async () => {
    const body = bodySchema.parse(await request.json());

    // El tenant sale de la sesión, no del payload: no hay ID que manipular.
    const tenant = await requireCurrentTenant();
    await enforceRateLimit("generate", `${tenant.tenantId}:${tenant.userId}`);

    // La cuota se comprueba aquí, antes de crear nada. Detectar el exceso al
    // facturar no es un tope, es una factura sorpresa.
    await assertQuota(tenant.tenantId, "post");
    // El infograma no cuesta nada de proveedor, pero cuenta como imagen y no
    // como vídeo: la cuota de vídeo representa segundos facturados de verdad,
    // y tratarlo como tal penalizaría un recurso que en realidad es gratis.
    if (body.media.mode === "generate-image" || body.media.mode === "generate-infographic") {
      await assertQuota(tenant.tenantId, "image");
    }
    if (body.media.mode === "generate-video") {
      await assertQuota(tenant.tenantId, "video", body.media.durationSeconds);
    }

    // Se resuelve ANTES de crear el post: si la URL no se puede leer, es
    // mejor devolver el error ahora que dejar un post a medias sin fuente.
    const news = body.sourceUrl ? await fetchArticle(body.sourceUrl) : null;
    if (body.sourceUrl && !news) {
      throw new AppError(
        "No hemos podido leer esa noticia. Comprueba la URL o inténtalo sin ella.",
        422,
      );
    }

    const supabase = await userClient();
    const { data, error } = await supabase
      .from("posts")
      .insert({
        tenant_id: tenant.tenantId,
        created_by: tenant.userId,
        status: "generating",
        brief: body.brief,
        source_url: news?.url ?? null,
        source_title: news?.title ?? null,
      })
      .select("id")
      .single();

    if (error || !data) throw new AppError("No se pudo crear el post.", 500, error?.message);

    try {
      await inngest.send({
        name: "post/generate.requested",
        data: {
          tenantId: tenant.tenantId,
          postId: data.id,
          brief: body.brief,
          platforms: body.platforms,
          language: body.language,
          tone: body.tone,
          media: body.media,
          news: news ?? undefined,
        },
      });
    } catch (cause) {
      // Si no se encola, el post se quedaría en "generating" para siempre.
      await supabase
        .from("posts")
        .update({ status: "failed", error: "No se pudo encolar la generación." })
        .eq("id", data.id)
        .eq("tenant_id", tenant.tenantId);

      throw new AppError(
        "El servicio de generación no está disponible. Comprueba que la cola esté arrancada.",
        503,
        cause,
      );
    }

    return { id: data.id, status: "generating" };
  });
}
