"use client";

import { useEffect, useState } from "react";
import { IconAlert, IconInbox } from "@/app/icons";
import { PlatformIcon } from "@/app/platform-icons";

interface Conversation {
  id: string;
  platform: string;
  recipientId: string;
  participantName: string;
  lastMessage: string;
  lastMessageAt: string | null;
}

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [leadCreated, setLeadCreated] = useState<Set<string>>(new Set());

  async function createLead(c: Conversation) {
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: c.participantName,
        platform: c.platform,
        handle: c.recipientId,
        message: c.lastMessage,
        source: "inbox",
      }),
    });
    if (res.ok) setLeadCreated((s) => new Set(s).add(c.id));
  }

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/inbox");
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "No se pudo cargar la bandeja.");
        setConversations([]);
        return;
      }
      setConversations(json.conversations);
    })();
  }, []);

  async function send(c: Conversation) {
    if (!reply.trim()) return;
    setSending(true);
    setError("");

    const res = await fetch("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: c.platform, recipientId: c.recipientId, message: reply }),
    });
    const json = await res.json();
    setSending(false);

    if (!res.ok) {
      setError(json.error ?? "No se pudo enviar el mensaje.");
      return;
    }
    setSent(c.id);
    setReply("");
    setOpen(null);
  }

  return (
    <main>
      <header className="page-head">
        <h1>Mensajes</h1>
        <p>Mensajes directos de Instagram. Es lo único que expone hoy la API de tus redes.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      <section className="card">
        {conversations === null ? (
          <>
            <div className="skeleton" style={{ width: "60%" }} />
            <div className="skeleton" style={{ width: "40%" }} />
          </>
        ) : conversations.length === 0 ? (
          <div className="empty">
            <IconInbox />
            <p>No hay conversaciones todavía.</p>
          </div>
        ) : (
          <ul className="list">
            {conversations.map((c) => (
              <li key={c.id} style={{ flexWrap: "wrap" }}>
                <PlatformIcon platform={c.platform} size={20} />
                <strong>{c.participantName}</strong>
                <span className="muted truncate" style={{ flex: 1 }}>
                  {c.lastMessage || "(sin vista previa)"}
                </span>

                {sent === c.id ? (
                  <span className="badge badge-ok">enviado</span>
                ) : open === c.id ? (
                  <span style={{ display: "flex", gap: "var(--s2)", width: "100%", marginTop: "var(--s2)" }}>
                    <input
                      type="text"
                      value={reply}
                      autoFocus
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Escribe una respuesta…"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={sending || !reply.trim()}
                      onClick={() => send(c)}
                    >
                      {sending ? "Enviando…" : "Enviar"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setOpen(null);
                        setReply("");
                      }}
                    >
                      Cancelar
                    </button>
                  </span>
                ) : (
                  <span style={{ display: "flex", gap: "var(--s2)" }}>
                    {leadCreated.has(c.id) ? (
                      <span className="badge badge-ok">lead creado</span>
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => createLead(c)}>
                        Crear lead
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setOpen(c.id)}
                    >
                      Responder
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="hint">
        Solo se ve el último mensaje de cada conversación, no el hilo completo — para eso
        sigue haciendo falta abrir Instagram. Responder desde aquí llega de verdad a esa
        persona.
      </p>
    </main>
  );
}
