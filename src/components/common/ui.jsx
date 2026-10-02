import React, { useState, useMemo, useEffect } from 'react';
import { CheckCircle2, Clock, AlertTriangle, XCircle, ShieldCheck, FileText, Send, PauseCircle, Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Inbox, User, HardDrive, CheckCircle, ShieldAlert, X, AlertCircle, Info } from 'lucide-react';
import { useApp, useTheme, THEMES } from '../../store';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';

/* ── StatusBadge ── */
export function StatusBadge({ status, size = 'md' }) {
  if (!status) return null;

  const normalized = status.toLowerCase();

  let type = 'neutral';
  let Icon = FileText;

  if (
    normalized.includes('verified') || 
    normalized.includes('achieved') || 
    normalized.includes('approved') || 
    normalized.includes('paid') || 
    normalized.includes('completed') || 
    normalized.includes('pass')
  ) {
    type = 'success';
    Icon = CheckCircle2;
  } else if (
    normalized.includes('active') || 
    normalized.includes('published') || 
    normalized.includes('submitted') || 
    normalized.includes('shortlisted') || 
    normalized.includes('pilot') || 
    normalized.includes('within sla')
  ) {
    type = 'info';
    Icon = Clock;
  } else if (
    normalized.includes('review') || 
    normalized.includes('warning') || 
    normalized.includes('pending') || 
    normalized.includes('medium') || 
    normalized.includes('hold') || 
    normalized.includes('needs')
  ) {
    type = 'warning';
    Icon = AlertTriangle;
  } else if (
    normalized.includes('reject') || 
    normalized.includes('fail') || 
    normalized.includes('critical') || 
    normalized.includes('high') || 
    normalized.includes('blocked') || 
    normalized.includes('anomaly')
  ) {
    type = 'danger';
    Icon = XCircle;
  }

  const sizeStyle = size === 'sm' ? { fontSize: '0.68rem', padding: '0.15rem 0.45rem' } : {};

  return (
    <span className={`badge badge-${type}`} style={sizeStyle}>
      <Icon size={size === 'sm' ? 11 : 13} />
      <span>{status}</span>
    </span>
  );
}

export function DataTrustBadge({ trustType }) {
  if (!trustType) return null;

  let badgeClass = 'badge-trust-ai';
  let label = trustType;

  if (trustType.toUpperCase().includes('VERIFIED')) {
    badgeClass = 'badge-trust-verified';
    label = 'VERIFIED DATA';
  } else if (trustType.toUpperCase().includes('REPORTED')) {
    badgeClass = 'badge-trust-reported';
    label = 'STARTUP REPORTED';
  } else if (trustType.toUpperCase().includes('SYSTEM') || trustType.toUpperCase().includes('CALCULATION')) {
    badgeClass = 'badge-trust-system';
    label = 'SYSTEM CALCULATION';
  } else {
    badgeClass = 'badge-trust-ai';
    label = 'AI ADVISORY INTERPRETATION';
  }

  return (
    <span className={`badge ${badgeClass}`} title="Information Source Transparency Tag">
      <ShieldCheck size={11} style={{ marginRight: '2px' }} />
      {label}
    </span>
  );
}

/* ── DataTable ── */
export function DataTable({
  columns = [],
  data = [],
  searchable = true,
  searchPlaceholder = "Search records...",
  searchFields = [],
  pageSize = 10,
  onRowClick = null,
  emptyTitle = "No records found",
  emptySubtitle = "Try adjusting your search query or filter criteria.",
  extraFilters = null
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc' | 'desc'
  const [currentPage, setCurrentPage] = useState(1);

  // Filter and search data
  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return data;

    const term = searchTerm.toLowerCase();
    return data.filter(item => {
      if (searchFields.length > 0) {
        return searchFields.some(field => {
          const val = item[field];
          return val !== undefined && val !== null && String(val).toLowerCase().includes(term);
        });
      }
      // Default: search all string / number values in object
      return Object.values(item).some(val => 
        val !== undefined && val !== null && String(val).toLowerCase().includes(term)
      );
    });
  }, [data, searchTerm, searchFields]);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortField) return filteredData;

    return [...filteredData].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === 'string') {
        const cmp = valA.localeCompare(valB || '');
        return sortDirection === 'asc' ? cmp : -cmp;
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(sortedData.length / pageSize) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
      {/* Search & Extra Filters Bar */}
      {(searchable || extraFilters) && (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          gap: '1rem',
          flexWrap: 'wrap'
        }}>
          {searchable && (
            <div style={{ position: 'relative', width: '320px', maxWidth: '100%' }}>
              <Search 
                size={16} 
                style={{ 
                  position: 'absolute', 
                  left: '0.75rem', 
                  top: '50%', 
                  transform: 'translateY(-50%)', 
                  color: 'var(--slate-400)' 
                }} 
              />
              <input
                type="text"
                className="form-control"
                style={{ paddingLeft: '2.25rem', height: '38px', fontSize: '0.85rem' }}
                placeholder={searchPlaceholder}
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              />
            </div>
          )}

          {extraFilters && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              {extraFilters}
            </div>
          )}
        </div>
      )}

      {/* Table Content */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th 
                  key={col.key || col.header} 
                  style={{ 
                    cursor: col.sortable ? 'pointer' : 'default',
                    width: col.width || 'auto'
                  }}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span>{col.header}</span>
                    {col.sortable && (
                      <span style={{ color: sortField === col.key ? 'var(--gov-navy-600)' : 'var(--slate-400)' }}>
                        {sortField === col.key ? (
                          sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                        ) : (
                          <ChevronDown size={14} style={{ opacity: 0.3 }} />
                        )}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length > 0 ? (
              paginatedData.map((row, idx) => (
                <tr 
                  key={row.id || idx} 
                  onClick={() => onRowClick && onRowClick(row)}
                  style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                >
                  {columns.map(col => (
                    <td key={col.key || col.header}>
                      {col.render ? col.render(row[col.key], row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} style={{ padding: '3.5rem 1rem', textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                    <Inbox size={42} style={{ color: 'var(--slate-300)' }} />
                    <span style={{ fontWeight: 600, color: 'var(--slate-700)', fontSize: '0.95rem' }}>{emptyTitle}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--slate-500)', maxWidth: '350px' }}>{emptySubtitle}</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {sortedData.length > pageSize && (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          fontSize: '0.82rem',
          color: 'var(--slate-600)',
          padding: '0.25rem 0.5rem'
        }}>
          <div>
            Showing <strong>{(currentPage - 1) * pageSize + 1}</strong> to <strong>{Math.min(currentPage * pageSize, sortedData.length)}</strong> of <strong>{sortedData.length}</strong> records
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              className="btn btn-secondary btn-sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              aria-label="Previous Page"
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
            </span>
            <button
              className="btn btn-secondary btn-sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              aria-label="Next Page"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── AuditTimeline ── */
export function AuditTimeline({ logs = [], maxItems = null }) {
  const displayLogs = maxItems ? logs.slice(0, maxItems) : logs;

  if (!logs || logs.length === 0) {
    return (
      <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--slate-500)', fontSize: '0.85rem' }}>
        No audit events recorded yet.
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', paddingLeft: '1.5rem' }}>
      {/* Vertical Timeline Guide Line */}
      <div 
        style={{
          position: 'absolute',
          left: '7px',
          top: '8px',
          bottom: '12px',
          width: '2px',
          background: 'var(--slate-200)'
        }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {displayLogs.map((log, idx) => (
          <div key={log.id || idx} style={{ position: 'relative' }}>
            {/* Timeline Node Icon */}
            <div 
              style={{
                position: 'absolute',
                left: '-1.5rem',
                top: '2px',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: 'var(--white)',
                border: '3px solid var(--gov-navy-600)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            />

            <div style={{
              background: 'var(--white)',
              border: '1px solid var(--slate-200)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.75rem 0.95rem',
              boxShadow: 'var(--shadow-sm)'
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginBottom: '0.35rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--slate-900)' }}>
                    {log.action}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.7rem',
                    background: 'var(--slate-100)',
                    color: 'var(--slate-700)',
                    padding: '0.1rem 0.4rem',
                    borderRadius: 'var(--radius-xs)'
                  }}>
                    {log.entity}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.74rem', color: 'var(--slate-500)', fontFamily: 'var(--font-mono)' }}>
                  <Clock size={12} />
                  {log.timestamp}
                </div>
              </div>

              <div style={{ fontSize: '0.82rem', color: 'var(--slate-700)', marginBottom: '0.4rem', lineHeight: 1.4 }}>
                {log.details}
              </div>

              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                borderTop: '1px dashed var(--slate-100)', 
                paddingTop: '0.4rem',
                fontSize: '0.74rem',
                color: 'var(--slate-500)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <User size={12} />
                  <span><strong>{log.user}</strong> ({log.role})</span>
                </div>
                {log.ipAddress && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-mono)' }}>
                    <HardDrive size={11} />
                    <span>IP: {log.ipAddress}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── ConfirmationDialog ── */
export function ConfirmationDialog({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title = "Confirm Sovereign Action", 
  message, 
  warningText = "AI recommendations are strictly advisory. This is an explicit, human-authorized administrative decision that will be permanently logged in the national audit trail.",
  confirmLabel = "Confirm & Sign Action",
  confirmVariant = "primary",
  requireRemarks = true,
  remarksPlaceholder = "Enter mandatory justification/audit remarks for this executive decision..."
}) {
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [busyConfirm, setBusyConfirm] = useState(false);

  const handleConfirm = () => {
    if (requireRemarks && !remarks.trim()) {
      setError('Official justification / audit remarks are mandatory.');
      return;
    }
    setError('');
    setBusyConfirm(true);
    Promise.resolve(onConfirm(remarks))
      .then(() => { setRemarks(''); onClose(); })
      .catch(() => { /* the store already showed the server's error as a toast; keep the dialog open so nothing is lost */ })
      .finally(() => setBusyConfirm(false));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { setError(''); setRemarks(''); onClose(); }}
      title={title}
      maxWidth="580px"
      footer={
        <>
          <button 
            type="button" 
            className="btn btn-secondary" 
            onClick={() => { setError(''); setRemarks(''); onClose(); }}
          >
            Cancel
          </button>
          <button 
            type="button" 
            className={`btn btn-${confirmVariant}`} 
            onClick={handleConfirm}
            disabled={busyConfirm}
          >
            <CheckCircle size={16} />
            {busyConfirm ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <p style={{ fontSize: '0.92rem', color: 'var(--slate-800)', lineHeight: 1.5 }}>
          {message}
        </p>

        {warningText && (
          <div style={{
            background: 'var(--warning-bg)',
            border: '1px solid var(--warning-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.75rem 1rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem'
          }}>
            <ShieldAlert size={20} color="var(--warning-text)" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.8rem', color: 'var(--warning-text)', lineHeight: 1.45 }}>
              <strong>Public Accountability Notice:</strong> {warningText}
            </div>
          </div>
        )}

        {requireRemarks && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">
              Official Decision Justification <span className="required">*</span>
            </label>
            <textarea
              className="form-control"
              placeholder={remarksPlaceholder}
              value={remarks}
              onChange={(e) => { setRemarks(e.target.value); setError(''); }}
              rows={3}
              style={{ fontSize: '0.85rem' }}
            />
            {error && (
              <span style={{ color: 'var(--danger-text)', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                {error}
              </span>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── Modal (Radix Dialog: focus trap, scroll lock, aria, Esc) ── */
export function Modal({ isOpen, onClose, title, children, footer, maxWidth = '650px' }) {
  return (
    <Dialog.Root open={!!isOpen} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="rx-overlay" />
        <Dialog.Content className="rx-content" style={{ maxWidth }} aria-describedby={undefined}>
          <div className="modal-header">
            <Dialog.Title style={{ fontSize: '1.05rem', margin: 0, fontWeight: 700 }}>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn btn-secondary btn-sm" aria-label="Close" style={{ padding: '0.25rem 0.5rem', border: 'none', background: 'transparent' }}>
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── Tooltip ── */
export function Tip({ label, children, side = 'top' }) {
  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="rx-tip" side={side} sideOffset={6}>{label}<Tooltip.Arrow className="rx-tip-arrow" /></Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/* ── Toasts: every API success/failure surfaces here (never silent) ── */
export function ToastHost() {
  const { toasts, dismissToast } = useApp();
  const icon = { success: <CheckCircle2 size={18} />, error: <AlertCircle size={18} />, info: <Info size={18} /> };
  return (
    <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
          {icon[t.type]}
          <span style={{ flex: 1 }}>{t.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="toast-x"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/* ── Small helpers shared by role screens ── */
export const inr = (rupees) => '₹' + Number(rupees || 0).toLocaleString('en-IN');
export const inrPaise = (paise) => '₹' + (Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>{title}</h1>
        {subtitle && <span style={{ fontSize: '0.8rem', color: 'var(--slate-500)' }}>{subtitle}</span>}
      </div>
      {actions && <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--slate-500)' }}>
      <div style={{ fontWeight: 700, color: 'var(--slate-800)', marginBottom: '0.35rem' }}>{title}</div>
      <div style={{ fontSize: '0.85rem' }}>{children}</div>
    </div>
  );
}

/** Runs an async handler with a busy flag so buttons can disable themselves while a request is in flight. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    try { return await fn(); } catch { return undefined; } finally { setBusy(false); }
  };
  return [busy, run];
}


/* ── Brand mark (quarter-grid: an arch over a startup circle and an institution square) ── */
export function Logo({ size = 32, withName = true, nameSize = 18, tone = 'default' }) {
  const ink = tone === 'onDark' ? '#FFFFFF' : 'var(--ink)';
  const accent = tone === 'onDark' ? '#FFB000' : 'var(--accent)';
  const accentText = tone === 'onDark' ? '#FFB000' : 'var(--accent-text)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size / 3.2) }}>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <path d="M6 30 A24 24 0 0 1 30 6 V30 Z" style={{ fill: ink }} />
        <path d="M58 30 A24 24 0 0 0 34 6 V30 Z" style={{ fill: ink }} />
        <circle cx="18" cy="46" r="12" style={{ fill: accent }} />
        <rect x="34" y="34" width="24" height="24" style={{ fill: ink }} />
      </svg>
      {withName && (
        <span style={{ fontFamily: "'Sora','Figtree',sans-serif", fontWeight: 800, fontSize: nameSize, letterSpacing: '-0.02em', color: ink }}>
          Startup<span style={{ color: accentText }}>2</span>Sarkar
        </span>
      )}
    </span>
  );
}

/* ── Theme picker + light/dark switch (remembered per browser) ── */
export function ThemeControls({ compact = false }) {
  const { theme, setTheme, mode, toggleMode } = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {!compact && (
        <div role="group" aria-label="Theme" style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 'var(--radius-md)', background: 'var(--slate-100)' }}>
          {THEMES.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTheme(id)} aria-pressed={theme === id}
              style={{ height: 30, padding: '0 12px', border: 0, borderRadius: 6, cursor: 'pointer', font: '600 12px Figtree, sans-serif', background: theme === id ? 'var(--brand)' : 'transparent', color: theme === id ? 'var(--on-brand)' : 'var(--slate-800)' }}>
              {label}
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={toggleMode} aria-label={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}
        style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 'var(--radius-md)', border: '1px solid var(--slate-300)', background: 'var(--white)', color: 'var(--slate-800)', cursor: 'pointer' }}>
        {mode === 'dark'
          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
          : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" /></svg>}
      </button>
    </div>
  );
}
