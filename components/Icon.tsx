"use client";

import React from "react";

type IconProps = {
  name: string;
  size?: number;
  strokeWidth?: number;
  style?: React.CSSProperties;
};

export function Icon({ name, size = 16, strokeWidth = 1.6, style }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style,
  };
  switch (name) {
    case "review":   return <svg {...common}><rect x="3" y="4" width="18" height="14" rx="2"/><circle cx="12" cy="11" r="3.2"/><path d="M7 4l1.5-2h7L17 4"/></svg>;
    case "stars":    return <svg {...common}><path d="M12 3l2.6 5.5 6 .7-4.4 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.4 9.2l6-.7L12 3z"/></svg>;
    case "gear":     return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>;
    case "users":    return <svg {...common}><circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0114 0"/><circle cx="17" cy="9" r="2.5"/><path d="M22 20a5 5 0 00-7-4.6"/></svg>;
    case "check":    return <svg {...common}><path d="M5 12l5 5L20 7"/></svg>;
    case "x":        return <svg {...common}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case "flag":     return <svg {...common}><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></svg>;
    case "arrow-l":  return <svg {...common}><path d="M15 6l-6 6 6 6"/></svg>;
    case "arrow-r":  return <svg {...common}><path d="M9 6l6 6-6 6"/></svg>;
    case "tag":      return <svg {...common}><path d="M20 13l-7 7-9-9V4h7l9 9z"/><circle cx="7.5" cy="7.5" r="1"/></svg>;
    case "search":   return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>;
    case "plus":     return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case "download": return <svg {...common}><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg>;
    case "dots":     return <svg {...common}><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/></svg>;
    case "pencil":   return <svg {...common}><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/></svg>;
    case "log-out":  return <svg {...common}><path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 17l5-5-5-5M15 12H3"/></svg>;
    default:         return <svg {...common}><circle cx="12" cy="12" r="4"/></svg>;
  }
}
