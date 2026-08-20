import { redirect } from "next/navigation";
import { spentThisMonthCents } from "@/domain/usage";
import { IMPRESSIONS_LABEL } from "@/domain/metric-labels";
import { AppError } from "@/lib/logger";
import { adminClient } from "@/lib/supabase";
import { currentTenant } from "@/lib/tenant";
import { credentialFor, publishProvider } from "@/providers/registry";
import type { PlatformMetrics } from "@/providers/types";
import { IconCalendar, IconInbox, IconPlus, IconShare, IconSparkle, IconTrophy } from "@/app/icons";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";
import { AreaChart } from "@/app/dashboard/chart";

export const dynamic = "force-dynamic";

const euros = (cents: number) => `${(cents / 100).toFixed(2)} €`;
const num = (n: number) => Math.round(n).toLocaleString("es-ES");

const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "borrador", className: "badge" },
  generating: { label: "generando", className: "badge badge-brand" },
  ready: { label: "listo", className: "badge badge-ok" },
  scheduled: { label: "programado", className: "badge badge-brand" },
  publishing: { label: "publicando", className: "badge badge-brand" },
  published: { label: "publicado", className: "badge badge-ok" },
  failed: { label: "falló", className: "badge badge-danger" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** ▲/▼/— y color, a partir de dos totales. `null` cuando no hay con qué comparar. */
function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) {
    return current > 0 ? <span className="delta delta-up">nuevo</span> : null;
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return <span className="delta delta-flat">— 0%</span>;
  return (
    <span className={pct > 0 ? "delta delta-up" : "delta delta-down"}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

export default async function DashboardPage() {
  // Todo acceso aterriza aquí (el callback de login manda a /dashboard), así
  // que este es el sitio donde interceptar a quien no está invitado: llega
  // autenticado, y sin esto vería un error genérico en vez de una explicación.
  let tenant;
  try {
    tenant = await currentTenant();
  } catch (cause) {
    if (cause instanceof AppError && cause.publicMessage === "NOT_INVITED") {
      redirect("/sin-acceso");
    }
    throw cause;
  }

  if (!tenant) redirect("/login");

  const db = adminClient();
  const now = new Date();
  const since60 = new Date(now.getTime() - 60 * 86400000);

  const [{ data: brand }, { data: accounts }, { data: recent }, { data: last60 }, { data: winners }, spent] =
    await Promise.all([
      db
        .from("brand_profiles")
        .select("business_name, primary_platform")
        .eq("tenant_id", tenant.tenantId)
        .maybeSingle(),
      db.from("social_accounts").select("platform, handle, status").eq("tenant_id", tenant.tenantId),
      db
        .from("posts")
        .select("id, status, caption, brief, created_at")
        .eq("tenant_id", tenant.tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(6),
      // Una sola consulta de 60 días para dos cosas: la gráfica de los últimos
      // 30 y el total de los 30 anteriores con los que compararla. Pedirlos
      // por separado sería la misma tabla dos veces.
      db
        .from("posts")
        .select("created_at")
        .eq("tenant_id", tenant.tenantId)
        .is("deleted_at", null)
        .gte("created_at", since60.toISOString()),
      db
        .from("posts")
        .select("id, caption, brief, scheduled_platforms, created_at")
        .eq("tenant_id", tenant.tenantId)
        .is("deleted_at", null)
        .eq("is_winner", true)
        .order("created_at", { ascending: false })
        .limit(5),
      spentThisMonthCents(tenant.tenantId),
    ]);

  // Métrica real de UNA sola red (la que el tenant eligió como referencia),
  // nunca sumada ni promediada entre redes: cada una mide "alcance" de forma
  // distinta (alcance real, reproducciones, impresiones…), así que un único
  // número combinado no significaría nada — la misma razón por la que
  // Métricas traduce cada campo por red en vez de por nombre de campo.
  let primaryMetrics: PlatformMetrics | null = null;
  const primaryConnected = brand?.primary_platform
    ? (accounts ?? []).some((a) => a.platform === brand.primary_platform && a.status === "active")
    : false;

  if (brand?.primary_platform && primaryConnected) {
    try {
      const cred = await credentialFor(tenant.tenantId, "upload_post");
      const [m] = await publishProvider().accountMetrics(tenant.tenantId, [brand.primary_platform], cred);
      if (m && !m.unavailable) primaryMetrics = m;
    } catch {
      // Sin credencial o sin respuesta de Upload-Post: el KPI se omite en vez
      // de tumbar el resto del Panel por un proveedor externo caído.
      primaryMetrics = null;
    }
  }

  const engagementPct =
    primaryMetrics && primaryMetrics.impressions && primaryMetrics.impressions > 0
      ? ((primaryMetrics.likes ?? 0) + (primaryMetrics.comments ?? 0) + (primaryMetrics.shares ?? 0)) /
        primaryMetrics.impressions *
        100
      : null;

  const { data: upcoming } = await db
    .from("posts")
    .select("id, caption, brief, scheduled_at, scheduled_platforms")
    .eq("tenant_id", tenant.tenantId)
    .is("deleted_at", null)
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true })
    .limit(5);

  const pct = Math.min(100, (spent / Math.max(1, tenant.budgetCents)) * 100);
  const tight = spent > tenant.budgetCents * 0.8;

  // Serie diaria de los últimos 30 días, y el total de los 30 anteriores para
  // la variación. Se cuenta por CREACIÓN, no por publicación: es el dato que
  // siempre existe (post_targets.published_at varía por red), y "cuánto
  // contenido produces" es una cifra propia que sí se puede comparar día a
  // día — al contrario que el alcance, que cada red mide a su manera.
  const days: { date: string; value: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push({ date: isoDay(d), value: 0 });
  }
  const byDay = new Map(days.map((d) => [d.date, d]));

  let last30Count = 0;
  let prev30Count = 0;
  const boundary = new Date(now.getTime() - 30 * 86400000);

  for (const row of last60 ?? []) {
    const created = new Date(row.created_at);
    if (created >= boundary) {
      last30Count += 1;
      const bucket = byDay.get(isoDay(created));
      if (bucket) bucket.value += 1;
    } else {
      prev30Count += 1;
    }
  }

  const scheduledCount = upcoming?.length ?? 0;

  // Recomendaciones: reglas sobre datos reales que ya se han cargado arriba,
  // no una llamada a un modelo. Cada una se calcula de un dato concreto y
  // dice de dónde sale, para que no se lean como una caja negra.
  const recommendations: string[] = [];

  if (winners && winners.length > 0) {
    const w = winners[0]!;
    recommendations.push(
      `"${(w.caption ?? w.brief ?? "Ese post").slice(0, 60)}" está marcado como ganador — reutilízalo en otro formato desde Contenido.`,
    );
  }

  if (prev30Count > 0 && last30Count < prev30Count * 0.7) {
    const drop = Math.round((1 - last30Count / prev30Count) * 100);
    recommendations.push(
      `Publicaste ${drop}% menos que el mes anterior (${last30Count} frente a ${prev30Count}). Configura huecos fijos en Cola para no depender de acordarte.`,
    );
  }

  const activePlatforms = new Set((accounts ?? []).filter((a) => a.status === "active").map((a) => a.platform));
  const usedPlatforms = new Set<string>();
  for (const p of upcoming ?? []) for (const plat of p.scheduled_platforms) usedPlatforms.add(plat);
  const unusedPlatforms = [...activePlatforms].filter((p) => !usedPlatforms.has(p));
  if (unusedPlatforms.length > 0 && activePlatforms.size > 1) {
    recommendations.push(
      `${unusedPlatforms.map(platformLabel).join(", ")} está conectada pero no aparece en lo programado — diversifica el alcance repartiendo entre tus redes.`,
    );
  }

  if (tight) {
    recommendations.push(
      `Vas por el ${Math.round(pct)}% del presupuesto de este mes (${euros(spent)}). Revisa el consumo en Suscripción antes de seguir generando.`,
    );
  }

  return (
    <main>
      <header className="page-head">
        <h1>{brand?.business_name ?? tenant.tenantName}</h1>
        <p>
          {tenant.email} · {tenant.role}
        </p>
      </header>

      {!brand && (
        <div className="card" style={{ borderColor: "var(--brand)" }}>
          <h2 style={{ marginBottom: "var(--s2)" }}>Empieza por el perfil de la empresa</h2>
          <p className="muted" style={{ marginBottom: "var(--s4)" }}>
            Se rellena una vez. Todo lo que generes después usará ese contexto, y es lo
            que hace que el contenido suene a tu negocio y no a IA genérica.
          </p>
          <a href="/dashboard/brand" className="btn">
            Rellenar perfil
          </a>
        </div>
      )}

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-head">
            <Delta current={last30Count} previous={prev30Count} />
          </div>
          <div className="value">{last30Count}</div>
          <div className="label">Publicaciones · 30 días</div>
        </div>

        <div className="kpi">
          <div className="kpi-head" />
          <div className="value">{scheduledCount}</div>
          <div className="label">Programadas</div>
        </div>

        <div className="kpi">
          <div className="kpi-head" />
          <div className="value">{primaryMetrics?.impressions != null ? num(primaryMetrics.impressions) : "—"}</div>
          <div className="label">
            {brand?.primary_platform
              ? `${IMPRESSIONS_LABEL[brand.primary_platform] ?? "Alcance"} · ${platformLabel(brand.primary_platform)} · 30 días`
              : "Alcance · 30 días"}
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-head" />
          <div className="value">{engagementPct != null ? `${engagementPct.toFixed(1)}%` : "—"}</div>
          <div className="label">
            {brand?.primary_platform ? `Engagement · ${platformLabel(brand.primary_platform)}` : "Engagement medio"}
          </div>
        </div>
      </div>

      {!brand?.primary_platform && (accounts?.length ?? 0) > 0 && (
        <p className="hint" style={{ marginTop: 0 }}>
          Elige una red principal en <a href="/dashboard/brand">Empresa</a> para ver alcance y
          engagement reales aquí.
        </p>
      )}

      <section className="card">
        <h2 className="card-title">Publicaciones creadas · últimos 30 días</h2>
        <div style={{ marginTop: "var(--s3)" }}>
          <AreaChart
            points={days.map((d) => ({
              label: new Date(`${d.date}T12:00:00`).toLocaleDateString("es-ES", {
                day: "numeric",
                month: "short",
              }),
              value: d.value,
            }))}
            height={200}
            label="Publicaciones creadas por día en los últimos 30 días"
          />
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Próximas publicaciones</h2>
            <a href="/dashboard/calendar" className="btn btn-ghost btn-sm">
              <IconCalendar />
              Ver calendario
            </a>
          </div>

          {upcoming && upcoming.length > 0 ? (
            <ul className="list">
              {upcoming.map((p) => (
                <li key={p.id}>
                  <span style={{ display: "flex", gap: ".3rem" }}>
                    {p.scheduled_platforms.slice(0, 3).map((platform) => (
                      <PlatformIcon key={platform} platform={platform} size={16} />
                    ))}
                  </span>
                  <a href={`/dashboard/posts/${p.id}`} className="truncate" style={{ flex: 1 }}>
                    {(p.caption ?? p.brief ?? "Sin texto todavía").slice(0, 60)}
                  </a>
                  <span className="muted" style={{ whiteSpace: "nowrap" }}>
                    {p.scheduled_at &&
                      new Date(p.scheduled_at).toLocaleDateString("es-ES", {
                        day: "numeric",
                        month: "short",
                      })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint" style={{ marginBottom: 0 }}>
              Nada programado todavía.{" "}
              <a href="/dashboard/plan">Genera un plan</a> o crea un post suelto.
            </p>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Redes conectadas</h2>
            <span className="badge">{accounts?.length ?? 0}</span>
          </div>

          {accounts && accounts.length > 0 ? (
            <ul className="list">
              {accounts.map((a) => (
                <li key={`${a.platform}-${a.handle}`}>
                  <PlatformIcon platform={a.platform} size={20} />
                  <span>{platformLabel(a.platform)}</span>
                  <span className="muted truncate">{a.handle}</span>
                  {a.status !== "active" && (
                    <span className="badge badge-warn spacer">reconectar</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty" style={{ padding: "var(--s4) 0" }}>
              <IconShare />
              <p>Ninguna cuenta conectada.</p>
              <a href="/dashboard/accounts" className="btn btn-ghost btn-sm">
                Conectar redes
              </a>
            </div>
          )}

          <p
            className="muted"
            style={{
              margin: "var(--s3) 0 0",
              paddingTop: "var(--s3)",
              borderTop: "1px solid var(--border)",
              fontSize: "0.8125rem",
            }}
          >
            Consumo del mes: <strong className={tight ? "delta-down" : undefined}>{euros(spent)}</strong>
            {tight && ` · ${Math.round(pct)}% del presupuesto`}
          </p>
        </section>
      </div>

      {(winners && winners.length > 0) || recommendations.length > 0 ? (
        <div className="grid-2">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Mejores contenidos</h2>
              <IconTrophy className="muted" />
            </div>

            {winners && winners.length > 0 ? (
              <ul className="list">
                {winners.map((w) => (
                  <li key={w.id}>
                    <span style={{ display: "flex", gap: ".3rem" }}>
                      {w.scheduled_platforms.slice(0, 3).map((platform) => (
                        <PlatformIcon key={platform} platform={platform} size={16} />
                      ))}
                    </span>
                    <a href={`/dashboard/posts/${w.id}`} className="truncate" style={{ flex: 1 }}>
                      {(w.caption ?? w.brief ?? "Sin texto todavía").slice(0, 60)}
                    </a>
                    <a href={`/dashboard/new?from=${w.id}`} className="btn btn-ghost btn-sm">
                      Reutilizar
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint" style={{ marginBottom: 0 }}>
                Marca algún post como ganador en <a href="/dashboard/content">Contenido</a> para
                verlo aquí.
              </p>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Recomendaciones</h2>
              <IconSparkle className="muted" />
            </div>

            {recommendations.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                {recommendations.map((tip) => (
                  <li key={tip} className="muted" style={{ fontSize: "0.8125rem", marginBottom: "var(--s2)" }}>
                    {tip}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint" style={{ marginBottom: 0 }}>
                Todo en orden por ahora — sin avisos que darte.
              </p>
            )}
          </section>
        </div>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Últimos posts</h2>
          <a href="/dashboard/new" className="btn btn-sm">
            <IconPlus />
            Nuevo post
          </a>
        </div>

        {recent && recent.length > 0 ? (
          <ul className="list">
            {recent.map((p) => {
              const s = STATUS[p.status] ?? { label: p.status, className: "badge" };
              return (
                <li key={p.id}>
                  <span className={s.className}>{s.label}</span>
                  <a href={`/dashboard/posts/${p.id}`} className="truncate" style={{ flex: 1 }}>
                    {(p.caption ?? p.brief)?.slice(0, 80) ?? "Sin texto todavía"}
                  </a>
                  <span className="muted" style={{ whiteSpace: "nowrap" }}>
                    {new Date(p.created_at).toLocaleDateString("es-ES", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty">
            <IconInbox />
            <p>Todavía no has creado ningún post.</p>
            <a href="/dashboard/plan" className="btn">
              Generar un plan de contenido
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
