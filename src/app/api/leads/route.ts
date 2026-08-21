import { z } from "zod";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";

const STATUSES = ["nuevo", "contactado", "presupuesto", "ganado", "perdido"] as const;

const createSchema = z.object({
  name: z.string().max(120).optional(),
  platform: z.string().max(40).optional(),
  handle: z.string().max(120).optional(),
  message: z.string().max(2000).optional(),
  company: z.string().max(120).optional(),
  valueCents: z.number().int().min(0).max(100_000_000).optional(),
  source: z.enum(["manual", "inbox"]).default("manual"),
});

/**
 * Leads del Social CRM: de un mensaje o contacto real a un pipeline con
 * estado, para no perderlo en un hilo de conversación. Alta manual (llamada,
 * comentario, reunión) o desde una conversación real de Mensajes — nunca por
 * un clasificador en segundo plano leyendo cada DM: sobre mensajes reales de
 * clientes, un falso positivo cuesta más credibilidad que ahorra automatizar.
 */
export async function GET(request: Request) {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    const status = new URL(request.url).searchParams.get("status");

    let query = adminClient()
      .from("leads")
      .select("*")
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", z.enum(STATUSES).parse(status));

    const { data, error } = await query;
    if (error) throw error;
    return { leads: data ?? [] };
  });
}

export async function POST(request: Request) {
  return run(async () => {
    const body = createSchema.parse(await request.json());
    const tenant = await requireCurrentTenant();
    await enforceRateLimit("lead", `create:${tenant.tenantId}`);

    const db = adminClient();
    const { data, error } = await db
      .from("leads")
      .insert({
        tenant_id: tenant.tenantId,
        name: body.name ?? null,
        platform: body.platform ?? null,
        handle: body.handle ?? null,
        message: body.message ?? null,
        company: body.company ?? null,
        value_cents: body.valueCents ?? null,
        source: body.source,
        created_by: tenant.userId,
      })
      .select("*")
      .single();

    if (error || !data) throw error ?? new Error("No se pudo crear el lead.");
    return { lead: data };
  });
}
