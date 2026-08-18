import { redirect } from "next/navigation";
import { spentThisMonthCents } from "@/domain/usage";
import { adminClient } from "@/lib/supabase";
import { currentTenant } from "@/lib/tenant";
import { IconInbox, IconPlus, IconShare } from "@/app/icons";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";

export const dynamic = "force-dynamic";

const euros = (cents: number) => `${(cents / 100).toFixed(2)} €`;

const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "borrador", className: "badge" },
  generating: { label: "generando", className: "badge badge-brand" },
  ready: { label: "listo", className: "badge badge-ok" },
  scheduled: { label: "programado", className: "badge badge-brand" },
  publishing: { label: "publicando", className: "badge badge-brand" },
  published: { label: "publicado", className: "badge badge-ok" },
  failed: { label: "falló", className: "badge badge-danger" },
};

export default async function DashboardPage() {
  const tenant = await currentTenant();
  if (!tenant) redirect("/login");

  const db = adminClient();

  const [{ data: brand }, { data: accounts }, { data: posts }, spent] = await Promise.all([
    db.from("brand_profiles").select("business_name").eq("tenant_id", tenant.tenantId).maybeSingle(),
    db.from("social_accounts").select("platform, handle, status").eq("tenant_id", tenant.tenantId),
    db
      .from("posts")
      .select("id, status, caption, created_at")
      .eq("tenant_id", tenant.tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(6),
    spentThisMonthCents(tenant.tenantId),
  ]);

  const pct = Math.min(100, (spent / Math.max(1, tenant.budgetCents)) * 100);
  const tight = spent > tenant.budgetCents * 0.8;

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

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Consumo del mes</h2>
            <span className={tight ? "badge badge-warn" : "badge"}>
              {Math.round(pct)}%
            </span>
          </div>
          <div className="stat">{euros(spent)}</div>
          <p className="muted" style={{ margin: 0 }}>
            de {euros(tenant.budgetCents)} presupuestados
          </p>
          <div className="meter">
            <div
              style={{
                width: `${pct}%`,
                background: tight ? "var(--warn)" : "var(--brand)",
              }}
            />
          </div>
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
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Últimos posts</h2>
          <a href="/dashboard/new" className="btn btn-sm">
            <IconPlus />
            Nuevo post
          </a>
        </div>

        {posts && posts.length > 0 ? (
          <ul className="list">
            {posts.map((p) => {
              const s = STATUS[p.status] ?? { label: p.status, className: "badge" };
              return (
                <li key={p.id}>
                  <span className={s.className}>{s.label}</span>
                  <a href={`/dashboard/posts/${p.id}`} className="truncate" style={{ flex: 1 }}>
                    {p.caption?.slice(0, 80) ?? "Sin texto todavía"}
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
