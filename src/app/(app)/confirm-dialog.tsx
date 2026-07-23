"use client";

import { useEffect, useRef, useState } from "react";

// Shared overlay for the app's small modals. Mirrors the command-palette /
// keyboard-shortcut modals: Escape closes, click outside closes, the card
// stops propagation so inner clicks don't dismiss.
export function Overlay({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// Replaces window.confirm. The parent owns `open`; `busy` keeps it up (and
// disables the buttons) while an awaited action runs.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  busyLabel,
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  busyLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => confirmRef.current?.focus(), 10);
    return () => clearTimeout(id);
  }, [open]);

  if (!open) return null;

  return (
    <Overlay onClose={busy ? () => {} : onCancel}>
      <div className="modal-body">
        <h2 className="modal-title">{title}</h2>
        {message && <p className="modal-message">{message}</p>}
      </div>
      <div className="modal-actions">
        <button
          type="button"
          className="ghost-btn"
          onClick={onCancel}
          disabled={busy}
        >
          {cancelLabel}
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={danger ? "danger-btn" : "primary-btn"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
        </button>
      </div>
    </Overlay>
  );
}

// Replaces window.prompt — a single text field seeded from `defaultValue`.
export function PromptDialog({
  open,
  title,
  label,
  defaultValue = "",
  placeholder,
  confirmLabel = "Save",
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(defaultValue);
    const id = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
    return () => clearTimeout(id);
  }, [open, defaultValue]);

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
  }

  return (
    <Overlay onClose={onCancel}>
      <form className="modal-form" onSubmit={submit}>
        <div className="modal-body">
          <h2 className="modal-title">{title}</h2>
          <input
            ref={inputRef}
            className="modal-input"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            aria-label={label ?? title}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-btn" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
