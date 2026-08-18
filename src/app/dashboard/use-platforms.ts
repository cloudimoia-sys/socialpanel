"use client";

import { useEffect, useState } from "react";

export interface ConnectedPlatform {
  platform: string;
  handle: string;
}

/**
 * Redes conectadas del tenant.
 *
 * Los selectores solo deben ofrecer redes conectadas: proponer una que no lo
 * está solo produce un fallo de publicación después de haber gastado en
 * generar el contenido.
 */
export function usePlatforms() {
  const [platforms, setPlatforms] = useState<ConnectedPlatform[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/platforms");
      const json = await res.json();
      setPlatforms(res.ok ? json.platforms : []);
    })();
  }, []);

  return {
    platforms,
    loading: platforms === null,
    names: (platforms ?? []).map((p) => p.platform),
  };
}
