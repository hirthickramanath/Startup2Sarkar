import React, { useState } from 'react';
import { useApp } from '../../store';
import { 
  Building, Compass, FileText, CheckSquare, Shield, 
  CreditCard, AlertTriangle, Users, Settings, Bell, 
  Search, Cpu, ChevronRight, Menu, X, LogOut, 
  HelpCircle, RefreshCw, Sparkles, CheckCircle2, Bot, Layers, TrendingUp, KeyRound, ShieldCheck
} from 'lucide-react';
import { Logo, ThemeControls } from './ui';
import { GlobalSearchModal } from './GlobalSearchModal';
import { AssistantDrawer } from './AssistantDrawer';
import { ProfileMenu } from './ProfileMenu';

export function AppShell({ children, pageTitle = "Dashboard", breadcrumbs = [] }) {
  const { 
    currentRole, 
    currentUser, 
    currentRoute, 
    navigate, 
    state, 
    setIsSearchOpen,
    markNotificationRead,
    markAllNotificationsRead
  } = useApp();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  // Filter unread notifications for current role
  // The server already returns only this user's and this role's notifications
  const roleNotifications = state.notifications;
  const unreadCount = roleNotifications.filter(n => !n.read).length;

  // Sidebar items mapped to role
  const getSidebarNav = () => {
    switch (currentRole) {
      case 'government':
        return [
          { label: 'Executive Dashboard', route: '/government/dashboard', icon: Building },
          { label: 'AI Challenge Creator', route: '/government/challenges/create', icon: Sparkles, badge: 'AI' },
          { label: 'Innovation Challenges', route: '/government/challenges', icon: Compass },
          { label: 'AI Pilot Manager', route: '/government/pilot-manager', icon: Cpu, badge: 'Advisory' },
          { label: 'Monitored Pilots', route: '/government/pilots', icon: FileText },
          { label: 'Sovereign Audit Trail', route: '/government/audit', icon: Shield }
        ];
      case 'startup':
        return [
          { label: 'Startup Dashboard', route: '/startup/dashboard', icon: Building },
          { label: 'Discover Challenges', route: '/startup/challenges', icon: Compass },
          { label: 'Submit Proposal', route: '/startup/proposals/create', icon: FileText },
          { label: 'Proposal Tracking', route: '/startup/proposals', icon: Layers },
          { label: 'Pilot Workspace', route: '/startup/pilots', icon: CheckSquare },
          { label: 'Payment Status', route: '/startup/payments', icon: CreditCard },
          { label: 'Startup Profile', route: '/startup/profile', icon: Users }
        ];
      case 'inspector':
        return [
          { label: 'Inspector Dashboard', route: '/inspector/dashboard', icon: Building },
          { label: 'Assigned Pilots', route: '/inspector/pilots', icon: FileText },
          { label: 'Field Verification', route: '/inspector/inspections', icon: CheckSquare },
          { label: 'Risk Register', route: '/inspector/risks', icon: AlertTriangle }
        ];
      case 'finance':
        return [
          { label: 'Treasury Dashboard', route: '/finance/dashboard', icon: Building },
          { label: 'Budget Allocation', route: '/finance/budget', icon: Layers },
          { label: 'Payment Claims', route: '/finance/payments', icon: CreditCard, count: state.payments.filter(p => ['SUBMITTED','UNDER_REVIEW','VERIFICATION_PENDING','FINANCE_REVIEW'].includes(p.rawStatus)).length },
          { label: 'Tax Ledger', route: '/finance/tax-ledger', icon: Layers },
          { label: 'Bank Reconciliation', route: '/finance/reconcile', icon: FileText },
          { label: 'Financial Anomalies', route: '/finance/anomalies', icon: AlertTriangle, count: state.anomalies.filter(a => ['DETECTED','INVESTIGATING'].includes(a.rawStatus)).length, badgeType: 'danger' },
          { label: 'Stalled Projects & Recovery', route: '/finance/stalled', icon: Shield },
          { label: 'Audit Case Files', route: '/finance/reports', icon: FileText }
        ];
      case 'investor':
        return [
          { label: 'Investor Dashboard', route: '/investor/dashboard', icon: Building },
          { label: 'Startup Directory', route: '/investor/startups', icon: Compass },
          { label: 'My Introductions', route: '/investor/intros', icon: Layers },
          { label: 'Profile', route: '/investor/profile', icon: Users }
        ];
      case 'admin':
        return [
          { label: 'Platform Console', route: '/admin/dashboard', icon: Building },
          { label: 'Access Requests', route: '/admin/access-requests', icon: CheckSquare, count: (state.accessRequests || []).length },
          { label: 'Startup Verification', route: '/admin/startups', icon: ShieldCheck },
          { label: 'User Directory', route: '/admin/users', icon: Users },
          { label: 'Departments', route: '/admin/departments', icon: Layers },
          { label: 'AI Configuration', route: '/admin/ai', icon: Cpu },
          { label: 'Central Audit Logs', route: '/admin/audit', icon: Shield },
          { label: 'System Settings', route: '/admin/settings', icon: Settings }
        ];
      default:
        return [];
    }
  };

  const navItems = getSidebarNav();

  const roleLabels = {
    government: { name: 'Government Official', icon: '🏛️', color: '#153e77' },
    startup: { name: 'Startup Founder', icon: '🚀', color: '#059669' },
    inspector: { name: 'Inspector / Pilot Manager', icon: '🔍', color: '#7c3aed' },
    finance: { name: 'Finance Officer (IFD)', icon: '💰', color: '#b45309' },
    admin: { name: 'Super Administrator', icon: '⚙️', color: '#0f172a' }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--slate-50)' }}>
      {/* 1. Global Sovereign Header / Role Switcher Bar */}
      <div style={{
        background: 'linear-gradient(90deg, #071326 0%, #0a1f44 100%)',
        color: '#ffffff',
        padding: '0.45rem 1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '0.78rem',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        position: 'sticky',
        top: 0,
        zIndex: 600
      }}>
        {/* Left: Branding & National Emblem Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <Logo size={22} nameSize={15} tone="onDark" />
          <span style={{ opacity: 0.4 }}>|</span>
          <span style={{ fontSize: '0.74rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span>Innovation procurement platform</span>
          </span>
        </div>

        {/* Center / Right: Sovereign Security & Compliance Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', color: 'rgba(255,255,255,0.7)', fontSize: '0.72rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Shield size={12} color="#60a5fa" />
            <span>Every action is audit-logged</span>
          </span>
        </div>
      </div>

      {/* 2. Top Application Bar */}
      <header style={{
        background: 'var(--white)',
        borderBottom: '1px solid var(--slate-200)',
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.5rem',
        position: 'sticky',
        top: '37px',
        zIndex: 550
      }}>
        {/* Breadcrumb & Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button 
            type="button"
            className="mobile-toggle"
            style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={() => setMobileMenuOpen(prev => !prev)}
            aria-label="Toggle Navigation"
          >
            <Menu size={20} />
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--slate-500)' }}>
            <span style={{ fontWeight: 600, color: 'var(--slate-700)' }}>
              {roleLabels[currentRole]?.name}
            </span>
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={idx}>
                <ChevronRight size={13} />
                <span 
                  style={{ 
                    color: idx === breadcrumbs.length - 1 ? 'var(--slate-900)' : 'var(--slate-500)',
                    fontWeight: idx === breadcrumbs.length - 1 ? 700 : 500,
                    cursor: crumb.route ? 'pointer' : 'default'
                  }}
                  onClick={() => crumb.route && navigate(crumb.route)}
                >
                  {crumb.label}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Global Search Bar & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          {/* Global Search Trigger (Ctrl+K) */}
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            style={{
              background: 'var(--slate-100)',
              border: '1px solid var(--slate-300)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.4rem 0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              color: 'var(--slate-600)',
              fontSize: '0.82rem',
              cursor: 'pointer',
              width: '280px',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Search size={14} color="var(--slate-400)" />
              <span>Search or command...</span>
            </div>
            <kbd style={{
              background: 'var(--white)',
              border: '1px solid var(--slate-300)',
              borderRadius: '3px',
              padding: '0.1rem 0.35rem',
              fontSize: '0.68rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--slate-500)'
            }}>
              Ctrl K
            </kbd>
          </button>

          {/* Notifications Dropdown */}
          <ThemeControls compact />
          <button type="button" aria-label="Account security" title="Account security" onClick={() => navigate('/account')} style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 'var(--radius-md)', border: '1px solid var(--slate-300)', background: 'var(--white)', color: 'var(--slate-800)', cursor: 'pointer' }}><KeyRound size={17} /></button>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setNotificationsOpen(prev => !prev)}
              style={{
                background: 'transparent',
                border: '1px solid var(--slate-200)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.45rem',
                cursor: 'pointer',
                position: 'relative',
                display: 'flex'
              }}
              aria-label="Notifications"
            >
              <Bell size={18} color="var(--slate-700)" />
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  background: 'var(--danger-text)',
                  color: '#ffffff',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notification Popover */}
            {notificationsOpen && (
              <div style={{
                position: 'absolute',
                top: '42px',
                right: 0,
                width: '340px',
                background: 'var(--white)',
                border: '1px solid var(--slate-200)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)',
                zIndex: 650,
                overflow: 'hidden'
              }}>
                <div style={{
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid var(--slate-200)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'var(--slate-50)'
                }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Notifications</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--slate-500)' }}>
                    {unreadCount} unread
                    {unreadCount > 0 && <button type="button" onClick={markAllNotificationsRead} style={{ marginLeft: '0.6rem', border: 'none', background: 'none', color: 'var(--info-text)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>Mark all read</button>}
                  </span>
                </div>
                <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                  {roleNotifications.length > 0 ? (
                    roleNotifications.map(n => (
                      <div
                        key={n.id}
                        onClick={() => {
                          markNotificationRead(n.id);
                          if (n.link) {
                            navigate(n.link);
                            setNotificationsOpen(false);
                          }
                        }}
                        style={{
                          padding: '0.75rem 1rem',
                          borderBottom: '1px solid var(--slate-100)',
                          background: n.read ? 'var(--white)' : '#f0f7ff',
                          cursor: 'pointer',
                          transition: 'background 0.1s ease'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                          <span style={{ fontWeight: n.read ? 600 : 700, fontSize: '0.82rem', color: 'var(--slate-900)' }}>
                            {n.title}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--slate-400)' }}>{n.timestamp}</span>
                        </div>
                        <p style={{ fontSize: '0.76rem', color: 'var(--slate-600)', margin: 0, lineHeight: 1.4 }}>
                          {n.message}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: '2rem 1rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--slate-500)' }}>
                      You're all caught up
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Interactive User Profile Trigger */}
          <button
            type="button"
            onClick={() => setProfileMenuOpen(true)}
            aria-label="User Profile & Security Settings"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              padding: '0.3rem 0.65rem',
              borderLeft: '1px solid var(--slate-200)',
              borderRadius: 'var(--radius-sm)',
              transition: 'background 0.15s ease',
              textAlign: 'left'
            }}
            title="Open Sovereign Profile & Security Settings"
          >
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'var(--gov-navy-800)',
              color: 'var(--white)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.75rem',
              fontWeight: 700
            }}>
              {currentUser?.avatar || (currentUser?.name || 'IN').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--slate-900)', lineHeight: 1.2 }}>
                {currentUser?.name || 'Authorized Official'}
              </span>
              <span style={{ fontSize: '0.7rem', color: 'var(--slate-500)' }}>
                {currentUser?.title?.split(',')[0] || currentUser?.role?.toUpperCase()}
              </span>
            </div>
            <ChevronRight size={14} color="var(--slate-400)" />
          </button>

          {/* Profile & Security Modal */}
          <ProfileMenu 
            isOpen={profileMenuOpen} 
            onClose={() => setProfileMenuOpen(false)} 
          />
        </div>
      </header>

      {/* 3. Main Body: Sidebar + Page Content */}
      <div style={{ display: 'flex', flex: 1 }}>
        {/* Left Sidebar Navigation */}
        <aside style={{
          width: '240px',
          background: 'var(--white)',
          borderRight: '1px solid var(--slate-200)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          flexShrink: 0
        }}>
          {/* Main Nav Links */}
          <div style={{ padding: '1rem 0.75rem' }}>
            <div style={{ 
              fontSize: '0.7rem', 
              fontWeight: 700, 
              color: 'var(--slate-400)', 
              textTransform: 'uppercase', 
              letterSpacing: '0.05em',
              padding: '0 0.5rem 0.5rem 0.5rem'
            }}>
              Navigation
            </div>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {navItems.map(item => {
                const Icon = item.icon;
                const isActive = currentRoute === item.route || currentRoute.startsWith(item.route + '/');
                return (
                  <button
                    key={item.route}
                    type="button"
                    onClick={() => navigate(item.route)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      background: isActive ? 'var(--gov-navy-50)' : 'transparent',
                      color: isActive ? 'var(--ink)' : 'var(--slate-700)',
                      border: 'none',
                      fontWeight: isActive ? 700 : 500,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={e => {
                      if (!isActive) e.currentTarget.style.backgroundColor = 'var(--slate-50)';
                    }}
                    onMouseLeave={e => {
                      if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <Icon size={16} color={isActive ? 'var(--accent-text)' : 'var(--slate-500)'} />
                      <span>{item.label}</span>
                    </div>

                    {item.badge && (
                      <span style={{
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        background: 'var(--gov-navy-100)',
                        color: 'var(--gov-navy-800)',
                        padding: '0.1rem 0.35rem',
                        borderRadius: '3px'
                      }}>
                        {item.badge}
                      </span>
                    )}

                    {item.count > 0 && (
                      <span style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        background: item.badgeType === 'danger' ? 'var(--danger-bg)' : 'var(--slate-200)',
                        color: item.badgeType === 'danger' ? 'var(--danger-text)' : 'var(--slate-800)',
                        padding: '0.1rem 0.45rem',
                        borderRadius: 'var(--radius-full)'
                      }}>
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Sidebar Footer Info */}
          <div style={{ 
            padding: '1rem 0.85rem', 
            borderTop: '1px solid var(--slate-200)',
            background: 'var(--slate-50)',
            fontSize: '0.72rem',
            color: 'var(--slate-500)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, color: 'var(--slate-700)', marginBottom: '0.2rem' }}>
              <Shield size={13} color="var(--gov-navy-600)" />
              <span>Startup2Sarkar</span>
            </div>
            <div>Hash-chained audit trail • role-scoped access</div>
          </div>
        </aside>

        {/* Center Main Content Area */}
        <main style={{ 
          flex: 1, 
          padding: '1.5rem 2rem', 
          maxWidth: '1440px',
          margin: '0 auto',
          width: '100%',
          overflowX: 'hidden'
        }}>
          {['government', 'finance', 'inspector', 'admin'].includes(currentUser?.role) && currentUser?.mfaEnabled === false && currentRoute !== '/account' && (
            <div role="status" style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap', padding: '.7rem 1rem', marginBottom: '1rem', borderRadius: 'var(--radius-md)', background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', color: 'var(--warning-text)', fontSize: '.84rem' }}>
              <Shield size={16} /> <span style={{ flex: 1 }}>Your account handles public money. Please turn on two-step verification.</span>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('/account')}>Set it up</button>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* Global Command Center Search Modal */}
      <GlobalSearchModal />

      {/* Role-aware assistant */}
      <AssistantDrawer />
    </div>
  );
}
