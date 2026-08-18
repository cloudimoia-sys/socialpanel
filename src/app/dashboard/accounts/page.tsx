"use client";

import { useCallback, useEffect, useState } from "react";
import { IconAlert, IconShare } from "@/app/icons";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";

interface Account {
  platform: string;
  handle: string;
  needsReauth?: boolean;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  // Solo se rellena si el navegador bloqueó la ventana emergente.
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/accounts");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudieron cargar las cuentas.");
      setAccounts([]);
      return;
    }
    setAccounts(json.accounts);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Al conectar en pestaña nueva, esta pestaña queda en segundo plano: al
  // volver a ella (cerrar la de Upload-Post, o solo cambiar de pestaña) se
  // refresca sola. Así no hace falta ni recargar a mano para ver la cuenta
  // recién conectada.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  async function connect() {
    setOpening(true);
    setError("");

    const res = await fetch("/api/accounts/connect", { method: "POST" });
    const json = await res.json();
    setOpening(false);

    if (!res.ok) {
      setError(json.error ?? "No se pudo abrir la conexión.");
      return;
    }

    // El OAuth de cada red ocurre en la página alojada de Upload-Post.
    // En pestaña nueva y no en esta: si navegara aquí, al terminar el usuario
    // se queda en la web de Upload-Post sin ningún camino de vuelta al panel.
    const popup = window.open(json.url, "_blank", "noopener,noreferrer");
    if (!popup) {
      // El navegador bloqueó la ventana emergente: se ofrece como enlace en
      // vez de fallar en silencio.
      setError(
        "Tu navegador ha bloqueado la ventana. Permite emergentes para este sitio o " +
          "abre el enlace de conexión manualmente.",
      );
      setPendingUrl(json.url);
    }
  }

  return (
    <main>
      <header className="page-head">
        <h1>Redes conectadas</h1>
        <p>Autoriza cada cuenta una vez. Después ya se puede publicar en ella.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
          {pendingUrl && (
            <>
              {" "}
              <a href={pendingUrl} target="_blank" rel="noopener noreferrer">
                Abrir conexión
              </a>
            </>
          )}
        </p>
      )}

      <section className="card">
        {accounts === null ? (
          <>
            <div className="skeleton" style={{ width: "40%" }} />
            <div className="skeleton" style={{ width: "60%" }} />
            <div className="skeleton" style={{ width: "30%" }} />
          </>
        ) : accounts.length === 0 ? (
          <div className="empty">
            <IconShare />
            <p>No hay ninguna cuenta conectada todavía.</p>
            <button type="button" className="btn" onClick={connect} disabled={opening}>
              {opening ? "Abriendo…" : "Conectar cuentas"}
            </button>
          </div>
        ) : (
          <>
            <ul className="list">
              {accounts.map((a) => (
                <li key={a.platform}>
                  <PlatformIcon platform={a.platform} size={20} />
                  <strong>{platformLabel(a.platform)}</strong>
                  <span className="muted truncate">{a.handle}</span>
                  <span className="spacer">
                    {a.needsReauth ? (
                      <span className="badge badge-warn">reconectar</span>
                    ) : (
                      <span className="badge badge-ok">activa</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            <div className="actions" style={{ marginTop: "var(--s4)" }}>
              <button type="button" className="btn btn-ghost" onClick={connect} disabled={opening}>
                {opening ? "Abriendo…" : "Añadir o reconectar"}
              </button>
            </div>
          </>
        )}
      </section>

      <p className="hint">
        La autorización se abre en una pestaña nueva. Al terminar, cierra esa pestaña y
        vuelve a esta: las cuentas se sincronizan solas.
      </p>
    </main>
  );
}
