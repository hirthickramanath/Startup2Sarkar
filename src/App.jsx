import React, { useEffect, useState, lazy, Suspense } from 'react';
import { useApp, useAuth, shouldShowIntro } from './store';
import { authApi } from './api';
import { LoginPage } from './components/auth/LoginPage';
import { Onboarding, AccessPending } from './components/auth/Onboarding';
import { InvestorDashboard, InvestorStartups, InvestorIntros, InvestorProfile } from './components/roles/investor/Investor';
import { AdminAccessRequests } from './components/roles/admin/AdminAccess';
import { AppShell } from './components/common/AppShell';
import { ToastHost, useBusy } from './components/common/ui';
import { ShieldAlert, LogOut, Loader2, KeyRound } from 'lucide-react';

import { GovernmentDashboard } from './components/roles/government/GovernmentDashboard';
import { ChallengeCreate } from './components/roles/government/ChallengeCreate';
import { ChallengesList } from './components/roles/government/ChallengesList';
import { ChallengeDetail } from './components/roles/government/ChallengeDetail';
import { ProposalsList } from './components/roles/government/ProposalsList';
import { AiPilotManager } from './components/roles/government/AiPilotManager';
import { GovernmentPilotsList } from './components/roles/government/GovernmentPilotsList';
import { GovernmentPilotDetail } from './components/roles/government/GovernmentPilotDetail';
import { GovernmentAudit } from './components/roles/government/GovernmentAudit';
import { StartupDashboard } from './components/roles/startup/StartupDashboard';
import { StartupChallenges } from './components/roles/startup/StartupChallenges';
import { StartupChallengeDetail } from './components/roles/startup/StartupChallengeDetail';
import { ProposalCreate } from './components/roles/startup/ProposalCreate';
import { StartupProposals } from './components/roles/startup/StartupProposals';
import { StartupPilotWorkspace } from './components/roles/startup/StartupPilotWorkspace';
import { StartupPayments } from './components/roles/startup/StartupPayments';
import { StartupProfile } from './components/roles/startup/StartupProfile';
import { InspectorDashboard } from './components/roles/inspector/InspectorDashboard';
import { InspectorPilotDetail } from './components/roles/inspector/InspectorPilotDetail';
import { InspectorRisks } from './components/roles/inspector/InspectorRisks';
import { FinanceDashboard } from './components/roles/finance/FinanceDashboard';
import { FinanceBudget } from './components/roles/finance/FinanceBudget';
import { FinancePaymentsList } from './components/roles/finance/FinancePaymentsList';
import { FinancePaymentDetail } from './components/roles/finance/FinancePaymentDetail';
import { FinanceAnomalies } from './components/roles/finance/FinanceAnomalies';
import { FinanceStalledPilots } from './components/roles/finance/FinanceStalledPilots';
import { FinanceReports } from './components/roles/finance/FinanceReports';
import { AdminDashboard } from './components/roles/admin/AdminDashboard';
import { AdminUsers } from './components/roles/admin/AdminUsers';
import { AdminDepartments } from './components/roles/admin/AdminDepartments';
import { AdminAiConfig } from './components/roles/admin/AdminAiConfig';
import { AdminAuditLogs } from './components/roles/admin/AdminAuditLogs';
import { AdminSettings } from './components/roles/admin/AdminSettings';

const Intro = lazy(() => import('./components/auth/Intro').then((m) => ({ default: m.Intro })));

/* Route table: first match wins. `:id` captures one path segment. */
const ROUTES = [
  ['/government/dashboard', 'Executive overview', () => <GovernmentDashboard />],
  ['/government/challenges/create', 'Create challenge', () => <ChallengeCreate />],
  ['/government/challenges/:id/proposals', 'Challenge proposals', ({ id }) => <ProposalsList challengeId={id} />],
  ['/government/challenges/:id', 'Challenge', ({ id }) => <ChallengeDetail challengeId={id} />],
  ['/government/challenges', 'Innovation challenges', () => <ChallengesList />],
  ['/government/pilot-manager', 'Proposal evaluation & selection', () => <AiPilotManager />],
  ['/government/pilots/:id', 'Pilot', ({ id }) => <GovernmentPilotDetail pilotId={id} />],
  ['/government/pilots', 'Monitored pilots', () => <GovernmentPilotsList />],
  ['/government/audit', 'Audit trail', () => <GovernmentAudit />],

  ['/startup/dashboard', 'Startup portal', () => <StartupDashboard />],
  ['/startup/challenges/:id', 'Challenge', ({ id }) => <StartupChallengeDetail challengeId={id} />],
  ['/startup/challenges', 'Discover challenges', () => <StartupChallenges />],
  ['/startup/proposals/create', 'Submit proposal', () => <ProposalCreate />],
  ['/startup/proposals', 'My proposals', () => <StartupProposals />],
  ['/startup/pilots/:id', 'Pilot workspace', ({ id }) => <StartupPilotWorkspace pilotId={id} />],
  ['/startup/pilots', 'Pilot workspace', () => <StartupPilotWorkspace />],
  ['/startup/payments', 'Payments', () => <StartupPayments />],
  ['/startup/profile', 'Profile', () => <StartupProfile />],

  ['/inspector/dashboard', 'Assigned pilots', () => <InspectorDashboard />],
  ['/inspector/pilots/:id', 'Inspection docket', ({ id }) => <InspectorPilotDetail pilotId={id} />],
  ['/inspector/pilots', 'Assigned pilots', () => <InspectorDashboard />],
  ['/inspector/inspections', 'Assigned pilots', () => <InspectorDashboard />],
  ['/inspector/risks', 'Risk register', () => <InspectorRisks />],

  ['/finance/dashboard', 'Treasury dashboard', () => <FinanceDashboard />],
  ['/finance/budget', 'Budgets', () => <FinanceBudget />],
  ['/finance/payments/:id', 'Payment claim', ({ id }) => <FinancePaymentDetail paymentId={id} />],
  ['/finance/payments', 'Payment claims', () => <FinancePaymentsList />],
  ['/finance/anomalies', 'Anomalies', () => <FinanceAnomalies />],
  ['/finance/stalled', 'Stalled pilots', () => <FinanceStalledPilots />],
  ['/finance/reports', 'Case files', () => <FinanceReports />],

  ['/investor/dashboard', 'Investor workspace', () => <InvestorDashboard />],
  ['/investor/startups', 'Startup directory', () => <InvestorStartups />],
  ['/investor/intros', 'My introductions', () => <InvestorIntros />],
  ['/investor/profile', 'Investor profile', () => <InvestorProfile />],

  ['/admin/dashboard', 'Platform operations', () => <AdminDashboard />],
  ['/admin/access-requests', 'Access requests', () => <AdminAccessRequests />],
  ['/admin/users', 'User directory', () => <AdminUsers />],
  ['/admin/departments', 'Departments', () => <AdminDepartments />],
  ['/admin/ai', 'AI governance', () => <AdminAiConfig />],
  ['/admin/audit', 'Audit logs', () => <AdminAuditLogs />],
  ['/admin/settings', 'System settings', () => <AdminSettings />],
];

function matchRoute(path) {
  const clean = path.replace(/\/+$/, '') || '/';
  for (const [pattern, title, render] of ROUTES) {
    const pp = pattern.split('/'); const cp = clean.split('/');
    if (pp.length !== cp.length) continue;
    const params = {};
    if (pp.every((seg, i) => (seg.startsWith(':') ? ((params[seg.slice(1)] = decodeURIComponent(cp[i])), true) : seg === cp[i]))) return { title, render, params };
  }
  return null;
}

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('UI error:', error, info?.componentStack); }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" style={{ maxWidth: 560, margin: '4rem auto', textAlign: 'center', padding: '2rem' }}>
        <ShieldAlert size={32} color="var(--danger-text)" />
        <h2 style={{ fontSize: '1.15rem' }}>This screen hit an unexpected problem</h2>
        <p style={{ color: 'var(--slate-600)', fontSize: '0.85rem' }}>Your data is safe — nothing was changed. Try again, or go back to your dashboard.</p>
        <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}

function Splash() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#050b1a', color: '#93c5fd' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}><Loader2 size={18} className="spin" /> Loading Startup2Sarkar…</div>
    </div>
  );
}

/** Admin-provisioned accounts must replace their temporary password before using the platform. */
function ForcePasswordChange() {
  const { logout, refreshUser } = useAuth();
  const { toast } = useApp();
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [err, setErr] = useState(null);
  const [busy, run] = useBusy();
  const submit = (e) => {
    e.preventDefault(); setErr(null);
    run(async () => {
      try { await authApi.changePassword(cur, next); toast.success('Password updated'); await refreshUser(); }
      catch (ex) { setErr(Array.isArray(ex.details) ? `${ex.message}: ${ex.details.join('; ')}` : ex.message); }
    });
  };
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--slate-50)', padding: '1rem' }}>
      <form className="auth-card" onSubmit={submit} style={{ maxWidth: 420, width: '100%' }}>
        <KeyRound size={28} color="#60a5fa" />
        <h1 className="auth-h2">Set a new password</h1>
        <p className="auth-hint">Your administrator issued a temporary password. Choose your own to continue (min 10 characters with upper & lower case, a number and a symbol).</p>
        {err && <div className="auth-error" role="alert">{err}</div>}
        <label className="auth-field">Temporary password<input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required /></label>
        <label className="auth-field">New password<input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required /></label>
        <button className="auth-primary" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
        <button type="button" className="auth-link" onClick={logout} style={{ alignSelf: 'center' }}>Sign out</button>
      </form>
    </div>
  );
}

export default function App() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const { currentRoute, navigate } = useApp();
  const [intro, setIntro] = useState(() => shouldShowIntro());

  // After sign-in, or when opening "/" or a login URL while signed in, land on the role dashboard
  useEffect(() => {
    if (isAuthenticated && user && (currentRoute === '/' || currentRoute.startsWith('/login') || currentRoute === '/signup')) navigate(`/${user.role}/dashboard`);
  }, [isAuthenticated, user, currentRoute, navigate]);

  if (isLoading) return <Splash />;

  if (intro && !isAuthenticated) {
    return (
      <Suspense fallback={<Splash />}>
        <Intro onDone={() => setIntro(false)} />
      </Suspense>
    );
  }

  if (!isAuthenticated) {
    if (currentRoute === '/signup') return <><Onboarding /><ToastHost /></>;
    const m = currentRoute.match(/^\/login\/([a-z]+)/);
    return <><LoginPage initialRole={m ? m[1] : null} /><ToastHost /></>;
  }
  if (user.status && user.status !== 'ACTIVE') return <><AccessPending /><ToastHost /></>;
  if (user.mustChangePassword) return <><ForcePasswordChange /><ToastHost /></>;
  if (currentRoute === '/' || currentRoute.startsWith('/login') || currentRoute === '/signup') return null;

  // Role gate (the server enforces this independently; this just gives a friendly screen)
  const allowed = user.role === 'admin' || currentRoute.startsWith(`/${user.role}/`) || currentRoute === `/${user.role}`;
  const match = allowed ? matchRoute(currentRoute) : null;

  return (
    <>
      <AppShell pageTitle={match?.title || 'Not found'} breadcrumbs={[{ label: match?.title || 'Not found' }]}>
        <ErrorBoundary resetKey={currentRoute}>
          {!allowed ? (
            <div className="card" style={{ maxWidth: 600, margin: '4rem auto', textAlign: 'center', padding: '2.5rem' }}>
              <ShieldAlert size={36} color="var(--danger-text)" />
              <h2 style={{ fontSize: '1.25rem', margin: '0.75rem 0 0.5rem' }}>You don't have access to this area</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--slate-600)' }}>You are signed in as <strong>{user.role}</strong> ({user.name}); this page belongs to another role.</p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => navigate(`/${user.role}/dashboard`)}>Go to my dashboard</button>
                <button className="btn btn-outline" onClick={logout}><LogOut size={14} /> Sign out</button>
              </div>
            </div>
          ) : match ? match.render(match.params) : (
            <div className="card" style={{ maxWidth: 520, margin: '4rem auto', textAlign: 'center', padding: '2rem' }}>
              <h2 style={{ fontSize: '1.2rem' }}>Page not found</h2>
              <button className="btn btn-primary" onClick={() => navigate(`/${user.role}/dashboard`)}>Back to dashboard</button>
            </div>
          )}
        </ErrorBoundary>
      </AppShell>
      <ToastHost />
    </>
  );
}
