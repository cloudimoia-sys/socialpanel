import { notFound } from "next/navigation";
import { isPlatformAdmin } from "@/lib/admin";
import { InvitationsClient } from "./InvitationsClient";

/**
 * Pantalla de invitaciones, solo para administradores de la plataforma.
 *
 * Se comprueba en el servidor y se responde 404 en vez de 403: a un cliente no
 * le interesa ni que esta pantalla exista. La API vuelve a comprobarlo por su
 * cuenta — esto evita pintarla, no es el control de acceso.
 */
export const dynamic = "force-dynamic";

export default async function InvitationsPage() {
  if (!(await isPlatformAdmin())) notFound();

  return <InvitationsClient />;
}
