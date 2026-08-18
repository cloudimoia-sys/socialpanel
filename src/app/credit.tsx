/**
 * Firma del desarrollador. Discreta a propósito: acompaña, no compite con la
 * marca del cliente que use el panel.
 */
export function Credit({ className = "" }: { className?: string }) {
  return (
    <p className={`credit ${className}`.trim()}>
      by{" "}
      <a href="https://cloudimo.es" target="_blank" rel="noopener noreferrer">
        Cloudimo
      </a>
    </p>
  );
}
