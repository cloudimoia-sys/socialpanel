import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase";

/**
 * Cerrar sesión solo por POST: si fuera GET, una imagen o un enlace en
 * cualquier página podría desloguear al usuario sin que hiciera nada.
 */
export async function POST(request: Request) {
  const supabase = await userClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", new URL(request.url).origin), { status: 303 });
}
