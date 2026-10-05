/**
 * Startup2Sarkar API client — one fetch wrapper, httpOnly-cookie session + Bearer fallback.
 * Errors are thrown as ApiError so callers (and the global toast) can show the real server message.
 */
const API_BASE = '/api/v1';
let authToken = null;
let onUnauthorized = null;

export const setAuthToken = (t) => { authToken = t; };
export const clearAuthToken = () => { authToken = null; };
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `Request failed (${status})`);
    this.status = status;
    this.code = data?.code || 'UNKNOWN';
    this.details = data?.details || null;
  }
}

async function request(method, path, body = null, options = {}) {
  const headers = { Accept: 'application/json', ...options.headers };
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let res;
  try {
    res = await fetch(path.startsWith('http') ? path : `${API_BASE}${path}`, {
      method, headers, credentials: 'include', signal: options.signal,
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: 'Cannot reach the server. Check your connection and try again.', code: 'NETWORK' });
  }

  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) {
    if (!res.ok) throw new ApiError(res.status, { error: res.statusText });
    return options.raw ? res : res.text();
  }
  const data = await res.json();
  if (!res.ok) {
    // A dead session anywhere in the app logs the user out cleanly (login/MFA calls handle their own 401s)
    if (res.status === 401 && onUnauthorized && !path.startsWith('/auth/login') && !path.startsWith('/auth/google') && !path.startsWith('/auth/mfa/verify')) onUnauthorized();
    throw new ApiError(res.status, data);
  }
  return data;
}

const qs = (p) => (p && Object.keys(p).length ? '?' + new URLSearchParams(p).toString() : '');
export const api = {
  get: (p, o) => request('GET', p, null, o),
  post: (p, b, o) => request('POST', p, b, o),
  put: (p, b, o) => request('PUT', p, b, o),
  del: (p, o) => request('DELETE', p, null, o),
};

export const authApi = {
  config: () => api.get('/public/config'),
  login: (email, password, role) => api.post('/auth/login', { email, password, role }),
  google: (credential, role) => api.post('/auth/google', role ? { credential, role } : { credential }),
  verifyMfa: (tempToken, code) => api.post('/auth/mfa/verify', { tempToken, code }),
  setupMfa: () => api.post('/auth/mfa/setup'),
  enableMfa: (code) => api.post('/auth/mfa/enable', { code }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  logoutAll: () => api.post('/auth/logout-all'),
  sessions: () => api.get('/auth/sessions'),
  registerStartup: (d) => api.post('/auth/register-startup', d),
  organization: () => api.get('/auth/organization'),
  updateOrganization: (d) => api.put('/auth/organization', d),
  githubLoginUrl: '/api/v1/auth/github/login',
  linkGithub: () => api.post('/auth/github/link-url'),
  linkGoogle: (credential) => api.post('/auth/google/link', { credential }),
  identities: () => api.get('/auth/identities'),
  unlink: (provider) => api.del(`/auth/identities/${provider}`),
  onboardingPrefill: () => api.get('/auth/onboarding'),
  onboarding: (d) => api.post('/auth/onboarding', d),
  accessRequest: () => api.get('/auth/access-request'),
  profileLinks: () => api.get('/auth/profile-links'),
  saveProfileLinks: (links) => api.put('/auth/profile-links', { links }),
  skipMfa: () => api.post('/auth/mfa/skip'),
  joinInfo: (token) => api.get(`/auth/join-info?token=${encodeURIComponent(token)}`),
  join: (d) => api.post('/auth/join', d),
  forgotPassword: (email, captchaToken) => api.post('/auth/forgot-password', { email, captchaToken }),
  signupEmail: (d) => api.post('/auth/signup-email', d),
  resetPassword: (token, password) => api.post('/auth/reset-password', { token, password }),
  changePassword: (currentPassword, newPassword) => api.post('/auth/change-password', { currentPassword, newPassword }),
};

export const challengesApi = {
  list: (p) => api.get(`/challenges${qs(p)}`),
  get: (id) => api.get(`/challenges/${id}`),
  create: (d) => api.post('/challenges', d),
  close: (id) => api.post(`/challenges/${id}/close`),
  publish: (id) => api.post(`/challenges/${id}/publish`),
  generateAi: (problemDescription) => api.post('/challenges/ai-generate', { problemDescription }),
};

export const proposalsApi = {
  list: (p) => api.get(`/proposals${qs(p)}`),
  create: (d) => api.post('/proposals', d),
  evaluate: (id) => api.post(`/proposals/${id}/ai-evaluate`),
  select: (id, remarks) => api.post(`/proposals/${id}/select`, { remarks }),
};

export const pilotsApi = {
  list: (p) => api.get(`/pilots${qs(p)}`),
  get: (id) => api.get(`/pilots/${id}`),
  inspectors: () => api.get('/pilots/inspectors/available'),
  assignInspector: (id, inspectorId) => api.post(`/pilots/${id}/assign-inspector`, { inspectorId }),
  submitKpi: (id, kpiId, d) => api.post(`/pilots/${id}/kpis/${kpiId}/evidence`, d),
  verifyKpi: (id, kpiId, d) => api.post(`/pilots/${id}/kpis/${kpiId}/verify`, d),
  submitMilestone: (id, msId, notes) => api.post(`/pilots/${id}/milestones/${msId}/submit`, { notes }),
  verifyMilestone: (id, msId, decision, notes) => api.post(`/pilots/${id}/milestones/${msId}/verify`, { decision, notes }),
  addRisk: (id, d) => api.post(`/pilots/${id}/risks`, d),
  updateRisk: (id, riskId, d) => api.put(`/pilots/${id}/risks/${riskId}`, d),
  inspect: (id, d) => api.post(`/pilots/${id}/inspections`, d),
  forwardToFinance: (id) => api.post(`/pilots/${id}/submit-to-finance`),
  reportUrl: (id, fmt) => `${API_BASE}/pilots/${id}/report.${fmt}`,
  report: (id) => api.get(`/pilots/${id}/report`),
};

export const financeApi = {
  dashboard: () => api.get('/finance/dashboard'),
  budget: () => api.get('/finance/budget'),
  payments: (p) => api.get(`/finance/payments${qs(p)}`),
  payment: (id) => api.get(`/finance/payments/${id}`),
  submitClaim: (d) => api.post('/finance/payments', d),
  approve: (id, remarks) => api.post(`/finance/payments/${id}/approve`, { remarks }),
  disburse: (id, disbursementReference) => api.post(`/finance/payments/${id}/disburse`, { disbursementReference }),
  issueCheque: (id, d) => api.post(`/finance/payments/${id}/cheque`, d),
  clearCheque: (id, clearedDate) => api.post(`/finance/payments/${id}/cheque/clear`, { clearedDate }),
  bounceCheque: (id, reason) => api.post(`/finance/payments/${id}/cheque/bounce`, { reason }),
  taxLedger: (status) => api.get(`/finance/tax-ledger${qs(status && status !== 'ALL' ? { status } : {})}`),
  remitTax: (id, challanNumber, challanDate) => api.post(`/finance/tax-ledger/${id}/remit`, { challanNumber, challanDate }),
  taxLedgerCsvUrl: () => `${API_BASE}/finance/reports/tax-ledger.csv`,
  hold: (id, reason) => api.post(`/finance/payments/${id}/hold`, { reason }),
  reject: (id, reason) => api.post(`/finance/payments/${id}/reject`, { reason }),
  anomalies: () => api.get('/finance/anomalies'),
  resolveAnomaly: (id, resolutionNotes) => api.post(`/finance/anomalies/${id}/resolve`, { resolutionNotes }),
  stalled: () => api.get('/finance/stalled'),
  caseFileUrl: (id, fmt) => `${API_BASE}/finance/reports/case-file/${id}.${fmt}`,
  claimsCsvUrl: () => `${API_BASE}/finance/reports/claims.csv`,
  budgetCsvUrl: () => `${API_BASE}/finance/reports/budget.csv`,
};

export const adminApi = {
  dashboard: () => api.get('/admin/dashboard'),
  users: () => api.get('/admin/users'),
  inviteUser: (d) => api.post('/admin/users/invite', d),
  updateUser: (id, d) => api.put(`/admin/users/${id}`, d),
  resetPassword: (id) => api.post(`/admin/users/${id}/reset-password`),
  departments: () => api.get('/admin/departments'),
  createDepartment: (d) => api.post('/admin/departments', d),
  updateDepartment: (id, d) => api.put(`/admin/departments/${id}`, d),
  startups: () => api.get('/admin/startups'),
  verifyStartup: (id, status, verificationNotes) => api.put(`/admin/startups/${id}/verify`, { status, verificationNotes }),
  auditLogs: (p) => api.get(`/admin/audit-logs${qs(p)}`),
  settings: () => api.get('/admin/settings'),
  saveSettings: (d) => api.put('/admin/settings', d),
  accessRequests: (status = 'PENDING') => api.get(`/admin/access-requests${qs({ status })}`),
  approveRequest: (id, body) => api.post(`/admin/access-requests/${id}/approve`, body || {}),
  rejectRequest: (id, note) => api.post(`/admin/access-requests/${id}/reject`, { note }),
  investors: () => api.get('/admin/investors'),
  verifyInvestor: (userId, status, notes) => api.put(`/admin/investors/${userId}/verify`, { status, notes }),
  ai: () => api.get('/admin/ai'),
  aiLogs: () => api.get('/admin/ai/logs'),
};

export const networkApi = {
  me: () => api.get('/network/me'),
  updateMe: (d) => api.put('/network/me', d),
  startups: (p) => api.get(`/network/startups${qs(p)}`),
  requestIntro: (organizationId, message) => api.post('/network/intros', { organizationId, message }),
  intros: () => api.get('/network/intros'),
  incoming: () => api.get('/network/incoming'),
  respond: (id, accept) => api.post(`/network/incoming/${id}/respond`, { accept }),
  showcase: (optIn, summary) => api.put('/network/showcase', { optIn, summary }),
};

export const assistantApi = {
  status: () => api.get('/assistant/status'),
  chat: (message, history, page) => api.post('/assistant/chat', { message, history, page }),
};

export const notificationsApi = {
  list: () => api.get('/notifications'),
  markRead: (id) => api.post(`/notifications/${id}/read`),
  markAllRead: () => api.post('/notifications/read-all'),
};

export const auditApi = { mine: () => api.get('/audit') };
export const searchApi = { query: (q, f) => api.get(`/search${qs({ q, ...f })}`) };
export const publicApi = { stats: () => api.get('/public/stats'), departments: () => api.get('/public/departments') };
export const filesApi = { upload: (fd) => api.post('/files/upload', fd) };

export const managementApi = {
  extendPilot: (id, months, reason) => api.post(`/pilots/${id}/extend`, { months, reason }),
  terminatePilot: (id, reason) => api.post(`/pilots/${id}/terminate`, { reason }),
  withdrawProposal: (id) => api.post(`/proposals/${id}/withdraw`),
  extendDeadline: (id, deadline, reason) => api.post(`/challenges/${id}/extend-deadline`, { deadline, reason }),
  addAddendum: (id, title, body) => api.post(`/challenges/${id}/addenda`, { title, body }),
  addenda: (id) => api.get(`/challenges/${id}/addenda`),
};

export const platformApi = {
  documents: (organizationId) => api.get(`/documents${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`),
  uploadDocument: (docType, filename, contentBase64) => api.post('/documents', { docType, filename, contentBase64 }),
  documentUrl: (id) => `${API_BASE}/documents/${id}/download`,
  reviewDocument: (id, status, note) => api.put(`/documents/${id}/review`, { status, note }),
  startupReview: (id) => api.get(`/admin/startups/${id}/review`),
  setCheck: (id, key, done, note) => api.put(`/admin/startups/${id}/checklist`, { key, done, note }),
  reconcile: (rows) => api.post('/finance/reconcile', { rows }),
  applyReconcile: (items) => api.post('/finance/reconcile/apply', { items }),
  financeTrends: () => api.get('/finance/trends'),
  adminTrends: () => api.get('/admin/trends'),
  questions: (cid) => api.get(`/challenges/${cid}/questions`),
  ask: (cid, question) => api.post(`/challenges/${cid}/questions`, { question }),
  answer: (cid, qid, answer) => api.post(`/challenges/${cid}/questions/${qid}/answer`, { answer }),
  duplicateChallenge: (cid) => api.post(`/challenges/${cid}/duplicate`),
  createDraft: (d) => api.post('/proposals/drafts', d),
  saveDraft: (id, d) => api.put(`/proposals/${id}/draft`, d),
  deleteDraft: (id) => api.del(`/proposals/${id}/draft`),
  submitDraft: (id) => api.post(`/proposals/${id}/submit`),
};

export const pipelineApi = {
  scaleups: () => api.get('/pipeline/scaleup'),
  recommendScaleup: (d) => api.post('/pipeline/scaleup', d),
  decideScaleup: (id, decision, note) => api.post(`/pipeline/scaleup/${id}/decide`, { decision, note }),
  appeals: () => api.get('/pipeline/appeals'),
  fileAppeal: (proposalId, reason) => api.post('/pipeline/appeals', { proposalId, reason }),
  decideAppeal: (id, decision, note) => api.post(`/pipeline/appeals/${id}/decide`, { decision, note }),
  fileTemplates: () => api.get('/finance/payment-file/templates'),
  addFileTemplate: (d) => api.post('/finance/payment-file/templates', d),
  deleteFileTemplate: (id) => api.del(`/finance/payment-file/templates/${id}`),
  // The bank file is sensitive and returned as text, so it is fetched with the session cookie and saved from memory
  async paymentFile(templateId, claimIds) {
    const res = await fetch(`${API_BASE}/finance/payment-file`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId, claimIds }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'The file could not be created'); }
    return res.text();
  },
};

export const teamApi = {
  get: () => api.get('/team'),
  invite: (email) => api.post('/team/invites', { email }),
  revoke: (id) => api.del(`/team/invites/${id}`),
  remove: (id) => api.del(`/team/members/${id}`),
};
export const messagesApi = {
  threads: () => api.get('/messages/threads'),
  unread: () => api.get('/messages/unread'),
  thread: (id) => api.get(`/messages/threads/${id}`),
  start: (d) => api.post('/messages/threads', d),
  send: (id, body) => api.post(`/messages/threads/${id}/messages`, { body }),
  close: (id) => api.post(`/messages/threads/${id}/close`),
  reopen: (id) => api.post(`/messages/threads/${id}/reopen`),
};

export const emailApi = {
  status: () => api.get('/admin/email/status'),
  test: (to) => api.post('/admin/email/test', to ? { to } : {}),
};
