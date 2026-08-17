/**
 * The budgetr mark — the same italic serif `b.` that ships as the app icon
 * (public/icons/icon-512.png, apple/…/AppIcon).
 *
 * This used to be a ₿ glyph, which read as "Bitcoin app" rather than "budgetr"
 * and matched nothing a user had already seen: the Dock icon, the DMG, the
 * favicon and the PWA install prompt all show the `b.`. Drawn in markup rather
 * than as an <img> so it inherits the current color, stays crisp at any size,
 * and costs no request.
 *
 * The dot is jade in both themes — it's the one fixed accent of the identity,
 * and the piece that makes the mark legible at 20px.
 */
export function BrandMark({
  size = 36,
  className = "",
}: {
  /** Edge length of the rounded tile, in px. */
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`relative grid shrink-0 place-items-center rounded-[28%] border border-[var(--brass-dim)] bg-[var(--panel)] shadow-[var(--elev-1)] transition-colors duration-200 group-hover:border-[var(--brass)] ${className}`}
      style={{ width: size, height: size }}
    >
      {/* The letter sits marginally left of center so the dot doesn't push the
          optical weight off-axis — same offset the raster icon uses. */}
      <span
        className="font-display italic leading-none text-[var(--paper)]"
        style={{ fontSize: size * 0.62, transform: `translateX(${-size * 0.045}px)` }}
      >
        b
      </span>
      <span
        className="absolute rounded-full bg-[var(--jade)]"
        style={{
          width: Math.max(2, size * 0.15),
          height: Math.max(2, size * 0.15),
          right: size * 0.16,
          bottom: size * 0.2,
        }}
      />
    </span>
  );
}
