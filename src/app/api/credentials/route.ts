import { z } from "zod";
import { encryptSecret, hintFor } from "@/lib/crypto";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant, requireTenantRole } from "@/lib/tenant";

/**
 * BYOK: el cliente guarda su propia API key.
 *
 * La clave se cifra aquí y solo se guarda el ciphertext. No existe ningún
 * endpoint que la devuelva — ni a su dueño. Lo único consultable es el "hint"
 * (últimos 4 caracteres) para que reconozca cuál tiene puesta.
 */

const providerSchema = z.enum(["anthropic", "gemini", "fal", "upload_post", "cloudflare"]);

export async function POST(request: Request) {
  return run(async () => {
    const body = z
      .object({ provider: providerSchema, apiKey: z.string().min(16).max(400) })
      .parse(await request.json());

    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);
    await enforceRateLimit("credentials", tenant.tenantId);

    const db = adminClient();
    const { error } = await db.from("provider_credentials").upsert(
      {
        tenant_id: tenant.tenantId,
        provider: body.provider,
        ciphertext: encryptSecret(body.apiKey, tenant.tenantId),
        hint: hintFor(body.apiKey),
      },
      { onConflict: "tenant_id,provider" },
    );

    if (error) throw new AppError("No se pudo guardar la clave.", 500, error.message);

    await db.from("audit_log").insert({
      tenant_id: tenant.tenantId,
      actor_id: tenant.userId,
      action: "credential.saved",
      target: body.provider,
    });

    return { provider: body.provider, hint: hintFor(body.apiKey) };
  });
}

export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);

    // Selección explícita sin `ciphertext`. Nunca uses select("*") aquí.
    const { data } = await adminClient()
      .from("provider_credentials")
      .select("provider, hint, created_at")
      .eq("tenant_id", tenant.tenantId);

    return { credentials: data ?? [] };
  });
}

export async function DELETE(request: Request) {
  return run(async () => {
    const provider = providerSchema.parse(new URL(request.url).searchParams.get("provider"));

    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);

    const db = adminClient();
    await db
      .from("provider_credentials")
      .delete()
      .eq("tenant_id", tenant.tenantId)
      .eq("provider", provider);

    await db.from("audit_log").insert({
      tenant_id: tenant.tenantId,
      actor_id: tenant.userId,
      action: "credential.deleted",
      target: provider,
    });

    return { ok: true };
  });
}
