import { Credit } from "@/app/credit";
import { IconAlert } from "@/app/icons";

/**
 * Pantalla para quien se ha autenticado correctamente pero no está invitado.
 *
 * Existe para no dejarlo en un error genérico: el acceso ha ido bien, lo que
 * falta es la invitación, y decirlo evita que insista pensando que ha fallado
 * la contraseña o el correo.
 *
 * Ofrece cerrar sesión porque si no queda atrapado: el middleware ve una
 * sesión válida y no lo manda al login, así que sin este botón no habría
 * forma de probar con otra cuenta.
 */
export default function NoAccessPage() {
  return (
    <main
      style={{
        maxWidth: "24rem",
        margin: "0 auto",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div className="brandmark" style={{ marginBottom: "var(--s5)", padding: 0 }}>
        <span className="dot" />
        SocialPanel
      </div>

      <section className="card">
        <div className="card-head">
          <h1 style={{ fontSize: "1.25rem" }}>Acceso por invitación</h1>
          <IconAlert />
        </div>

        <p style={{ margin: "0 0 var(--s3)" }}>
          Tu cuenta funciona, pero todavía no tiene acceso a SocialPanel.
        </p>
        <p className="muted" style={{ margin: "0 0 var(--s5)" }}>
          Escríbenos a <a href="mailto:cloudimo.ia@gmail.com">cloudimo.ia@gmail.com</a> y te
          damos de alta.
        </p>

        <form action="/auth/signout" method="post">
          <button type="submit" className="btn btn-ghost" style={{ width: "100%" }}>
            Cerrar sesión y probar con otra cuenta
          </button>
        </form>
      </section>

      <Credit />
    </main>
  );
}
