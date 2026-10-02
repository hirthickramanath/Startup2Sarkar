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
};

export const authApi = {
  config: () => api.get('/public/config'),
  login: (email, password, role) => api.post('/auth/login', { email, password, role }),
  google: (credential, role) => api.post('/auth/google', { credential, role }),
  verifyMfa: (tempToken, code) => api.post('/auth/mfa/verify', { tempToken, code }),
  setupMfa: () => api.post('/auth/mfa/setup'),
  enableMfa: (code) => api.post('/auth/mfa/enable', { code }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  logoutAll: () => api.post('/auth/logout-all'),
  sessions: () => api.get('/auth/sessions'),
  registerStartup: (d) => api.post('/auth/register-startup', d),
  organization: () => api.get('/auth/organization'),
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
  ai: () => api.get('/admin/ai'),
  aiLogs: () => api.get('/admin/ai/logs'),
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
