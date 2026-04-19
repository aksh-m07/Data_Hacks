import L from "leaflet";

/** Matches `--orange` in app.css — fixed on the map tile layer (no CSS variables). */
const MAP_STROKE = "#fb923c";

/** Single source for Wildfire header + Leaflet marker. */
function innerLandmarkPathsHtml(): string {
  return `<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>`;
}

type GlyphProps = {
  size?: number;
  className?: string;
  /** Map tiles: use fixed stroke color. Header: omit to use `currentColor`. */
  mapStroke?: boolean;
};

export function LandmarkGlyph({ size = 16, className, mapStroke }: GlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={mapStroke ? MAP_STROKE : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: innerLandmarkPathsHtml() }}
    />
  );
}

/** Leaflet `DivIcon` using the same landmark artwork as the Wildfire header. */
export function createLandmarkMapIcon(): L.DivIcon {
  const html = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${MAP_STROKE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${innerLandmarkPathsHtml()}</svg>`;
  return L.divIcon({
    className: "leaflet-landmark-icon",
    html,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  });
}
