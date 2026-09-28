'use client';

import { useEffect, useId, useRef } from 'react';
import { actionErrorMessage } from '@/lib/hooks/use-action';

/**
 * A modal form. Built on <dialog>.showModal(), so the browser traps focus,
 * makes the page behind it inert, and closes it on Escape. Mount it only
 * while open (`{open && <FormDialog …/>}`) so each opening starts with
 * fresh field state.
 */
export function FormDialog({
  title,
  description,
  submitLabel,
  pending,
  error,
  onSubmit,
  onClose,
  tone,
  size,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: () => void;
  onClose: () => void;
  tone?: 'danger';
  size?: 'wide';
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      data-size={size}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape — but not while a request is in flight.
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <form
        className="dialog-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) onSubmit();
        }}
      >
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        {description && <div className="dialog-description">{description}</div>}
        {children && <div className="form-grid">{children}</div>}
        {error ? (
          <p className="form-error" role="alert">
            {typeof error === 'string' ? error : actionErrorMessage(error)}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="submit"
            className={tone === 'danger' ? 'button button-danger' : 'button button-primary'}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Label + control + optional hint, wired together for screen readers. */
export function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="field" data-wide={wide || undefined}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': hint ? hintId : undefined })}
      {hint && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}

/** The buttons under a detail panel's summary — what can be done to this record now. */
export function ActionBar({ children }: { children: React.ReactNode }) {
  return <div className="action-bar">{children}</div>;
}
