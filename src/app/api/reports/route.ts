import { NextResponse } from "next/server";
import { renderMonthlyReport } from "@/domain/report";
import { AppError, log } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";
import { credentialFor, publishProvider } from "@/providers/registry";

/**
 * Informe mensual en PDF.
 *
 * No usa `run()`: ese envoltorio siempre responde `NextResponse.json(...)`, y
 * esto tiene que devolver bytes con `Content-Type: application/pdf`. Es la
 * primera ruta binaria del proyecto — el resto de descargas (media) va por
 * URL firmada de Storage, nunca proxeada por esta app.
 */
export async function GET(_request: Request) {
  try {
    const tenant = await requireCurrentTenant();
    // No cuesta dinero de proveedor, pero renderizar sí consume CPU: cubo
    // propio para que generar informes en bucle no comparta límite con la
    // generación de contenido real.
    await enforceRateLimit("report", tenant.tenantId);

    const db = adminClient();
    const since = new Date(Date.now() - 30 * 86_400_000);

    const [{ data: brand }, { data: recentPosts }, { count: scheduledCount }, { data: winners }] =
      await Promise.all([
        db.from("brand_profiles").select("business_name").eq("tenant_id", tenant.tenantId).maybeSingle(),
        db
          .from("posts")
          .select("status")
          .eq("tenant_id", tenant.tenantId)
          .is("deleted_at", null)
          .gte("created_at", since.toISOString()),
        db
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.tenantId)
          .is("deleted_at", null)
          .eq("status", "scheduled"),
        db
          .from("posts")
          .select("caption, brief")
          .eq("tenant_id", tenant.tenantId)
          .is("deleted_at", null)
          .eq("is_winner", true)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

    // Mismas dos llamadas que /api/metrics, para que el informe muestre
    // exactamente lo mismo que la pantalla — un informe que no cuadra con lo
    // que el cliente ya vio en la app sería peor que no tener informe.
    const provider = publishProvider();
    const cred = await credentialFor(tenant.tenantId, "upload_post");
    const accounts = await provider.listAccounts(tenant.tenantId, cred);
    const metrics = await provider.accountMetrics(
      tenant.tenantId,
      accounts.map((a) => a.platform),
      cred,
    );

    const pdf = await renderMonthlyReport({
      businessName: brand?.business_name ?? tenant.tenantName,
      periodLabel: `${since.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} — ${new Date().toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}`,
      generatedAt: new Date(),
      postsCreated: recentPosts?.length ?? 0,
      postsPublished: (recentPosts ?? []).filter((p) => p.status === "published").length,
      postsScheduled: scheduledCount ?? 0,
      platforms: metrics
        .filter((m) => !m.unavailable)
        .map((m) => ({ platform: m.platform, followers: m.followers, impressions: m.impressions })),
      winners: (winners ?? []).map((w) => (w.caption ?? w.brief ?? "").slice(0, 140)).filter(Boolean),
    });

    const filename = `informe-${new Date().toISOString().slice(0, 10)}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        // "attachment" y no "inline": queremos que el navegador lo descargue,
        // no que intente abrirlo en la propia pestaña del panel.
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      log.warn(error.publicMessage, { status: error.status, internal: error.internal });
      return NextResponse.json({ error: error.publicMessage }, { status: error.status });
    }
    log.error("no se pudo generar el informe", { error: String(error) });
    return NextResponse.json({ error: "No se pudo generar el informe." }, { status: 500 });
  }
}
