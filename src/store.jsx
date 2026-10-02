import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  authApi, auditApi, challengesApi, proposalsApi, pilotsApi, financeApi, adminApi, notificationsApi, publicApi,
  setAuthToken, clearAuthToken, setUnauthorizedHandler,
} from './api';

/* ════════════════════════════════════════════════════════════════════════════
   Normalisers — map real API rows to the UI models. No invented defaults:
   a missing value stays empty instead of being replaced by sample data.
   ════════════════════════════════════════════════════════════════════════════ */

const PAYMENT_SLA_DAYS = 15; // statutory processing window enforced by the server-side SLA monitor
const num = (v) => Number(v ?? 0);
const rupees = (paise) => Math.round(num(paise) / 100);
const day = (v) => (v ? String(v).slice(0, 10) : '');
const arr = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [v]; } catch { return [v]; } }
  return [];
};

const STATUS_LABEL = {
  DRAFT: 'Draft', PUBLISHED: 'Published', PROPOSALS_RECEIVED: 'Proposals Received', AI_EVALUATION: 'AI Evaluation',
  SHORTLISTED: 'Shortlisted', PILOT_ACTIVE: 'Active', COMPLETED: 'Completed', FINANCE_SUBMITTED: 'Finance Submitted',
  CLOSED: 'Closed', ARCHIVED: 'Archived',
  SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under Review', AI_EVALUATED: 'AI Evaluated', NOT_SHORTLISTED: 'Not Shortlisted',
  SELECTED: 'Selected for Pilot', REJECTED: 'Rejected',
  LAUNCHED: 'Active', IN_PROGRESS: 'Active', UNDER_INSPECTION: 'Under Review', VALIDATED: 'Validated',
  FINANCE_PENDING: 'Awaiting Finance', STALLED: 'Stalled', TERMINATED: 'Terminated',
  PENDING: 'Pending', VERIFIED: 'Verified', RETURNED: 'Returned', APPROVED: 'Approved', PAID: 'Paid',
  PAYMENT_PENDING: 'Payment Pending', VERIFICATION_PENDING: 'Verification Pending', FINANCE_REVIEW: 'Finance Review',
  ON_HOLD: 'On Hold', PROCESSING: 'Processing', DISPUTED: 'Disputed',
  DETECTED: 'Detected', INVESTIGATING: 'Investigating', RESOLVED: 'Resolved', DISMISSED: 'Dismissed',
};
// Any status without a hand-written label is shown as plain words ("CHEQUE_ISSUED" -> "Cheque issued"), never as a raw code.
const humanise = (s) => String(s).toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const statusLabel = (s) => (s ? STATUS_LABEL[String(s).toUpperCase()] || (/^[A-Z0-9_]+$/.test(String(s)) ? humanise(s) : String(s)) : '');

function normalizeChallenge(c) {
  const budgetPaise = num(c.budget_paise);
  return {
    id: c.id, title: c.title,
    department: c.department_name || '', departmentId: c.department_id || '',
    status: statusLabel(c.status), rawStatus: c.status,
    problemStatement: c.problem_statement || '', problemCategory: c.problem_category || '', category: c.problem_category || '',
    targetBeneficiaries: c.target_beneficiaries || '', desiredOutcome: c.desired_outcome || '',
    requiredCapabilities: arr(c.required_capabilities), constraints: c.constraints || '',
    pilotDurationMonths: c.pilot_duration_months || 3,
    budgetPaise, budgetRupees: rupees(budgetPaise), totalBudget: rupees(budgetPaise),
    proposalsCount: parseInt(c.proposal_count || 0, 10),
    createdDate: day(c.created_at), deadline: day(c.deadline),
    kpis: arr(c.kpis), evaluationCriteria: arr(c.evaluation_criteria), riskConsiderations: arr(c.risk_considerations),
    requiredDocuments: arr(c.required_documents),
  };
}

function normalizeProposal(p) {
  const evaluated = p.overall_score != null;
  return {
    id: p.id, challengeId: p.challenge_id, startupId: p.organization_id || '', startupName: p.startup_name || '',
    solutionTitle: p.solution_title || '', summary: p.problem_solution_fit || '',
    technicalApproach: p.technical_approach || '', deploymentPlan: p.deployment_plan || '',
    implementationTimeline: p.implementation_timeline || '',
    pilotCostPaise: num(p.pilot_cost_paise), scaleupCostPaise: num(p.scaleup_cost_paise),
    cost: rupees(p.pilot_cost_paise), scaleupCost: rupees(p.scaleup_cost_paise),
    status: statusLabel(p.status), rawStatus: p.status, submissionDate: day(p.submitted_at || p.created_at),
    aiScore: evaluated ? num(p.overall_score) : null,
    aiEvaluationStatus: evaluated || p.evaluation_summary ? 'Completed' : 'Pending',
    whyRecommended: arr(p.why_recommended || p.evaluation_summary?.why_recommended),
    concerns: arr(p.concerns || p.evaluation_summary?.concerns),
    isRecommendedTop3: !!p.is_recommended_top3,
    limitations: arr(p.limitations), aiModel: p.ai_model || '',
    scores: evaluated ? {
      alignment: num(p.problem_alignment_score), feasibility: num(p.technical_feasibility_score), impact: num(p.expected_impact_score),
      evidence: num(p.evidence_strength_score), readiness: num(p.deployment_readiness_score), cost: num(p.cost_feasibility_score), risk: num(p.risk_score),
    } : null,
    evidenceDeployments: arr(p.evidence_deployments), certifications: arr(p.certifications), documents: arr(p.documents),
    dataTrustTag: 'Startup Reported',
  };
}

const MILESTONE_UI = { PENDING: 'Pending', SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under Review', VERIFIED: 'Verified', APPROVED: 'Approved', PAYMENT_PENDING: 'Payment Pending', PAID: 'Paid', RETURNED: 'Returned' };

function normalizeMilestone(m, total = 0) {
  const amountPaise = num(m.amount_paise);
  return {
    id: m.id, pilotId: m.pilot_id, name: m.title, title: m.title,
    deliverable: m.deliverable_description || '', deliverableDescription: m.deliverable_description || '',
    dueDate: day(m.due_date), amountPaise, amount: rupees(amountPaise), paymentAmount: rupees(amountPaise),
    tranche: total ? Math.round((amountPaise / total) * 100) : 0,
    status: MILESTONE_UI[m.status] || statusLabel(m.status), rawStatus: m.status,
    paidDate: day(m.paid_at), submittedAt: day(m.submitted_at), verifiedAt: day(m.verified_at),
  };
}

const KPI_UI = { VERIFIED: 'Verified', PARTIALLY_VERIFIED: 'Partially Verified', REJECTED: 'Not Verified', REQUIRES_EVIDENCE: 'Needs Evidence', PENDING: 'Under Review' };

function normalizeKpi(k) {
  const lv = k.latest_verification;
  return {
    id: k.id, metric: k.name, name: k.name, unit: k.unit || '', baseline: k.baseline_value, target: k.target_value,
    current: k.current_value, measurementMethod: k.measurement_method || '',
    status: lv ? KPI_UI[lv] || lv : k.latest_reported ? 'Under Review' : 'No Evidence', rawStatus: k.status,
    verifiedByInspector: lv === 'VERIFIED', hasEvidence: !!k.latest_reported,
    version: k.latest_version ? `v${k.latest_version}` : '—',
  };
}

function normalizePilotDetail(base, detail, deptName) {
  const p = detail?.pilot || base;
  const milestones = (detail?.milestones || []).map((m) => normalizeMilestone(m, num(p.contract_value_paise)));
  const done = milestones.filter((m) => ['Verified', 'Approved', 'Payment Pending', 'Paid'].includes(m.status)).length;
  const insp = (detail?.inspections || [])[0];
  return {
    id: p.id, name: p.name, pilotName: p.name, title: p.name,
    challengeId: p.challenge_id, proposalId: p.proposal_id, startupId: p.organization_id, startupName: p.startup_name,
    department: deptName || '', departmentId: p.department_id,
    contractValuePaise: num(p.contract_value_paise), totalBudget: rupees(p.contract_value_paise),
    fundsDisbursedPaise: 0, fundsDisbursed: 0,
    startDate: day(p.launch_date), endDate: day(p.completion_date) || (p.launch_date && p.duration_months
      ? day(new Date(new Date(p.launch_date).getTime() + p.duration_months * 30.4375 * 864e5).toISOString()) : ''),
    durationMonths: p.duration_months,
    progress: milestones.length ? Math.round((done / milestones.length) * 100) : 0,
    status: statusLabel(p.status), rawStatus: p.status,
    financeStatus: p.status === 'FINANCE_PENDING' ? 'Awaiting Finance Review' : 'Active',
    assignedInspectorId: p.assigned_inspector_id || null, assignedInspectorName: p.assigned_inspector_name || '',
    location: p.location || '', baselineSummary: p.baseline_summary || '', targetOutcome: p.target_outcome || '',
    milestones, kpiResults: (detail?.kpis || []).map(normalizeKpi),
    inspections: detail?.inspections || [],
    validationReport: insp ? {
      inspectorName: p.assigned_inspector_name || '', date: day(insp.completed_date || insp.created_at),
      status: statusLabel(insp.validation_status), rawStatus: insp.validation_status,
      summary: insp.findings || '', checklistResults: insp.checklist_results || {},
    } : null,
    risks: (detail?.risks || []).map((r) => ({ id: r.id, category: r.category, description: r.description, severity: statusLabel(r.severity), status: statusLabel(r.status), mitigation: r.mitigation || '', owner: r.owner || '' })),
  };
}

function normalizePayment(p) {
  const gross = num(p.gross_amount_paise);
  return {
    id: p.id, claimNumber: p.id, pilotId: p.pilot_id, pilotTitle: p.pilot_name || '', milestoneId: p.milestone_id,
    milestoneTitle: p.milestone_title || '', startupId: p.organization_id, startupName: p.startup_name || '',
    department: p.department_name || '', departmentId: p.department_id, invoiceNumber: p.invoice_number || '',
    invoiceDate: day(p.invoice_date),
    grossAmountPaise: gross, netPayablePaise: num(p.net_payable_paise), tdsPaise: num(p.tds_paise), gstTdsPaise: num(p.gst_paise),
    penaltyPaise: num(p.penalty_deduction_paise),
    grossAmount: rupees(gross), netPayable: rupees(p.net_payable_paise), tdsDeduction: rupees(p.tds_paise), gstTdsDeduction: rupees(p.gst_paise),
    status: statusLabel(p.status), rawStatus: p.status, holdReason: p.hold_reason || '',
    requesterId: p.requester_user_id, firstReviewerId: p.first_reviewer_user_id || null, approverId: p.approver_user_id || null, date: day(p.created_at),
    paymentMethod: p.payment_method || null, chequeNumber: p.cheque_number || '', chequeDate: p.cheque_day || '', draweeBank: p.drawee_bank || '', signatories: p.cheque_signatories || '',
    chequeHistory: Array.isArray(p.cheque_history) ? p.cheque_history : [],
    paidDate: day(p.disbursed_at), disbursementReference: p.disbursement_reference || '',
    demoTransactionId: p.disbursement_reference || null,
    slaDaysRemaining: ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_PENDING', 'FINANCE_REVIEW', 'AWAITING_SECOND_APPROVAL', 'APPROVED', 'CHEQUE_ISSUED'].includes(p.status)
      ? PAYMENT_SLA_DAYS - Math.floor((Date.now() - new Date(p.created_at).getTime()) / 864e5) : null,
    timeline: [
      { time: String(p.created_at || '').slice(0, 16).replace('T', ' '), actor: p.startup_name || 'Startup', action: `Claim ${p.invoice_number} submitted` },
      ...(p.hold_reason ? [{ time: String(p.updated_at || '').slice(0, 16).replace('T', ' '), actor: 'Finance', action: `${statusLabel(p.status)}: ${p.hold_reason}` }] : []),
      ...(p.first_reviewer_user_id ? [{ time: String(p.updated_at || '').slice(0, 16).replace('T', ' '), actor: 'Finance', action: 'First approval recorded (two-person rule)' }] : []),
      ...(p.approver_user_id && !p.disbursed_at ? [{ time: String(p.updated_at || '').slice(0, 16).replace('T', ' '), actor: 'Finance', action: 'Approved (maker-checker satisfied)' }] : []),
      ...(p.cheque_number ? [{ time: String(p.cheque_issued_at || p.updated_at || '').slice(0, 16).replace('T', ' '), actor: 'Finance', action: `Cheque ${p.cheque_number} (${p.drawee_bank}) issued` }] : []),
      ...(p.disbursed_at ? [{ time: String(p.disbursed_at).slice(0, 16).replace('T', ' '), actor: 'Finance', action: p.payment_method === 'CHEQUE' ? `Cheque cleared — ${p.disbursement_reference}` : `Disbursed — bank reference ${p.disbursement_reference}` }] : []),
    ],
  };
}

function normalizeDepartment(d) {
  return {
    id: d.id, name: d.name, code: d.code, ministry: d.ministry || d.name, description: d.description || '', isActive: d.is_active !== false,
    budgetAllocatedPaise: num(d.budget_allocated_paise), budgetCommittedPaise: num(d.budget_committed_paise), budgetDisbursedPaise: num(d.budget_disbursed_paise),
    chequesInTransitPaise: num(d.cheques_in_transit_paise), budgetAllocated: rupees(d.budget_allocated_paise), budgetCommitted: rupees(d.budget_committed_paise), budgetDisbursed: rupees(d.budget_disbursed_paise),
  };
}

const initials = (name) => (name || '?').split(/\s+/).map((n) => n[0]).join('').slice(0, 2).toUpperCase();

function normalizeUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, title: u.designation || '',
    department: u.department_name || u.organization_name || '', avatar: initials(u.name),
    status: u.is_active === false ? 'Inactive' : 'Active', isActive: u.is_active !== false, mfaEnabled: !!u.mfa_enabled,
    departmentId: u.department_id || null, createdAt: day(u.created_at), provider: u.auth_provider || 'password',
  };
}

function normalizeStartup(s) {
  return {
    id: s.id, name: s.name, dpiitReg: s.dpiit_number || '', sector: s.sector || '', founders: s.founder_name || '',
    founderEmail: s.founder_email || '', phone: s.founder_phone || '', website: s.website || '', cin: s.cin_llpin || '',
    pan: s.pan || '', gstin: s.gstin || '', stage: s.stage || '',
    bankDetails: { accountName: s.name, accountMasked: s.bank_account_masked || '', ifsc: s.ifsc_code || '', verified: s.verification_status === 'VERIFIED' },
    verificationStatus: s.verification_status, verificationNotes: s.verification_notes || '', verifiedAt: day(s.verified_at),
    showcaseOptIn: !!s.showcase_opt_in, showcaseSummary: s.showcase_summary || '',
    createdAt: day(s.created_at),
  };
}

function normalizeAuditLog(l) {
  return {
    id: l.id, user: l.actor_name || '', role: l.actor_role || '', action: l.action, entity: l.entity_id || l.entity_type,
    entityType: l.entity_type, timestamp: String(l.timestamp || '').slice(0, 19).replace('T', ' '),
    details: typeof l.details === 'object' ? JSON.stringify(l.details) : String(l.details || ''), ipAddress: l.ip_address || '', entryHash: l.hash,
  };
}

function normalizeAnomaly(a) {
  return {
    id: a.id, claimId: a.claim_id, type: a.anomaly_type, severity: a.severity, pilotId: a.pilot_id, description: a.description,
    status: statusLabel(a.status), rawStatus: a.status, resolutionNotes: a.resolution_notes || '', date: day(a.created_at),
  };
}

function normalizeStalled(sp) {
  return {
    id: sp.id, pilotId: sp.pilot_id, pilotName: sp.pilot_name || sp.pilot_id, startup: sp.startup_name || '',
    reason: sp.stall_reason || '', stalledDate: day(sp.stalled_date),
    daysStalled: sp.stalled_date ? Math.max(0, Math.floor((Date.now() - new Date(sp.stalled_date).getTime()) / 864e5)) : 0,
    amountPaidPaise: num(sp.amount_paid_paise), amountCommittedPaise: num(sp.amount_committed_paise),
    amountRecoverablePaise: num(sp.amount_recoverable_paise), amountRecoveredPaise: num(sp.amount_recovered_paise),
    actionTaken: sp.action_taken, recoveryStatus: statusLabel(sp.status) || sp.status,
  };
}

function normalizeNotification(n) {
  return { id: n.id, title: n.title, message: n.message, priority: n.priority, link: n.action_link || null, read: !!n.is_read, timestamp: String(n.created_at || '').slice(0, 16).replace('T', ' ') };
}

/* ════════════════════════════════════════════════════════════════════════════
   Theme: three named themes x light/dark, remembered per browser
   ════════════════════════════════════════════════════════════════════════════ */

const ThemeContext = createContext(null);
export const THEMES = [['graphite', 'Graphite'], ['burst', 'Burst'], ['meadow', 'Meadow']];

export function ThemeProvider({ children }) {
  const read = (k, ok, fallback) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : fallback; } catch { return fallback; } };
  const systemMode = () => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [theme, setThemeState] = useState(() => read('s2s_theme', ['graphite', 'burst', 'meadow'], 'graphite'));
  const [mode, setModeState] = useState(() => read('s2s_mode', ['light', 'dark'], 'light'));
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-mode', mode);
    try { localStorage.setItem('s2s_theme', theme); localStorage.setItem('s2s_mode', mode); } catch { /* private mode */ }
  }, [theme, mode]);
  const value = useMemo(() => ({ theme, mode, setTheme: setThemeState, setMode: setModeState, toggleMode: () => setModeState((m) => (m === 'dark' ? 'light' : 'dark')) }), [theme, mode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

/* ════════════════════════════════════════════════════════════════════════════
   Auth
   ════════════════════════════════════════════════════════════════════════════ */

const AuthContext = createContext(null);
const TOKEN_KEY = 's2s_auth_token';

function shapeUser(u) {
  if (!u) return null;
  return {
    ...u,
    department_id: u.department_id ?? u.departmentId ?? null, departmentId: u.departmentId ?? u.department_id ?? null,
    organization_id: u.organization_id ?? u.organizationId ?? null, organizationId: u.organizationId ?? u.organization_id ?? null,
    mustChangePassword: !!(u.mustChangePassword ?? u.must_change_password),
    mfaEnabled: !!(u.mfaEnabled ?? u.mfa_enabled),
    status: u.status || 'ACTIVE',
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState(null);
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [config, setConfig] = useState({ googleClientId: null, githubEnabled: false, emailEnabled: false, aiMode: 'local' });

  const clearSession = useCallback(() => {
    setUser(null); clearAuthToken(); sessionStorage.removeItem(TOKEN_KEY); setMfaChallenge(null);
  }, []);

  useEffect(() => { setUnauthorizedHandler(() => clearSession()); }, [clearSession]);

  useEffect(() => {
    let alive = true;
    authApi.config().then((c) => alive && setConfig(c)).catch(() => {});
    // The GitHub redirect hands back either an MFA challenge (#mfa=…) or a reason it failed (?error=…)
    try {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const params = new URLSearchParams(window.location.search);
      const messages = {
        github_state: 'The GitHub sign-in expired or was interrupted. Please try again.',
        github_denied: 'GitHub sign-in was cancelled.',
        github_failed: 'GitHub did not complete the sign-in. Please try again.',
        github_not_configured: 'GitHub sign-in is not set up on this server yet.',
        github_startup_only: 'GitHub sign-in is available to startups only. Use Google or your password for this account.',
        no_verified_email: 'That account has no verified email address. Verify one with the provider, or sign in another way.',
        auth_failed: 'We could not sign you in with that account.',
      };
      if (hash.get('mfa')) { setMfaChallenge({ tempToken: hash.get('mfa'), message: 'Enter your 6-digit authenticator code' }); window.history.replaceState({}, '', '/login'); }
      else if (params.get('error')) { setLoginError(messages[params.get('error')] || 'Sign-in failed. Please try again.'); window.history.replaceState({}, '', '/login'); }
    } catch { /* ignore malformed URLs */ }
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved) setAuthToken(saved);
    authApi.me()
      .then((d) => alive && setUser(shapeUser(d.user)))
      .catch(() => { if (alive) { sessionStorage.removeItem(TOKEN_KEY); clearAuthToken(); } })
      .finally(() => alive && setIsLoading(false));
    return () => { alive = false; };
  }, []);

  const finishLogin = useCallback((result) => {
    if (result.requireMfa) {
      setMfaChallenge({ tempToken: result.tempToken, message: result.message });
      return { requireMfa: true };
    }
    setAuthToken(result.token);
    sessionStorage.setItem(TOKEN_KEY, result.token);
    setUser(shapeUser(result.user));
    return { success: true, user: result.user, isNewAccount: !!result.isNewAccount };
  }, []);

  const login = useCallback(async (email, password, role) => {
    setLoginError(null); setMfaChallenge(null);
    try { return finishLogin(await authApi.login(email, password, role)); }
    catch (e) { setLoginError(e.message); return { error: e.message, code: e.code }; }
  }, [finishLogin]);

  const loginWithGoogle = useCallback(async (credential, role) => {
    setLoginError(null); setMfaChallenge(null);
    try {
      const r = await authApi.google(credential, role);
      if (r.needsOnboarding) return { needsOnboarding: true };
      return finishLogin(r);
    }
    catch (e) { setLoginError(e.message); return { error: e.message, code: e.code }; }
  }, [finishLogin]);

  const completeOnboarding = useCallback(async (payload) => {
    setLoginError(null);
    const r = await authApi.onboarding(payload); // throws ApiError with the server's message
    return finishLogin(r);
  }, [finishLogin]);

  const verifyMfa = useCallback(async (code) => {
    if (!mfaChallenge) return { error: 'No MFA challenge active' };
    setLoginError(null);
    try {
      const r = await authApi.verifyMfa(mfaChallenge.tempToken, code);
      setAuthToken(r.token); sessionStorage.setItem(TOKEN_KEY, r.token); setUser(shapeUser(r.user)); setMfaChallenge(null);
      return { success: true };
    } catch (e) { setLoginError(e.message); return { error: e.message }; }
  }, [mfaChallenge]);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* session may already be gone */ }
    clearSession();
    window.history.pushState({}, '', '/');
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    try { const d = await authApi.me(); setUser(shapeUser(d.user)); return d.user; } catch { return null; }
  }, []);

  const value = useMemo(() => ({
    user, isAuthenticated: !!user, isLoading, loginError, mfaChallenge, config,
    login, loginWithGoogle, completeOnboarding, verifyMfa, logout, refreshUser, setLoginError,
    cancelMfa: () => setMfaChallenge(null),
  }), [user, isLoading, loginError, mfaChallenge, config, login, loginWithGoogle, completeOnboarding, verifyMfa, logout, refreshUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/* ════════════════════════════════════════════════════════════════════════════
   App state: routing, toasts, live data, actions
   ════════════════════════════════════════════════════════════════════════════ */

const AppContext = createContext(null);

const EMPTY = {
  challenges: [], proposals: [], pilots: [], payments: [], anomalies: [], stalledPilots: [], departments: [],
  users: [], startups: [], auditLogs: [], notifications: [], accessRequests: [], myOrganization: null, settings: null, loaded: false,
};

export function AppProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const [state, setState] = useState(EMPTY);
  const [currentRoute, setCurrentRoute] = useState(() => window.location.pathname || '/');
  const [search, setSearch] = useState(() => window.location.search || '');
  const [toasts, setToasts] = useState([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [assistantContext, setAssistantContext] = useState(null);
  const departmentsRef = useRef([]);

  useEffect(() => {
    const onPop = () => { setCurrentRoute(window.location.pathname || '/'); setSearch(window.location.search || ''); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Routes may carry a query string (e.g. /startup/proposals/create?challenge=CH-1); the path alone drives routing
  const navigate = useCallback((route) => {
    const url = new URL(route, window.location.origin);
    if (window.location.pathname + window.location.search !== url.pathname + url.search) window.history.pushState({}, '', url.pathname + url.search);
    setCurrentRoute(url.pathname);
    setSearch(url.search);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const query = useMemo(() => new URLSearchParams(search), [search]);

  /* toasts ─ the single place errors/successes are surfaced to the user */
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useMemo(() => {
    const push = (type, message, ms) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((t) => [...t.slice(-3), { id, type, message }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms ?? (type === 'error' ? 7000 : 4000));
    };
    return { success: (m) => push('success', m), error: (m) => push('error', m), info: (m) => push('info', m) };
  }, []);

  const currentRole = user?.role || null;
  const currentUser = useMemo(() => (user ? normalizeUser({ ...user, designation: user.designation, department_name: user.department_name, organization_name: user.organization_name }) : null), [user]);

  /* live data — only calls endpoints the role may use (no 403 noise) */
  const fetchLiveData = useCallback(async () => {
    if (!isAuthenticated || !user) return;
    const role = user.role;
    const safe = (p) => p.catch(() => null);
    if (user.status && user.status !== 'ACTIVE') { setState({ ...EMPTY, loaded: true }); return; }
    if (role === 'investor') {
      const n = await safe(notificationsApi.list());
      setState((prev) => ({ ...prev, notifications: (n?.notifications || []).map(normalizeNotification), loaded: true }));
      return;
    }
    const [chRes, notifRes, deptPublic] = await Promise.all([
      safe(challengesApi.list({ limit: '100' })), safe(notificationsApi.list()), safe(publicApi.departments()),
    ]);
    const canSeeProposals = ['government', 'startup', 'admin'].includes(role);
    const canSeePilots = true;
    const canSeePayments = ['finance', 'startup', 'admin', 'government'].includes(role);
    const [propRes, pilotRes, payRes] = await Promise.all([
      canSeeProposals ? safe(proposalsApi.list()) : null,
      canSeePilots ? safe(pilotsApi.list()) : null,
      canSeePayments ? safe(financeApi.payments()) : null,
    ]);
    let anomRes = null, stalledRes = null, budgetRes = null, usersRes = null, startupsRes = null, auditRes = null, deptAdmin = null, settingsRes = null, orgRes = null;
    if (role === 'finance' || role === 'admin') [anomRes, stalledRes, budgetRes] = await Promise.all([safe(financeApi.anomalies()), safe(financeApi.stalled()), safe(financeApi.budget())]);
    if (role === 'admin') [usersRes, startupsRes, auditRes, deptAdmin, settingsRes] = await Promise.all([safe(adminApi.users()), safe(adminApi.startups()), safe(adminApi.auditLogs({ limit: '50' })), safe(adminApi.departments()), safe(adminApi.settings())]);
    let accessRes = null;
    if (role === 'admin') accessRes = await safe(adminApi.accessRequests('PENDING'));
    if (role === 'startup') orgRes = await safe(authApi.organization());
    if (role === 'government') auditRes = await safe(auditApi.mine());

    const departments = (deptAdmin?.departments || budgetRes?.departments || deptPublic?.departments || []).map(normalizeDepartment);
    departmentsRef.current = departments;
    const deptName = (id) => departments.find((d) => d.id === id)?.name || '';

    const basePilots = pilotRes?.data || [];
    const details = await Promise.all(basePilots.slice(0, 60).map((p) => safe(pilotsApi.get(p.id))));
    const pilots = basePilots.slice(0, 60).map((p, i) => normalizePilotDetail(p, details[i], deptName(p.department_id)));
    const paid = (payRes?.data || []).filter((p) => p.status === 'PAID');
    for (const pl of pilots) {
      const sum = paid.filter((p) => p.pilot_id === pl.id).reduce((a, p) => a + num(p.net_payable_paise), 0);
      pl.fundsDisbursedPaise = sum; pl.fundsDisbursed = rupees(sum);
    }

    setState((prev) => ({
      ...prev,
      challenges: (chRes?.data || chRes?.challenges || []).map(normalizeChallenge),
      proposals: (propRes?.data || []).map(normalizeProposal),
      pilots,
      payments: (payRes?.data || []).map(normalizePayment),
      anomalies: (anomRes?.anomalies || []).map(normalizeAnomaly),
      stalledPilots: (stalledRes?.stalledPilots || []).map(normalizeStalled),
      departments,
      users: (usersRes?.users || []).map(normalizeUser),
      startups: role === 'startup'
        ? [orgRes?.organization ? normalizeStartup(orgRes.organization) : normalizeStartup({ id: user.organization_id, name: user.organization_name || 'Your startup', dpiit_number: user.dpiit_number, verification_status: user.verification_status })]
        : (startupsRes?.startups || []).map(normalizeStartup),
      auditLogs: (auditRes?.logs || []).map(normalizeAuditLog),
      notifications: (notifRes?.notifications || []).map(normalizeNotification),
      accessRequests: accessRes?.requests || [],
      budgetAsOf: budgetRes?.asOf || null,
      myOrganization: orgRes?.organization ? normalizeStartup(orgRes.organization) : null,
      settings: settingsRes?.settings || null,
      auditIntegrity: auditRes?.integrity || null,
      loaded: true,
    }));
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (!isAuthenticated) { setState(EMPTY); return undefined; }
    fetchLiveData();
    const t = setInterval(() => { if (document.visibilityState === 'visible') fetchLiveData(); }, 45000);
    return () => clearInterval(t);
  }, [isAuthenticated, fetchLiveData]);

  /** Runs an API action: shows the real server error as a toast and re-throws so callers don't continue on failure. */
  const act = useCallback(async (fn, successMessage) => {
    try {
      const res = await fn();
      if (successMessage) toast.success(typeof successMessage === 'function' ? successMessage(res) : successMessage);
      await fetchLiveData();
      return res;
    } catch (e) {
      toast.error(e.message || 'Something went wrong');
      throw e;
    }
  }, [fetchLiveData, toast]);

  /* ── Government ───────────────────────────────────────────────────────── */
  const createChallenge = (d) => act(async () => {
    const deadline = d.deadline || new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const res = await challengesApi.create({
      title: d.title,
      departmentId: d.departmentId || user.department_id,
      problemStatement: d.problemStatement,
      problemCategory: d.category || d.problemCategory || 'General',
      targetBeneficiaries: d.targetBeneficiaries || undefined,
      desiredOutcome: d.desiredOutcome,
      requiredCapabilities: d.requiredCapabilities || [],
      constraints: d.constraints || undefined,
      pilotDurationMonths: parseInt(d.pilotDurationMonths || '3', 10),
      budgetPaise: Math.round(parseFloat(d.totalBudget || d.budgetRupees || '0') * 100),
      kpis: (d.kpis || []).map((k) => ({ name: k.name || k.metric, baseline: String(k.baseline ?? ''), target: String(k.target ?? ''), unit: k.unit, measurementMethod: k.measurementMethod || k.measurement_method })),
      evaluationCriteria: d.evaluationCriteria || [],
      requiredDocuments: d.requiredDocuments || [],
      riskConsiderations: d.riskConsiderations || [],
      deadline,
    });
    return res.challengeId;
  }, 'Draft saved');

  const publishChallenge = (id) => act(() => challengesApi.publish(id), 'Challenge published to the startup ecosystem');
  const closeChallenge = (id) => act(() => challengesApi.close(id), 'Challenge closed to new proposals');

  const evaluateProposalsAI = (challengeId) => act(async () => {
    const targets = state.proposals.filter((p) => p.challengeId === challengeId && ['SUBMITTED', 'UNDER_REVIEW', 'AI_EVALUATED'].includes(p.rawStatus));
    if (targets.length === 0) throw new Error('There are no submitted proposals to evaluate for this challenge.');
    for (const p of targets) await proposalsApi.evaluate(p.id);
    return targets.length;
  }, (n) => `Advisory evaluation completed for ${n} proposal(s)`);

  const approveShortlist = (challengeId, startupId, remarks) => act(async () => {
    const prop = state.proposals.find((p) => p.challengeId === challengeId && p.startupId === startupId);
    if (!prop) throw new Error('Proposal not found for the selected startup.');
    if (!remarks || remarks.trim().length < 10) throw new Error('Enter a written justification of at least 10 characters.');
    return proposalsApi.select(prop.id, remarks.trim());
  }, (r) => `Startup selected. Pilot ${r.pilotId} created.`);

  const assignInspector = (pilotId, inspectorId) => act(() => pilotsApi.assignInspector(pilotId, inspectorId), 'Inspector assigned');
  const forwardPilotToFinance = (pilotId) => act(() => pilotsApi.forwardToFinance(pilotId), 'Dossier forwarded to Finance');

  /* ── Startup ──────────────────────────────────────────────────────────── */
  const submitProposal = (d) => act(async () => {
    const res = await proposalsApi.create({
      challengeId: d.challengeId, solutionTitle: d.solutionTitle,
      problemSolutionFit: d.summary || d.problemSolutionFit, technicalApproach: d.technicalApproach,
      deploymentPlan: d.deploymentPlan, implementationTimeline: d.timeline || d.implementationTimeline,
      pilotCostPaise: Math.round(parseFloat(d.cost) * 100), scaleupCostPaise: Math.round(parseFloat(d.scaleupCost) * 100),
      evidenceDeployments: d.evidenceDeployments || [], certifications: d.certifications || [], documents: d.documents || [],
    });
    return res.proposalId;
  }, 'Proposal submitted');

  const submitKpiEvidence = (pilotId, kpiId, value, source, notes) => act(
    () => pilotsApi.submitKpi(pilotId, kpiId, { reportedValue: String(value), evidenceNotes: [source, notes].filter(Boolean).join(' — ') || 'Evidence submitted by startup' }),
    (r) => `KPI evidence v${r.versionNumber} recorded`);
  const submitMilestone = (pilotId, msId, notes) => act(() => pilotsApi.submitMilestone(pilotId, msId, notes), 'Milestone submitted for verification');
  const submitClaim = (d) => act(() => financeApi.submitClaim({
    pilotId: d.pilotId, milestoneId: d.milestoneId, invoiceNumber: d.invoiceNumber, invoiceDate: d.invoiceDate,
    grossAmountPaise: Math.round(parseFloat(d.grossRupees) * 100),
  }), 'Payment claim submitted. Statutory deductions were calculated.');

  /* ── Inspector ────────────────────────────────────────────────────────── */
  const KPI_VERDICT = { Verified: 'VERIFIED', 'Partially Verified': 'PARTIALLY_VERIFIED', 'Needs Evidence': 'REQUIRES_EVIDENCE', 'Requires Evidence': 'REQUIRES_EVIDENCE' };
  const verifyKpiEvidence = (pilotId, kpiId, verdict, notes) => act(
    () => pilotsApi.verifyKpi(pilotId, kpiId, { verificationStatus: KPI_VERDICT[verdict] || 'REJECTED', inspectorNotes: notes || 'Reviewed on site' }), 'KPI verdict recorded');
  const verifyMilestone = (pilotId, msId, decision, notes) => act(() => pilotsApi.verifyMilestone(pilotId, msId, decision, notes), decision === 'VERIFIED' ? 'Milestone verified' : 'Milestone returned');

  const INSPECTION_VERDICT = { Verified: 'VERIFIED', 'Partially Verified': 'PARTIALLY_VERIFIED', 'Requires Further Evidence': 'REQUIRES_FURTHER_EVIDENCE', 'Not Verified': 'NOT_VERIFIED' };
  const submitInspectionReport = (pilotId, checklist, verdict, findings, extra = {}) => act(() => pilotsApi.inspect(pilotId, {
    checklistResults: Object.fromEntries(Object.entries(checklist || {}).map(([k, v]) => [k, v === true ? 'PASS' : v === false ? 'FAIL' : v || 'NEEDS_REVIEW'])),
    findings: findings || '', validationStatus: INSPECTION_VERDICT[verdict] || verdict || 'NOT_VERIFIED', ...extra,
  }), 'Inspection docket filed');

  /* ── Finance ──────────────────────────────────────────────────────────── */
  const approvePayment = (id, remarks) => act(() => financeApi.approve(id, remarks), 'Claim approved. Record the bank reference once the transfer is made.');
  const recordCheque = (id, d) => act(() => financeApi.issueCheque(id, d), 'Cheque recorded. It counts as paid once it clears.');
  const clearCheque = (id, date) => act(() => financeApi.clearCheque(id, date), 'Cheque cleared. Payment recorded as paid.');
  const bounceCheque = (id, reason) => act(() => financeApi.bounceCheque(id, reason), 'Cheque marked as returned. The claim is approved again.');
  const recordDisbursement = (id, utr) => act(() => financeApi.disburse(id, utr), 'Disbursement recorded');
  const putPaymentOnHold = (id, reason) => act(() => financeApi.hold(id, reason), 'Claim placed on hold');
  const rejectPayment = (id, reason) => act(() => financeApi.reject(id, reason), 'Claim rejected');
  const resolveAnomaly = (id, notes) => act(() => financeApi.resolveAnomaly(id, notes), 'Anomaly resolved');

  /* ── Notifications ────────────────────────────────────────────────────── */
  const markNotificationRead = async (id) => {
    setState((s) => ({ ...s, notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
    try { await notificationsApi.markRead(id); } catch { /* next poll will reconcile */ }
  };
  const markAllNotificationsRead = async () => {
    setState((s) => ({ ...s, notifications: s.notifications.map((n) => ({ ...n, read: true })) }));
    try { await notificationsApi.markAllRead(); } catch { /* next poll will reconcile */ }
  };

  /* ── Assistant ────────────────────────────────────────────────────────── */
  const openAssistant = (context = null) => { setAssistantContext(context); setIsAssistantOpen(true); };
  const closeAssistant = () => setIsAssistantOpen(false);

  // A startup user always has an organisation object (a stub from the session until the profile loads)
  const viewState = useMemo(() => {
    if (user?.role === 'startup' && state.startups.length === 0) {
      return { ...state, startups: [normalizeStartup({ id: user.organization_id || '', name: user.organization_name || 'Your startup', dpiit_number: user.dpiit_number, verification_status: user.verification_status })] };
    }
    return state;
  }, [state, user]);

  const value = {
    state: viewState, currentRole, currentUser, currentRoute, query, navigate, fetchLiveData, act, toast, toasts, dismissToast,
    createChallenge, publishChallenge, closeChallenge, evaluateProposalsAI, approveShortlist, assignInspector, forwardPilotToFinance,
    submitProposal, submitKpiEvidence, submitMilestone, submitClaim,
    verifyKpiEvidence, verifyMilestone, submitInspectionReport,
    approvePayment, recordCheque, clearCheque, bounceCheque, recordDisbursement, putPaymentOnHold, rejectPayment, resolveAnomaly,
    markNotificationRead, markAllNotificationsRead,
    isSearchOpen, setIsSearchOpen,
    isAssistantOpen, openAssistant, closeAssistant, assistantContext,
    // legacy names kept so older call-sites keep working
    isCopilotOpen: isAssistantOpen, openCopilot: openAssistant, closeCopilot: closeAssistant, copilotContext: assistantContext,
    logAudit: () => {}, addNotification: () => {},
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}


export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within an AppProvider');
  return ctx;
}

/** The brand intro plays on every normal page load (visitors can skip it).
 *  It is skipped on pages that continue a task in progress: finishing a sign-up, a password-reset link, or coming back from GitHub with a message. */
export function shouldShowIntro() {
  try {
    const { pathname, search, hash } = window.location;
    if (pathname === '/signup' || pathname === '/reset-password') return false;
    if (/[?&]error=/.test(search) || /mfa=/.test(hash)) return false;
  } catch { /* no window */ }
  return true;
}
