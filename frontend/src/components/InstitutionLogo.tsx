"use client";

import { useState } from "react";
import { getInstitutionLogoUrl, getInstitutionFaviconUrl } from "@/lib/institutionLogos";

interface InstitutionLogoProps {
  name: string | null | undefined;
  size?: number;
  className?: string;
}

// Tries Clearbit first, falls back to Google Favicons, then renders nothing
export default function InstitutionLogo({ name, size = 32, className = "" }: InstitutionLogoProps) {
  const [src, setSrc] = useState<"clearbit" | "favicon" | "failed">("clearbit");

  const clearbitUrl = getInstitutionLogoUrl(name, size);
  const faviconUrl = getInstitutionFaviconUrl(name);

  if (!clearbitUrl || src === "failed") return null;

  const imgSrc = src === "clearbit" ? clearbitUrl : faviconUrl!;

  return (
    <img
      src={imgSrc}
      alt={name ?? ""}
      width={size}
      height={size}
      className={`rounded-full object-contain bg-white border border-gray-100 shrink-0 ${className}`}
      onError={() => setSrc(src === "clearbit" ? "favicon" : "failed")}
    />
  );
}
