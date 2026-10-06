// Types for EmailFrame.jsx (a received email shown safely in its own frame).
declare const EmailFrame: (p: {
  html: string;
  title?: string;
  /** Hold back outside pictures (and background images) until allowed. */
  blockRemote?: boolean;
  /** How many were held back. */
  onBlocked?: (count: number) => void;
  /** Ask before opening a link that is not what it seems. */
  warnLinks?: boolean;
}) => JSX.Element;
/** Why a link might not be what it seems, or null when it looks fine. */
export declare const linkRisk: (href: string, text?: string | null) => string | null;
export default EmailFrame;
