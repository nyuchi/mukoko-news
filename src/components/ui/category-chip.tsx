"use client";

import type { ReactNode } from "react";

interface CategoryChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
}

export function CategoryChip({ label, active = false, onClick, icon }: CategoryChipProps) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-all duration-200 whitespace-nowrap flex items-center gap-1.5 ${
        active
          ? "bg-primary text-on-primary"
          : "bg-surface text-foreground border border-elevated hover:border-primary hover:text-primary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
