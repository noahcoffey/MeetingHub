import { ImageResponse } from "next/og";
import { MHMark } from "./mh-mark";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// Favicon: the sidebar brand mark — rounded gradient square with the shared-leg
// "MH" ligature (colors match the light-theme --accent/--accent-2).
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #2f6fe0, #7857ec)",
          borderRadius: 19,
        }}
      >
        <MHMark width={44} color="#ffffff" />
      </div>
    ),
    size,
  );
}
