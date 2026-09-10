import React from "react";

// The Schoolivio mark: a mortarboard over an open book.
//
// Drawn rather than bitmapped so it stays sharp at every size, works on both
// themes, and costs no request. If a school uploads its own logo the tenant
// header shows that instead — this is the product's own mark, used on the
// sign-in screens, the platform console and as a fallback.
export const Mark = ({ size = 32, className = "" }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 64 64"
    role="img"
    aria-label="Schoolivio"
    fill="none"
  >
    <defs>
      <linearGradient id="sv-deep" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#6d3fc4" />
        <stop offset="1" stopColor="#4c2a94" />
      </linearGradient>
      <linearGradient id="sv-light" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#b79bf0" />
        <stop offset="1" stopColor="#9271e6" />
      </linearGradient>
    </defs>

    {/* the open book, two leaves meeting at the spine */}
    <path
      d="M32 30 L32 56 C25 50 16 47 7 47 L7 23 C16 23 25 25 32 30 Z"
      fill="url(#sv-deep)"
    />
    <path
      d="M32 30 L32 56 C39 50 48 47 57 47 L57 23 C48 23 39 25 32 30 Z"
      fill="url(#sv-light)"
    />

    {/* the figure rising out of it */}
    <path
      d="M32 28 C29 22 25 19 21 17 C27 17 30 20 32 24 C34 20 37 17 43 17 C39 19 35 22 32 28 Z"
      fill="#ffffff"
      opacity=".92"
    />
    <circle cx="32" cy="17" r="4" fill="#ffffff" opacity=".92" />

    {/* the mortarboard */}
    <path d="M32 2 L60 13 L32 24 L4 13 Z" fill="url(#sv-deep)" />
    <path
      d="M53 16.5 L53 26"
      stroke="#4c2a94"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle cx="53" cy="27.5" r="2.4" fill="#4c2a94" />
  </svg>
);

// Mark plus wordmark, for sign-in screens and the sidebar head.
const Logo = ({ size = 30, showName = true, suffix, className = "" }) => (
  <span className={`logo ${className}`}>
    <Mark size={size} />
    {showName ? (
      <span className="logo-text">
        <span className="logo-name">{"Schoolivio"}</span>
        {suffix ? <span className="logo-suffix">{suffix}</span> : null}
      </span>
    ) : null}
  </span>
);

export default Logo;
