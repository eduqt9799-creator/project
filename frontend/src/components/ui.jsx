/** Reusable UI primitives: cards, tables, forms, states, modals, badges, toasts. */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  IconAlert, IconCheck, IconChevronLeft, IconChevronRight, IconEye, IconEyeOff,
  IconInbox, IconSearch, IconX,
} from './Icons';
import { departmentsApi } from '../services/api';

/* ------------------------------------------------------------------ layout */

export const PageHeader = ({ title, subtitle, actions, children }) => (
  <header className="page-header">
    <div className="page-header-text">
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
    {actions ? <div className="page-header-actions">{actions}</div> : null}
    {children}
  </header>
);

export const Card = ({ children, className = '', ...rest }) => (
  <section className={`card ${className}`} {...rest}>{children}</section>
);

export const CardHeader = ({ title, subtitle, actions }) => (
  <div className="card-header">
    <div>
      <h3>{title}</h3>
      {subtitle ? <div className="card-subtitle">{subtitle}</div> : null}
    </div>
    {actions ? <div className="card-header-actions">{actions}</div> : null}
  </div>
);

export const CardBody = ({ children, tight = false }) => (
  <div className={`card-body ${tight ? 'tight' : ''}`}>{children}</div>
);

export const Grid = ({ variant = 'stats', children, className = '' }) => (
  <div className={`grid grid-${variant} ${className}`}>{children}</div>
);

export const StatCard = ({ label, value, hint, icon, tone = '' }) => (
  <Card className="stat-card">
    {icon ? <div className={`stat-icon ${tone}`}>{icon}</div> : null}
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    {hint ? <div className="stat-hint">{hint}</div> : null}
  </Card>
);

/* ------------------------------------------------------------------ states */

export const LoadingState = ({ label = 'Loading...' }) => (
  <div className="loading-block" role="status" aria-live="polite">
    <div className="spinner lg" />
    <span>{label}</span>
  </div>
);

export const EmptyState = ({ title = 'No data available.', description, action }) => (
  <div className="state-block">
    <div className="state-icon"><IconInbox size={26} /></div>
    <h3>{title}</h3>
    {description ? <p>{description}</p> : null}
    {action}
  </div>
);

export const ErrorState = ({ title = 'Something went wrong', message, onRetry }) => (
  <div className="state-block error" role="alert">
    <div className="state-icon"><IconAlert size={26} /></div>
    <h3>{title}</h3>
    {message ? <p>{message}</p> : null}
    {onRetry ? <button type="button" className="btn btn-secondary" onClick={onRetry}>Try again</button> : null}
  </div>
);

export const Alert = ({ tone = 'info', title, children }) => (
  <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
    {tone === 'error' ? <IconAlert size={18} /> : tone === 'success' ? <IconCheck size={18} /> : null}
    <div>
      {title ? <div className="alert-title">{title}</div> : null}
      <div>{children}</div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ badges */

const TONES = {
  present: 'success', active: 'success', pass: 'success', paid: 'success', completed: 'success', submitted: 'success',
  absent: 'danger', fail: 'danger', inactive: 'danger', overdue: 'danger', urgent: 'danger', deleted: 'danger',
  pending: 'warning', high: 'warning', medium: 'warning', warn: 'warning',
  low: 'info', info: 'info', global: 'info', all: 'info',
};

export const StatusBadge = ({ status, label }) => {
  const key = String(status || '').toLowerCase();
  const tone = TONES[key] || 'neutral';
  const text = label || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Unknown');
  return <span className={`badge badge-${tone}`}><span className="badge-dot" />{text}</span>;
};

export const Badge = ({ tone = 'neutral', children }) => (
  <span className={`badge badge-${tone}`}>{children}</span>
);

/* ------------------------------------------------------------------- forms */

export const FormField = ({ label, required, error, hint, children, className = '' }) => {
  const id = useId();
  const child = typeof children === 'function' ? children(id) : children;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>
        {label} {required ? <span className="req" aria-hidden="true">*</span> : null}
      </label>
      {child}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
      {!error && hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
};

export const TextInput = ({ label, required, error, hint, className, ...rest }) => (
  <FormField label={label} required={required} error={error} hint={hint} className={className}>
    {(id) => <input id={id} className={`input ${error ? 'invalid' : ''}`} {...rest} />}
  </FormField>
);

export const SelectInput = ({ label, required, error, hint, options = [], placeholder, className, ...rest }) => (
  <FormField label={label} required={required} error={error} hint={hint} className={className}>
    {(id) => (
      <select id={id} className={`select ${error ? 'invalid' : ''}`} {...rest}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    )}
  </FormField>
);

export const TextArea = ({ label, required, error, hint, className, ...rest }) => (
  <FormField label={label} required={required} error={error} hint={hint} className={className}>
    {(id) => <textarea id={id} className={`textarea ${error ? 'invalid' : ''}`} {...rest} />}
  </FormField>
);

export const PasswordInput = ({ label, required, error, hint, className, ...rest }) => {
  const [visible, setVisible] = useState(false);
  return (
    <FormField label={label} required={required} error={error} hint={hint} className={className}>
      {(id) => (
        <div className="password-field">
          <input id={id} type={visible ? 'text' : 'password'} className={`input ${error ? 'invalid' : ''}`} {...rest} />
          <button
            type="button"
            className="toggle"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? <IconEyeOff size={17} /> : <IconEye size={17} />}
          </button>
        </div>
      )}
    </FormField>
  );
};

/**
 * Debounced search box.
 *
 * Every list page refetches on each `onChange`, and the Apps Script bridge takes
 * several seconds per request, so emitting on every keystroke made the field
 * feel stuck: the table flipped to a spinner per character and requests piled up.
 * Keep the text local and hand the value out only once typing pauses.
 */
export const SearchBar = ({ value, onChange, placeholder = 'Search...', className = '', delay = 350 }) => {
  const [text, setText] = useState(value ?? '');
  const typing = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Adopt outside changes (a cleared filter, a reset) but never overwrite the
  // field while the user is mid-word.
  useEffect(() => {
    if (!typing.current) setText(value ?? '');
  }, [value]);

  useEffect(() => {
    if (!typing.current) return undefined;
    // Typing back to the current value needs no request at all.
    if (text === (value ?? '')) {
      typing.current = false;
      return undefined;
    }
    const timer = setTimeout(() => {
      typing.current = false;
      onChangeRef.current(text);
    }, delay);
    return () => clearTimeout(timer);
    // `onChange` is deliberately excluded: pages pass a fresh arrow on every
    // render, and depending on it would restart the timer and never fire.
  }, [text, delay, value]);

  return (
    <div className={`searchbar ${className}`}>
      <span className="search-icon"><IconSearch size={16} /></span>
      <input
        type="search"
        className="input"
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => { typing.current = true; setText(e.target.value); }}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ modals */

export const Modal = ({ open, title, onClose, children, footer, size = '' }) => {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Start on the first real form control. Querying the whole dialog would
    // match the close button, which precedes the body in the DOM.
    const scope = ref.current?.querySelector('.modal-body') || ref.current;
    const firstField = scope?.querySelector('input:not([type="hidden"]), select, textarea');
    (firstField || ref.current)?.focus();
    // Deliberately keyed on `open` only: `onClose` is a new arrow on every
    // parent render, so including it re-ran this effect — and stole focus back
    // to the close button after a single keystroke.
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCloseRef.current?.(); }}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={() => onCloseRef.current?.()} aria-label="Close dialog"><IconX size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
};

export const ConfirmDialog = ({ open, title = 'Please confirm', message, confirmLabel = 'Confirm', tone = 'danger', loading, onConfirm, onCancel }) => (
  <Modal
    open={open}
    title={title}
    size="narrow"
    onClose={loading ? () => {} : onCancel}
    footer={(
      <>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>Cancel</button>
        <button type="button" className={`btn btn-${tone}`} onClick={onConfirm} disabled={loading}>
          {loading ? <span className="spinner" /> : null}{confirmLabel}
        </button>
      </>
    )}
  >
    <p>{message}</p>
  </Modal>
);

/* -------------------------------------------------------------- pagination */

export const Pagination = ({ pagination, onPageChange }) => {
  if (!pagination || pagination.total === 0) return null;
  const { page, totalPages, total, limit } = pagination;
  const pages = [];
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  for (let i = start; i <= end; i += 1) pages.push(i);

  return (
    <div className="pagination">
      <span className="pagination-info">
        Page {page} of {totalPages} &middot; {total} record{total === 1 ? '' : 's'} &middot; {limit} per page
      </span>
      <button type="button" className="page-btn" onClick={() => onPageChange(page - 1)} disabled={!pagination.hasPrev} aria-label="Previous page">
        <IconChevronLeft size={15} />
      </button>
      {pages[0] > 1 ? <span className="pagination-info">&hellip;</span> : null}
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          className={`page-btn ${p === page ? 'active' : ''}`}
          aria-current={p === page ? 'page' : undefined}
          onClick={() => onPageChange(p)}
        >
          {p}
        </button>
      ))}
      {pages[pages.length - 1] < totalPages ? <span className="pagination-info">&hellip;</span> : null}
      <button type="button" className="page-btn" onClick={() => onPageChange(page + 1)} disabled={!pagination.hasNext} aria-label="Next page">
        <IconChevronRight size={15} />
      </button>
    </div>
  );
};

/* ------------------------------------------------------------------- table */

export const DataTable = ({ columns, rows, keyField = 'id', emptyTitle, emptyDescription, onRowClick, rowClassName }) => {
  if (!rows || rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined} scope="col">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row[keyField] ?? row.id ?? index}
              className={rowClassName ? rowClassName(row) : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className={col.className}>
                  {col.render ? col.render(row, index) : (row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ------------------------------------------------------------------ toasts */

const ToastContext = createContext(null);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback((tone, title, message) => {
    counter.current += 1;
    const id = counter.current;
    setToasts((list) => [...list, { id, tone, title, message }]);
    setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4200);
  }, [dismiss]);

  const value = useMemo(
    () => ({
      success: (title, message) => push('success', title, message),
      error: (title, message) => push('error', title, message),
      warning: (title, message) => push('warning', title, message),
      info: (title, message) => push('info', title, message),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
            <div style={{ flex: 1 }}>
              <div className="toast-title">{toast.title}</div>
              {toast.message ? <div className="toast-message">{toast.message}</div> : null}
            </div>
            <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
              <IconX size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
};

/* ------------------------------------------------------------------ hooks */

/** Debounced value (used by every search box so we do not spam the API). */
export const useDebounced = (value, delay = 350) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

/** Filter dropdown driven by real department data. */
export const useDepartments = () => {
  const [departments, setDepartments] = useState([]);
  useEffect(() => {
    let cancelled = false;
    departmentsApi
      .list()
      .then((res) => { if (!cancelled) setDepartments(res.data || []); })
      .catch(() => { if (!cancelled) setDepartments([]); });
    return () => { cancelled = true; };
  }, []);
  return departments;
};

export const ProgressBar = ({ value, tone }) => {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const auto = pct >= 75 ? 'success' : pct >= 50 ? '' : pct >= 25 ? 'warning' : 'danger';
  return (
    <div className="progress-track" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-fill ${tone ?? auto}`} style={{ width: `${pct}%` }} />
    </div>
  );
};