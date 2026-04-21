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
    case "home":     return <svg {...common}><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9z"/></svg>;
    case "review":   return <svg {...common}><rect x="3" y="4" width="18" height="14" rx="2"/><circle cx="12" cy="11" r="3.2"/><path d="M7 4l1.5-2h7L17 4"/></svg>;
    case "stars":    return <svg {...common}><path d="M12 3l2.6 5.5 6 .7-4.4 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.4 9.2l6-.7L12 3z"/></svg>;
    case "trophy":   return <svg {...common}><path d="M8 21h8M12 17v4M6 4h12v4a6 6 0 01-12 0V4zM6 6H3v2a3 3 0 003 3M18 6h3v2a3 3 0 01-3 3"/></svg>;
    case "book":     return <svg {...common}><path d="M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4V4zM20 4h-4a3 3 0 00-3 3v13a2 2 0 012-2h5V4z"/></svg>;
    case "user":     return <svg {...common}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>;
    case "gear":     return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>;
    case "users":    return <svg {...common}><circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0114 0"/><circle cx="17" cy="9" r="2.5"/><path d="M22 20a5 5 0 00-7-4.6"/></svg>;
    case "sliders":  return <svg {...common}><path d="M4 6h10M4 12h6M4 18h14"/><circle cx="18" cy="6" r="2"/><circle cx="14" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></svg>;
    case "image":    return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-8 8"/></svg>;
    case "check":    return <svg {...common}><path d="M5 12l5 5L20 7"/></svg>;
    case "x":        return <svg {...common}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case "flag":     return <svg {...common}><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></svg>;
    case "arrow-l":  return <svg {...common}><path d="M15 6l-6 6 6 6"/></svg>;
    case "arrow-r":  return <svg {...common}><path d="M9 6l6 6-6 6"/></svg>;
    case "bolt":     return <svg {...common}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>;
    case "fire":     return <svg {...common}><path d="M12 2s5 5 5 10a5 5 0 01-10 0c0-2 1-4 2-5 0 2 1 3 2 3-1-3 1-6 1-8z"/></svg>;
    case "clock":    return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case "tag":      return <svg {...common}><path d="M20 13l-7 7-9-9V4h7l9 9z"/><circle cx="7.5" cy="7.5" r="1"/></svg>;
    case "search":   return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>;
    case "plus":     return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case "camera":   return <svg {...common}><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8 6l2-3h4l2 3"/></svg>;
    case "play":     return <svg {...common}><path d="M6 4v16l14-8L6 4z"/></svg>;
    case "medal":    return <svg {...common}><circle cx="12" cy="15" r="6"/><path d="M8 3h8l-2 6h-4L8 3z"/></svg>;
    case "bell":     return <svg {...common}><path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16zM10 20a2 2 0 004 0"/></svg>;
    case "download": return <svg {...common}><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg>;
    case "dots":     return <svg {...common}><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/></svg>;
    case "chevron-r":return <svg {...common}><path d="M9 6l6 6-6 6"/></svg>;
    case "chevron-d":return <svg {...common}><path d="M6 9l6 6 6-6"/></svg>;
    case "mail":     return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>;
    case "phone":    return <svg {...common}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/></svg>;
    case "log-out":  return <svg {...common}><path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 17l5-5-5-5M15 12H3"/></svg>;
    default:         return <svg {...common}><circle cx="12" cy="12" r="4"/></svg>;
  }
}
