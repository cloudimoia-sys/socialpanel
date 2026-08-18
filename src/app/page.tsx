import { Credit } from "@/app/credit";

export default function Home() {
  return (
    <main
      style={{
        maxWidth: "30rem",
        margin: "0 auto",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div className="brandmark" style={{ marginBottom: "var(--s4)", padding: 0 }}>
        <span className="dot" />
        SocialPanel
      </div>

      <h1 style={{ fontSize: "2rem", marginBottom: "var(--s3)" }}>
        Contenido que suena a tu negocio, publicado en todas tus redes.
      </h1>

      <p className="muted" style={{ fontSize: "0.9375rem", marginBottom: "var(--s5)" }}>
        Rellenas el perfil de tu empresa una vez. A partir de ahí propone ideas, escribe
        el copy, prepara las piezas y publica.
      </p>

      <div className="actions">
        <a href="/login" className="btn">
          Entrar
        </a>
      </div>

      <Credit className="" />
    </main>
  );
}
