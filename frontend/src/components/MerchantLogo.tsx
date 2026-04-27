"use client";

import { useState } from "react";
import { getMerchantLogoUrl, getMerchantFaviconUrl } from "@/lib/merchantLogos";

interface MerchantLogoProps {
  merchantName: string | null | undefined;
  txnName?: string | null;
  size?: number;
}

// Tries Clearbit → Google Favicons → renders nothing on total failure
export default function MerchantLogo({ merchantName, txnName, size = 32 }: MerchantLogoProps) {
  const [src, setSrc] = useState<"clearbit" | "favicon" | "failed">("clearbit");

  const clearbitUrl = getMerchantLogoUrl(merchantName, txnName, size);
  const faviconUrl = getMerchantFaviconUrl(merchantName, txnName);

  if (!clearbitUrl || src === "failed") return null;

  const imgSrc = src === "clearbit" ? clearbitUrl : faviconUrl!;

  return (
    <img
      src={imgSrc}
      alt=""
      width={size}
      height={size}
      className="rounded-lg object-contain bg-white border border-gray-100 shrink-0"
      style={{ width: size, height: size }}
      onError={() => setSrc(src === "clearbit" ? "favicon" : "failed")}
    />
  );
}
