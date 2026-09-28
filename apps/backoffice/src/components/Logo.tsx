export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="24" fill="#FFFFFF" />
      <text x="47" y="66" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="52" letterSpacing="-3" fill="#0B1F3A">
        cb
      </text>
      <rect x="72" y="72" width="14" height="14" rx="3" fill="#F5A524" />
    </svg>
  );
}

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <a className="brand" href={href}>
      <LogoMark />
      <span className="brand-word">
        <span>caisse</span>
        <b>box</b>
      </span>
    </a>
  );
}
