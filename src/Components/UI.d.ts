// Types for UI.jsx, the shared component library, so TypeScript screens get
// real prop checking while the library itself is still JavaScript. Keep in
// step with UI.jsx; convert UI.jsx to .tsx when it is next reworked and
// delete this file.
import type { CSSProperties, ReactNode, ButtonHTMLAttributes, RefObject } from "react";

type Children = { children?: ReactNode };

export interface Profile {
  first_name?: string | null;
  surname?: string | null;
  username?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

export declare const Page: (p: Children & {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  toolbar?: ReactNode;
  wide?: boolean;
  className?: string;
}) => JSX.Element;
export declare const AppLoading: (p: { label?: string }) => JSX.Element;
export declare const Card: (p: Children & { className?: string; style?: CSSProperties; [attr: string]: unknown }) => JSX.Element;
export declare const Grid: (p: Children & { wide?: boolean }) => JSX.Element;
export declare const Section: (p: Children & { title?: ReactNode; action?: ReactNode }) => JSX.Element;
export declare const Button: (
  p: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | string; size?: "sm" | string }
) => JSX.Element;
export declare const Switch: (p: {
  checked?: boolean;
  onChange: (on: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  compact?: boolean;
}) => JSX.Element;
export declare const Field: (p: Children & { label?: ReactNode; hint?: ReactNode }) => JSX.Element;
export declare const MoneyInput: (p: {
  value: string | number;
  onChange: (raw: string) => void;
  className?: string;
  [attr: string]: unknown;
}) => JSX.Element;

export interface SelectOption {
  value: string | number;
  label: ReactNode;
}
export declare const Select: (p: {
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  style?: CSSProperties;
  /** A search box at the top of the list; on by default past 8 options. */
  searchable?: boolean;
  [attr: string]: unknown;
}) => JSX.Element;
export declare const DatePicker: (p: { value: string | null | undefined; onChange: (iso: string) => void; [attr: string]: unknown }) => JSX.Element;
export declare const DateTimePicker: (p: { value: string | null | undefined; onChange: (iso: string) => void; [attr: string]: unknown }) => JSX.Element;
export declare const Badge: (p: Children & { tone?: string }) => JSX.Element;
export declare const Notice: (p: Children & { tone?: "muted" | "error" | "success" | "warn" | string }) => JSX.Element | null;
export declare const Modal: (p: Children & {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose?: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) => JSX.Element;
export declare const ChecklistBox: (p: Children & { title?: ReactNode }) => JSX.Element;
export declare const Empty: (p: Children) => JSX.Element;
export declare const Skeleton: (p: { width?: number | string; height?: number | string; radius?: number | string; style?: CSSProperties; className?: string }) => JSX.Element;
export declare const SkeletonText: (p: { lines?: number; lastLineWidth?: string }) => JSX.Element;
export declare const SkeletonStatRow: (p: { count?: number }) => JSX.Element;
export declare const SkeletonTable: (p: { rows?: number; cols?: number }) => JSX.Element;
export declare const SkeletonCards: (p: { count?: number; lines?: number }) => JSX.Element;
export declare const SkeletonList: (p: { rows?: number; avatar?: boolean }) => JSX.Element;
export declare const Tabs: (p: {
  tabs: { id: string; label: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
}) => JSX.Element;
export declare const bandClass: (seed?: string) => string;
export declare const useClampToViewport: (active: boolean, ref: RefObject<HTMLElement>, margin?: number) => void;
export declare const displayName: (profile: Profile | null | undefined) => string;
export declare const initials: (profile: Profile | null | undefined) => string;
export declare const formatDate: (value: string | Date | null | undefined, options?: { withTime?: boolean; fallback?: string }) => string;
