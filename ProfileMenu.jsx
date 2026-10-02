import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../store';
import { authApi } from '../../api';
import { 
  ShieldCheck, ShieldAlert, Smartphone, 
  Laptop, LogOut, X, Check, Copy, RefreshCw
} from 'lucide-react';

export function ProfileMenu({ isOpen, onClose }) {
  const { user, logout, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'mfa' | 'sessions'
  
  // MFA setup state
  const [mfaSetupData, setMfaSetupData] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState(null);
  const [mfaSuccess, setMfaSuccess] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Sessions state
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const data = await authApi.sessions();
      setSessions(data.sessions || []);
    } catch (err) {
      setSessionsError(err.message || 'Failed to load active sessions');
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && activeTab === 'sessions') {
      fetchSessions();
    }
  }, [isOpen, activeTab, fetchSessions]);

  if (!isOpen || !user) return null;

  const handleStartMfaSetup = async () => {
    setMfaLoading(true);
    setMfaError(null);
    try {
      const data = await authApi.setupMfa();
      setMfaSetupData(data);
      setActiveTab('mfa');
    } catch (err) {
      setMfaError(err.message || 'Failed to initiate MFA setup');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleConfirmMfa = async (e) => {
    e.preventDefault();
    if (!mfaCode || mfaCode.length !== 6) {
      setMfaError('Please enter a valid 6-digit verification code.');
      return;
    }
    setMfaLoading(true);
    setMfaError(null);
    try {
      await authApi.enableMfa(mfaCode);
      setMfaSuccess(true);
      await refreshUser();
      setTimeout(() => {
        setMfaSuccess(false);
        setActiveTab('overview');
        setMfaSetupData(null);
      }, 2000);
    } catch (err) {
      setMfaError(err.message || 'Verification failed. Please check the code.');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleLogoutAllOther = async () => {
    try {
      await authApi.logoutAll();
      await fetchSessions();
    } catch (err) {
      setSessionsError(err.message || 'Failed to terminate other sessions');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(3px)',
      zIndex: 999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem'
    }} onClick={onClose}>
      <div 
        style={{
          background: 'var(--white, #ffffff)',
          width: '100%',
          maxWidth: '520px',
          borderRadius: 'var(--radius-lg, 12px)',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          border: '1px solid var(--slate-200, #e2e8f0)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          background: 'linear-gradient(135deg, #0a1f44 0%, #153e77 100%)',
          color: '#ffffff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              background: '#2563eb',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '1rem',
              border: '2px solid rgba(255,255,255,0.3)'
            }}>
              {(user.name || 'User').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.05rem', lineHeight: 1.2 }}>
                {user.name}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#93c5fd', marginTop: '0.15rem' }}>
                {user.email} • {user.role?.toUpperCase()}
              </div>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', padding: '0.25rem' }}
            aria-label="Close profile menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--slate-200, #e2e8f0)',
          background: 'var(--slate-50, #f8fafc)'
        }}>
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              border: 'none',
              borderBottom: activeTab === 'overview' ? '2px solid var(--gov-navy-700, #153e77)' : '2px solid transparent',
              background: activeTab === 'overview' ? '#ffffff' : 'transparent',
              color: activeTab === 'overview' ? 'var(--gov-navy-700, #153e77)' : 'var(--slate-600, #475569)',
              fontWeight: activeTab === 'overview' ? 700 : 500,
              fontSize: '0.82rem',
              cursor: 'pointer'
            }}
          >
            User Details
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mfa')}
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              border: 'none',
              borderBottom: activeTab === 'mfa' ? '2px solid var(--gov-navy-700, #153e77)' : '2px solid transparent',
              background: activeTab === 'mfa' ? '#ffffff' : 'transparent',
              color: activeTab === 'mfa' ? 'var(--gov-navy-700, #153e77)' : 'var(--slate-600, #475569)',
              fontWeight: activeTab === 'mfa' ? 700 : 500,
              fontSize: '0.82rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem'
            }}
          >
            <span>Multi-Factor (MFA)</span>
            {user.mfa_enabled ? (
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
            ) : (
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b' }} />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sessions')}
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              border: 'none',
              borderBottom: activeTab === 'sessions' ? '2px solid var(--gov-navy-700, #153e77)' : '2px solid transparent',
              background: activeTab === 'sessions' ? '#ffffff' : 'transparent',
              color: activeTab === 'sessions' ? 'var(--gov-navy-700, #153e77)' : 'var(--slate-600, #475569)',
              fontWeight: activeTab === 'sessions' ? 700 : 500,
              fontSize: '0.82rem',
              cursor: 'pointer'
            }}
          >
            Active Sessions
          </button>
        </div>

        {/* Tab Body */}
        <div style={{ padding: '1.5rem', maxHeight: '420px', overflowY: 'auto' }}>
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{
                background: 'var(--slate-50, #f8fafc)',
                padding: '1rem',
                borderRadius: 'var(--radius-md, 8px)',
                border: '1px solid var(--slate-200, #e2e8f0)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--slate-500, #64748b)' }}>Designation:</span>
                  <span style={{ fontWeight: 600, color: 'var(--slate-800, #1e293b)' }}>{user.designation || 'Operational Staff'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--slate-500, #64748b)' }}>Entity / Ministry:</span>
                  <span style={{ fontWeight: 600, color: 'var(--slate-800, #1e293b)' }}>{user.department_name || user.organization_name || 'Central Administration'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--slate-500, #64748b)' }}>Operational Role:</span>
                  <span style={{ fontWeight: 700, color: '#153e77', textTransform: 'capitalize' }}>{user.role}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--slate-500, #64748b)' }}>MFA Status:</span>
                  {user.mfa_enabled ? (
                    <span style={{ color: '#059669', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <ShieldCheck size={14} /> Enforced (TOTP)
                    </span>
                  ) : (
                    <span style={{ color: '#d97706', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <ShieldAlert size={14} /> Not Configured
                    </span>
                  )}
                </div>
              </div>

              {!user.mfa_enabled && (
                <div style={{
                  padding: '0.85rem',
                  borderRadius: 'var(--radius-md, 8px)',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem'
                }}>
                  <ShieldAlert size={18} color="#b45309" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#92400e' }}>
                      Mandatory Security Recommended
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#b45309', marginTop: '0.2rem', lineHeight: 1.4 }}>
                      Sovereign procurement regulations strongly advise activating TOTP 2-Factor Authentication for all financial and official authoring accounts.
                    </div>
                    <button
                      type="button"
                      onClick={handleStartMfaSetup}
                      disabled={mfaLoading}
                      style={{
                        marginTop: '0.5rem',
                        background: '#b45309',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '0.35rem 0.75rem',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      {mfaLoading ? 'Generating Secret...' : 'Setup 2FA Now'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'mfa' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {user.mfa_enabled ? (
                <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                  <div style={{
                    width: '54px',
                    height: '54px',
                    borderRadius: '50%',
                    background: '#dcfce7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 1rem auto'
                  }}>
                    <ShieldCheck size={32} color="#15803d" />
                  </div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--slate-900, #0f172a)' }}>
                    Two-Factor Authentication is Active
                  </h3>
                  <p style={{ fontSize: '0.82rem', color: 'var(--slate-600, #475569)', maxWidth: '380px', margin: '0.5rem auto 0 auto', lineHeight: 1.5 }}>
                    Your account is fully compliant with statutory MFA standards. Every login requires your password plus a 6-digit code from your authenticator app.
                  </p>
                </div>
              ) : mfaSetupData ? (
                <div>
                  <div style={{ fontSize: '0.84rem', color: 'var(--slate-700, #334155)', marginBottom: '1rem', lineHeight: 1.5 }}>
                    Add this account to <strong>Google Authenticator</strong>, <strong>Aegis</strong>, or <strong>Microsoft Authenticator</strong> using the secret key below:
                  </div>

                  <div style={{
                    background: 'var(--slate-900, #0f172a)',
                    color: '#38bdf8',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-md, 8px)',
                    fontFamily: 'monospace',
                    fontSize: '0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '1rem'
                  }}>
                    <span>{mfaSetupData.secret}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(mfaSetupData.secret)}
                      style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem' }}
                    >
                      {copiedSecret ? <Check size={14} color="#4ade80" /> : <Copy size={14} />}
                      <span>{copiedSecret ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>

                  {mfaSetupData.recoveryCodes && (
                    <div style={{ marginBottom: '1rem' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--slate-600, #475569)', marginBottom: '0.35rem' }}>
                        Recovery Codes (Store safely):
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: '0.35rem',
                        background: 'var(--slate-50, #f8fafc)',
                        padding: '0.6rem',
                        borderRadius: '6px',
                        border: '1px solid var(--slate-200, #e2e8f0)',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        color: 'var(--slate-700, #334155)'
                      }}>
                        {mfaSetupData.recoveryCodes.map((code, idx) => (
                          <div key={idx}>{code}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  <form onSubmit={handleConfirmMfa}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--slate-700, #334155)', marginBottom: '0.4rem' }}>
                      Enter 6-Digit Authenticator Code:
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        maxLength={6}
                        placeholder="123456"
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                        style={{
                          flex: 1,
                          padding: '0.6rem 0.85rem',
                          borderRadius: 'var(--radius-sm, 6px)',
                          border: '1px solid var(--slate-300, #cbd5e1)',
                          fontSize: '1rem',
                          fontFamily: 'monospace',
                          letterSpacing: '0.2em',
                          textAlign: 'center'
                        }}
                      />
                      <button
                        type="submit"
                        disabled={mfaLoading || mfaCode.length !== 6}
                        className="btn btn-primary"
                        style={{ background: '#153e77', color: '#ffffff' }}
                      >
                        {mfaLoading ? 'Verifying...' : 'Activate MFA'}
                      </button>
                    </div>
                    {mfaError && (
                      <div style={{ color: '#dc2626', fontSize: '0.76rem', marginTop: '0.4rem' }}>
                        {mfaError}
                      </div>
                    )}
                    {mfaSuccess && (
                      <div style={{ color: '#16a34a', fontSize: '0.76rem', marginTop: '0.4rem', fontWeight: 700 }}>
                        ✓ MFA Successfully Activated!
                      </div>
                    )}
                  </form>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <ShieldAlert size={36} color="#d97706" style={{ margin: '0 auto 0.75rem auto' }} />
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--slate-800, #1e293b)' }}>
                    Protect Your Sovereign Session
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--slate-600, #475569)', margin: '0.35rem 0 1rem 0' }}>
                    Generate a secret to link your authenticator app.
                  </p>
                  <button
                    type="button"
                    onClick={handleStartMfaSetup}
                    disabled={mfaLoading}
                    className="btn btn-primary"
                    style={{ background: '#153e77', color: '#ffffff', margin: '0 auto' }}
                  >
                    {mfaLoading ? 'Generating Secret...' : 'Begin MFA Setup'}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'sessions' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--slate-700, #334155)' }}>
                  Active Devices & Tokens ({sessions.length})
                </span>
                <button
                  type="button"
                  onClick={fetchSessions}
                  disabled={sessionsLoading}
                  style={{ background: 'transparent', border: 'none', color: '#153e77', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                >
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>

              {sessionsLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem', fontSize: '0.8rem', color: 'var(--slate-500, #64748b)' }}>
                  Loading sessions...
                </div>
              ) : sessionsError ? (
                <div style={{ color: '#dc2626', fontSize: '0.78rem', padding: '1rem' }}>
                  {sessionsError}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  {sessions.map(s => (
                    <div
                      key={s.id}
                      style={{
                        padding: '0.75rem',
                        borderRadius: '6px',
                        border: s.is_current ? '1px solid #93c5fd' : '1px solid var(--slate-200, #e2e8f0)',
                        background: s.is_current ? '#eff6ff' : 'var(--white, #ffffff)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        {s.user_agent?.includes('Mobile') ? (
                          <Smartphone size={20} color="var(--slate-500, #64748b)" />
                        ) : (
                          <Laptop size={20} color="var(--slate-500, #64748b)" />
                        )}
                        <div>
                          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--slate-900, #0f172a)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span>{s.ip_address || '127.0.0.1'}</span>
                            {s.is_current && (
                              <span style={{ fontSize: '0.65rem', background: '#2563eb', color: '#ffffff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                This Session
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--slate-500, #64748b)', marginTop: '0.15rem' }}>
                            Active: {s.last_active_at ? new Date(s.last_active_at).toLocaleString() : 'Just now'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {sessions.length > 1 && (
                    <button
                      type="button"
                      onClick={handleLogoutAllOther}
                      style={{
                        marginTop: '0.5rem',
                        background: 'transparent',
                        border: '1px solid #fca5a5',
                        color: '#dc2626',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Terminate All Other Active Sessions
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer / Logout Action */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--slate-200, #e2e8f0)',
          background: 'var(--slate-50, #f8fafc)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--slate-500, #64748b)' }}>
            Session authenticated with sovereign cryptographic token
          </span>
          <button
            type="button"
            onClick={logout}
            data-testid="logout-button"
            aria-label="Sign Out of Sovereign Session"
            className="btn btn-outline"
            style={{
              borderColor: '#ef4444',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontSize: '0.8rem',
              fontWeight: 700
            }}
          >
            <LogOut size={14} />
            <span>Sign Out of Sovereign Session</span>
          </button>
        </div>
      </div>
    </div>
  );
}
