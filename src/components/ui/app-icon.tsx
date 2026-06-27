"use client";

import Image from "next/image";
import { useTheme } from "@/components/theme-provider";

interface AppIconProps {
  size?: number;
  className?: string;
}

export function AppIcon({ size = 32, className = "" }: AppIconProps) {
  const { resolvedTheme } = useTheme();

  // Seed-of-Life mark — full-palette, theme-aware (transparent SVG)
  const iconSrc = resolvedTheme === "dark"
    ? "/mukoko-mark-full-dark.svg"
    : "/mukoko-mark-full-light.svg";

  return (
    <div
      className={`relative ${className}`}
      style={{ width: size, height: size }}
    >
      <Image
        src={iconSrc}
        alt="mukoko"
        width={size}
        height={size}
        className="object-contain"
        priority
      />
    </div>
  );
}
