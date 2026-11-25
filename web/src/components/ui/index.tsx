/** 도메인과 무관한 기본 UI 조각 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "plain" };

export function Button({ variant = "ghost", className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={`btn btn-${variant} ${className}`} {...rest} />;
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { label: string; icon: ReactNode };

export function IconButton({ label, icon, className = "", type = "button", ...rest }: IconButtonProps) {
  return (
    <button type={type} className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

export function Badge({ tone, children }: { tone: "est" | "live" | "muted"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export interface SegOption<T extends string> { value: T; label: string }

export function Segmented<T extends string>({ options, value, onChange, label, testId = "mode-toggle", className = "" }: {
  options: SegOption<T>[];
  value: T;
  onChange(v: T): void;
  label: string;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={`seg ${className}`.trim()} role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          data-testid={`mode-${o.value}`}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const i = options.findIndex((x) => x.value === value);
            const next = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
            onChange(next.value);
            (e.currentTarget.parentElement?.querySelector(`[data-testid="mode-${next.value}"]`) as HTMLElement | null)?.focus();
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function EmptyState({ title, action, testId }: { title: string; action?: ReactNode; testId?: string }) {
  return (
    <div className="empty" data-testid={testId}>
      <p>{title}</p>
      {action}
    </div>
  );
}
