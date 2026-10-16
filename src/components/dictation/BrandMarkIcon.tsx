import React from "react";

interface BrandMarkIconProps {
  size?: number;
  className?: string;
}

/**
 * Five bars: tall-hanging-tall reads as M, tall-standing-tall as W, sharing the
 * middle bar. Draws in `currentColor` so it follows the surrounding foreground.
 */
export function BrandMarkIcon({ size = 24, className }: BrandMarkIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="4" width="2.8" height="16" rx="1.4" />
      <rect x="6.3" y="4" width="2.8" height="8.96" rx="1.4" />
      <rect x="10.6" y="4" width="2.8" height="16" rx="1.4" />
      <rect x="14.9" y="11.04" width="2.8" height="8.96" rx="1.4" />
      <rect x="19.2" y="4" width="2.8" height="16" rx="1.4" />
    </svg>
  );
}
