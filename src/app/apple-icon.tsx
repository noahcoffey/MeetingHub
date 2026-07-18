import { ImageResponse } from "next/og";
import { MHMark } from "./mh-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Home-screen icon. iOS applies its own corner mask, so this stays a full
// square with no transparency.
export default function AppleIcon() {
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
        }}
      >
        <MHMark width={118} color="#ffffff" />
      </div>
    ),
    size,
  );
}
