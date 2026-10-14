"use client";
import { useEffect, useId, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: focus moves in and is trapped, Escape and the
 * backdrop close it (unless `locked` while a request is running), page scroll
 * is locked, focus returns to the trigger, and the panel scrolls internally
 * so it always fits the viewport.
 */
export function Modal({
  title,
  description,
  onClose,
  locked = false,
  wide = false,
  variant = "default",
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  locked?: boolean;
  wide?: boolean;
  variant?: "default" | "media";
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]") || panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first || panel)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !lockedRef.current) {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      className="ra-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`ra-modal ${wide ? "ra-modal-wide" : ""} ${variant === "media" ? "ra-modal-media" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <div className="ra-modal-head">
          <div className="ra-modal-titles">
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descId}>{description}</p>}
          </div>
          <button type="button" className="ra-icon-button" onClick={onClose} disabled={locked} aria-label="Close dialog">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="ra-modal-body">{children}</div>
        {footer && <div className="ra-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
