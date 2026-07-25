"use client";

import { useState } from "react";
import { detectLinkType } from "@/lib/link-type";
import { LinkTypeIcon } from "./link-icon";

// Favicon for a saved link, proxied through /api/favicon (the production CSP
// only allows same-origin images). Falls back to the content-type glyph when
// the URL has no usable host or the favicon fails to load.
export function LinkFavicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  let domain = "";
  try {
    domain = new URL(url).hostname;
  } catch {
    // not a parseable URL — glyph fallback below
  }
  if (!domain || failed) {
    return <LinkTypeIcon type={detectLinkType(url)} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny proxied icon; next/image adds nothing here
    <img
      className="link-favicon"
      src={`/api/favicon?domain=${encodeURIComponent(domain)}`}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
