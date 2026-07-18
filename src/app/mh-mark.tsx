// Brand mark: an "MH" ligature where the M's final stroke and the H's first
// stroke are the same leg. Stroke-drawn so it scales cleanly from favicon to
// home-screen icon; also rendered by Satori (ImageResponse), which supports
// inline SVG.
export function MHMark({
  width,
  color = "currentColor",
}: {
  width: number;
  color?: string;
}) {
  return (
    <svg
      width={width}
      height={(width * 64) / 88}
      viewBox="0 0 88 64"
      aria-hidden="true"
    >
      <path
        d="M8 58 V6 L30 41 L52 6 V58 M52 34 H80 M80 6 V58"
        fill="none"
        stroke={color}
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
