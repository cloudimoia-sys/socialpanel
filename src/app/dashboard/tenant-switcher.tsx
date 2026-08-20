"use client";

import { useState } from "react";

interface Props {
  tenants: { id: string; name: string }[];
  activeId: string;
}

/**
 * Solo se renderiza cuando el layout detecta más de un tenant — la inmensa
 * mayoría de clientes tiene uno y este control sería ruido sin propósito.
 *
 * El propio endpoint vuelve a comprobar la membresía antes de aceptar el
 * cambio; aquí solo se manda la elección, no se decide nada sensible.
 */
export function TenantSwitcher({ tenants, activeId }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function switchTo(tenantId: string) {
    if (tenantId === activeId) return;
    setBusy(true);
    setError("");

    const res = await fetch("/api/tenants/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId }),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setBusy(false);
      setError(json.error ?? "No se pudo cambiar de cuenta.");
      return;
    }

    // Recarga completa y no solo un refresh de datos: casi toda página del
    // panel guarda tenant_id en su propio estado al cargar, y un cambio de
    // tenant a medio camino podría mezclar datos de los dos en pantalla.
    window.location.href = "/dashboard";
  }

  return (
    <div style={{ padding: "0 var(--s2)", marginBottom: "var(--s2)" }}>
      <select
        aria-label="Cambiar de cuenta"
        value={activeId}
        disabled={busy}
        onChange={(e) => switchTo(e.target.value)}
        style={{ fontSize: "0.8125rem" }}
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {error && (
        <p className="error" role="alert" style={{ marginTop: "var(--s2)", fontSize: "0.75rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}
