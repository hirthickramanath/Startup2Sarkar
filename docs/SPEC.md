# Government Startup Innovation Procurement Platform
## Final Multi-Role Product & UI/UX Specification for Antigravity

> Build a production-quality, responsive government innovation procurement platform covering Government Official, Startup, Inspector / Pilot Manager, Finance Officer, and Super Admin roles.
>
> The system must be evidence-driven, auditable, role-based, and AI-assisted. AI is advisory only and must never silently make procurement, pilot-selection, financial, or administrative decisions.

---

# 0. UI/UX Reference GitHub Repositories

Use these repositories as UI/UX research and inspiration:

- VoltAgent/awesome-design-md
- nextlevelbuilder/ui-ux-pro-max-skill
- amaancoderx/skillui
- touchine-ojo/OJO-Design-Skills
- stevembarclay/pencilplaybook
- Jakubantalik/transitions.dev
- iamaanahmad/polished-ui-skills
- Mert-byt/Better-UI-UX
- maxbogo/awesome-ai-tools-for-ui
- bradtraversy/design-resources-for-developers
- narrowin/awesome-generative-ui
- x1xhlol/system-prompts-and-models-of-ai-tools
- showlab/Awesome-GUI-Agent
- gui-world

Use them to study:

- information architecture
- enterprise dashboards
- government/fintech UX
- AI assistant patterns
- tables and data visualization
- command/search interfaces
- transitions and micro-interactions
- accessibility
- responsive layouts
- loading/error/empty states
- typography and spacing
- modern navigation
- explainable AI interfaces

Do not blindly copy code, branding, exact layouts, or proprietary designs. Synthesize original UI specifically for this platform.

---

# 1. Product Vision

The platform enables government departments to:

1. Identify real operational problems.
2. Convert problems into innovation challenges.
3. Discover eligible startups.
4. Receive and evaluate proposals.
5. Use AI for structured analysis and recommendations.
6. Select startups through explicit human decisions.
7. Launch controlled pilots.
8. Monitor milestones, KPIs, risks, and evidence.
9. Validate pilot outcomes.
10. Submit validated financial requests.
11. Process milestone-linked payments.
12. Generate audit/reporting records.
13. Evaluate scale-up decisions.

Core principle:

**Problem → Challenge → Startup → Evaluation → Pilot → Evidence → Validation → Finance → Scale-up**

---

# 2. Global Design System

Create a premium government-grade enterprise interface.

Visual qualities:

- trustworthy
- modern
- calm
- professional
- accessible
- data-dense without clutter
- sophisticated
- highly usable

Avoid:

- generic Bootstrap dashboard appearance
- crypto/SaaS aesthetics
- excessive gradients
- excessive glassmorphism
- childish illustrations
- excessive rounded cards
- decorative animation
- fake AI gimmicks

Semantic colors:

- neutral = normal information
- blue = information/in-progress
- green = verified/completed
- amber = warning/action required
- red = critical/blocked/anomaly

Use color sparingly.

Design around:

**Public Money → Evidence → Control → Accountability**

Include:

- consistent typography
- spacing scale
- semantic badges
- accessible contrast
- keyboard navigation
- tooltips
- confirmation dialogs
- skeleton loaders
- empty states
- error states
- success feedback
- responsive tables
- subtle transitions

---

# 3. Global Application Shell

Use a reusable application shell.

Desktop:

**Sidebar → Main Content → Optional Contextual AI Drawer**

Top bar:

- breadcrumb
- page title
- global search
- notifications
- help
- user profile
- role indicator

Sidebar changes according to role.

Every role should have:

- Dashboard
- Notifications
- Audit/Activity where permitted
- Profile/Settings where permitted
- Logout

Implement role-based route protection.

---

# 4. Global Search / Command Center

Provide a global search interface.

Search across authorized records:

- challenges
- startups
- proposals
- pilots
- payments
- invoices
- reports
- audit events

Support natural-language queries where appropriate.

Examples:

- "Show active healthcare pilots."
- "Find proposals due this week."
- "Show payments above ₹5 lakh."
- "Which pilots are overdue?"

Results must come from actual stored/demo records.

---

# 5. AI Governance Rules

AI can assist with:

- summarization
- classification
- matching
- comparison
- recommendation
- explanation
- anomaly explanation
- report drafting
- natural-language querying

AI must NOT independently:

- select a startup
- approve a government procurement decision
- release a payment
- alter KPI evidence
- alter historical audit records
- modify government decisions
- hide non-recommended proposals
- fabricate metrics
- fabricate financial values

Every important AI output should identify its basis where possible:

- Verified Data
- User/Startup Reported
- System Calculation
- AI Interpretation

Use labels such as:

**AI Recommended**

not:

**AI Winner**

---

# 6. Government Official Login

## Purpose

Government Official identifies problems, creates/publishes challenges, reviews startup proposals, evaluates AI recommendations, selects startups for pilots, monitors pilot outcomes, generates reports, and forwards validated pilots to Finance.

Route:

`/government/dashboard`

## Dashboard

Summary cards:

- Active Challenges
- Total Proposals
- AI Evaluated Proposals
- Recommended Top 3
- Active Pilots
- Completed Pilots
- Pending Finance Requests

Challenge pipeline:

**Draft → Published → Proposals Received → AI Evaluation → Shortlisted → Pilot → Completed → Finance**

Recent Challenges table:

- Challenge ID
- Challenge Name
- Department
- Proposals
- Status
- Created Date
- Action

Recent Activity:

- proposal received
- AI evaluation completed
- startup shortlisted
- pilot completed
- finance request submitted

Add department/category/status analytics.

---

# 7. Government Challenge Creation

Route:

`/government/challenges/create`

Allow the officer to describe a problem in simple language.

Example:

"Our rural hospitals are experiencing delays in emergency response and patient triage."

Input:

- Problem Description

Button:

**Generate Challenge with AI**

AI may generate:

- Challenge Title
- Problem Statement
- Problem Category
- Target Beneficiaries
- Desired Outcome
- Required Capabilities
- Constraints
- Suggested Pilot Duration
- Suggested KPIs
- Evaluation Criteria
- Required Documents
- Risk Considerations

Every generated field must remain editable.

Actions:

- Save Draft
- Preview
- Publish Challenge
- Generate Challenge Report

Add version history for important challenge edits.

Publishing should require explicit confirmation.

---

# 8. Challenge Management

Route:

`/government/challenges`

Features:

- search
- filters
- sorting
- pagination
- draft editing
- publish
- close
- archive
- reports
- submission access

Filters:

- status
- department
- category
- date
- proposal count

Challenge detail:

`/government/challenges/:id`

Show:

- challenge ID
- title
- problem
- expected outcome
- requirements
- KPIs
- evaluation criteria
- pilot duration
- deadline
- submissions

Actions:

- View Proposals
- Run AI Evaluation
- Generate Report
- Close Challenge

---

# 9. Startup Proposal Evaluation

Route:

`/government/challenges/:id/proposals`

Show ALL submitted startups.

Never hide non-recommended startups.

Columns:

- Startup
- Solution
- Submission Date
- Eligibility
- AI Evaluation Status
- AI Recommendation
- Risk
- Action

Actions:

- View Proposal
- Run AI Evaluation
- Compare
- Manual Review

Add side-by-side proposal comparison.

---

# 10. AI Pilot Manager

Route:

`/government/pilot-manager`

Evaluate proposals against:

- Problem Alignment
- Technical Feasibility
- Expected Impact
- Evidence Strength
- Deployment Readiness
- Cost Feasibility
- Scalability
- Risk

For each evaluation show:

### Why this startup was recommended

- requirements satisfied
- relevant evidence
- technology match
- deployment feasibility
- cost compatibility

### Concerns

- missing evidence
- technical limitations
- deployment risks
- cost concerns
- data/security concerns

Show evidence/source references.

Clearly label confidence and limitations.

---

# 11. AI Recommended Top 3

Show:

- Startup Name
- Problem Fit
- Technical Feasibility
- Evidence Strength
- Deployment Readiness
- Cost Feasibility
- Risks
- Strengths
- Concerns

Label:

**AI Recommended**

The Government Official must review and approve the shortlist.

Actions:

- Review
- Approve Shortlist
- Reject Recommendation
- Request More Information

---

# 12. Startup Selection

After reviewing the shortlist, Government Official explicitly selects a startup.

Confirmation dialog:

> "You are selecting this startup for pilot execution. AI recommendations are advisory."

Store:

- selected startup
- officer
- timestamp
- reason/remarks
- challenge ID

Require audit entry.

---

# 13. Pilot Creation

Route:

`/government/pilots/create`

Fields:

- Pilot Name
- Startup
- Challenge
- Department
- Location
- Duration
- Budget
- Baseline
- Target Outcome

KPIs:

- KPI Name
- Baseline
- Target
- Measurement Method
- Frequency

Milestones:

- Milestone
- Due Date
- Deliverable
- Payment Amount

Risks:

- Risk
- Severity
- Mitigation

Action:

**Launch Pilot**

Launching must create an audit event.

---

# 14. Government Pilot Monitoring

Show:

- status
- progress
- days remaining
- KPI results
- milestones
- risks
- issues
- budget
- startup activity

Allow clarification requests to startups.

Add timeline:

- pilot launch
- milestone updates
- KPI submissions
- inspections
- issues
- final report
- finance submission

---

# 15. KPI Results

Use stored pilot data only.

Columns:

| KPI | Baseline | Target | Current | Status |
|---|---:|---:|---:|---|
| Response Time | 14.2 min | <10 min | 8.1 min | Achieved |
| Accuracy | 76% | >90% | 93% | Achieved |

AI may analyze values but must never invent them.

Show evidence/version/source for each KPI.

---

# 16. Final Pilot Report

Generate:

- Executive Summary
- Problem
- Startup Solution
- Pilot Methodology
- Baseline
- KPI Results
- Performance Analysis
- Risks
- Cost
- Issues
- Validation
- Scale-Up Considerations

Actions:

- Generate Report
- Download PDF
- Send to Finance

Report versions should be traceable.

---

# 17. Finance Submission

Before submission validate:

- pilot complete
- KPI results available
- final report generated
- required evidence available
- budget information available
- validation complete

Button:

**Send to Finance**

After submission:

**Awaiting Finance Review**

Show submission ID and timestamp.

---

# 18. Government Audit Trail

Show:

- challenge creation
- publication
- proposal submission
- AI evaluation
- shortlist
- government approval
- pilot launch
- KPI updates
- report generation
- finance submission

Each event:

- user
- action
- timestamp
- entity
- status

Historical audit entries must be immutable from the UI.

---

# 19. Government Restrictions

Government Official cannot:

- directly release Finance payments
- modify Finance decisions
- change historical audit logs
- silently overwrite KPI evidence
- automatically accept AI recommendations

---

# 20. Startup Login

Route:

`/startup/dashboard`

Purpose:

Discover challenges, submit proposals, track evaluation, participate in pilots, submit KPI evidence, manage milestones, and track payments.

Dashboard cards:

- Open Challenges
- Submitted Proposals
- Under Evaluation
- AI Shortlisted
- Active Pilots
- Completed Pilots
- Pending Payments
- Total Payments Released

---

# 21. Startup Challenge Discovery

Recommended Challenges:

Each card:

- challenge title
- department
- category
- problem summary
- expected outcome
- deadline
- pilot duration
- informational match indicator

Use:

**High Relevance**

not a guarantee.

Open Challenges route:

`/startup/challenges`

Filters:

- sector
- department
- technology
- location
- deadline
- status

Search:

- challenge ID
- title
- department

---

# 22. Startup Challenge Details

Show:

- challenge ID
- problem statement
- desired outcome
- requirements
- KPIs
- pilot duration
- evaluation criteria
- deadline
- required documents

Action:

**Submit Proposal**

---

# 23. Startup Proposal Submission

Route:

`/startup/proposals/create`

Sections:

### Startup Information

- startup name
- founder
- contact
- website
- sector
- technology

### Solution

- proposed solution
- problem-solution fit
- technical approach
- deployment approach
- implementation timeline

### Evidence

- previous deployments
- case studies
- customer references
- performance results

### Cost

- pilot cost
- implementation cost
- scale-up cost

### Compliance

- certifications
- registrations
- security documents
- other documents

### Documents

Support file uploads.

Add draft autosave and validation.

---

# 24. Startup AI Readiness Check

Before submission show:

### Complete

- solution description
- cost
- deployment plan

### Missing

- previous deployment evidence

### Warning

- security documentation incomplete

The startup can fix issues before submission.

AI must not block submission based on subjective scoring; only deterministic required-field checks should block mandatory submission requirements.

---

# 25. Startup Proposal Tracking

Route:

`/startup/proposals`

Statuses:

- Draft
- Submitted
- Under Review
- AI Evaluated
- Shortlisted
- Not Shortlisted
- Selected for Pilot
- Pilot Active
- Pilot Completed

Startup cannot edit government evaluation results.

---

# 26. Startup AI Evaluation Visibility

If configured by government, expose only a limited summary:

- Problem Alignment
- Technical Fit
- Evidence Strength
- Deployment Readiness
- Concerns

Never expose confidential evaluator notes.

---

# 27. Startup Pilot Workspace

Route:

`/startup/pilots/:id`

Show:

- pilot objective
- timeline
- KPIs
- milestones
- deliverables
- risks
- government contact
- status

Allow clarification requests.

---

# 28. Startup KPI Evidence

For each KPI:

- KPI name
- measurement period
- actual value
- evidence
- notes

Startup cannot overwrite historical submissions.

Corrections create a new version/submission.

Show version history.

---

# 29. Startup Milestones

Show:

- milestone name
- due date
- deliverable
- status
- payment amount

Statuses:

- Pending
- Submitted
- Under Review
- Approved
- Payment Processing
- Paid
- Returned

---

# 30. Startup Payment Dashboard

Example:

Total Contract: ₹10,00,000

Released: ₹6,00,000

Pending: ₹4,00,000

Timeline:

Milestone 1 → Paid  
Milestone 2 → Paid  
Milestone 3 → Under Review  
Milestone 4 → Pending

Show payment references and timestamps where authorized.

---

# 31. Startup Reports

Authorized reports:

- proposal report
- pilot report
- KPI report
- milestone report
- payment report

Confidential government information must remain hidden.

---

# 32. Startup Notifications

Examples:

- proposal submitted
- proposal under evaluation
- shortlisted
- milestone approaching
- KPI evidence requested
- milestone approved
- payment released
- clarification requested

Add read/unread state.

---

# 33. Startup Profile

Route:

`/startup/profile`

Sections:

- company information
- founders
- products
- technology
- sectors
- previous deployments
- certifications
- case studies
- contact details

Profile should be reusable across challenges.

---

# 34. Startup Restrictions

Startup cannot:

- modify government challenge requirements
- modify AI evaluation
- select itself
- approve its own milestone
- approve its own payment
- modify historical KPI submissions
- modify government audit logs

---

# 35. Inspector / Pilot Manager Login

Route:

`/inspector/dashboard`

Purpose:

Operationally monitor pilots, collect evidence, verify KPI data, record field observations, identify risks, and prepare validation information.

Dashboard cards:

- Active Pilots
- Pending Inspections
- KPI Reviews
- Risks
- Overdue Milestones
- Completed Inspections

---

# 36. Inspector Assigned Pilots

Show:

- pilot ID
- challenge
- startup
- department
- location
- progress
- KPI status
- risk status
- inspection status

Add filters for:

- overdue
- high risk
- inspection pending
- KPI verification pending

---

# 37. Inspector Pilot Inspection

Route:

`/inspector/pilots/:id`

Pilot information:

- objective
- startup
- department
- location
- duration
- budget

Checklist:

- deployment completed
- required systems available
- users trained
- security requirements checked
- data collection working
- KPI measurement working
- deliverables received

Each:

**Pass / Fail / Needs Review**

Allow notes and evidence attachments.

---

# 38. Inspector KPI Verification

For each KPI:

- baseline
- target
- submitted result
- evidence
- inspector verification
- status

Statuses:

- Verified
- Partially Verified
- Not Verified
- Requires Evidence

Inspector must not silently change startup data.

Corrections are recorded as verification results.

---

# 39. Inspector AI Pilot Analysis

AI analyzes verified data for:

- KPI performance
- improvement from baseline
- trends
- missing evidence
- anomalies
- risk indicators

Example:

"Response time improved from 14.2 minutes to 8.1 minutes."

AI should show calculation/source.

---

# 40. Inspector Risk Management

Risk categories:

- technical
- operational
- financial
- cybersecurity
- data
- scalability

Each risk:

- description
- severity
- evidence
- mitigation
- owner
- status

---

# 41. Inspector Field Observations

Record:

- date
- location
- observation
- evidence
- photos/documents
- severity
- recommended action

Do not delete historical observations.

---

# 42. Inspector Pilot Progress

Track:

- completion
- milestones
- deliverables
- KPI status
- risks
- inspection status

---

# 43. Inspector Validation Report

Generate:

- pilot objective
- inspection summary
- KPI verification
- evidence review
- risks
- field observations
- issues
- recommendations
- validation status

Validation:

- Verified
- Partially Verified
- Requires Further Evidence
- Not Verified

---

# 44. Inspector Scale-Up Evidence

Provide factual evidence for Government review:

- KPI achievement
- operational feasibility
- field usability
- deployment issues
- risks
- resource requirements

Inspector must not make procurement/funding decisions.

---

# 45. Inspector Restrictions

Cannot:

- select startups
- approve procurement
- approve Finance payments
- modify government decisions
- modify startup proposal content
- delete historical inspection records

---

# 46. Finance Officer Login

Route:

`/finance/dashboard`

Purpose:

Financial control, milestone-linked payment review, budget monitoring, invoice/deduction validation, anomalies, inspections, disputes, refunds, audit, and scale-up financial assessment.

Dashboard KPIs:

- Total Budget Allocated
- Funds Committed
- Funds Disbursed
- Pending Payment Requests
- Budget Remaining
- Overdue Payments
- Payments on Hold
- Financial Anomalies

Budget flow:

**Allocated → Committed → Disbursed → Available**

Example:

Allocated ₹10 Cr  
Committed ₹7.2 Cr  
Disbursed ₹4.8 Cr  
Available ₹2.8 Cr

Do not imply committed funds are freely available.

---

# 47. Finance Budget Management

Route:

`/finance/budget`

Show:

- department budget
- financial year
- allocation
- commitments
- disbursement
- remaining amount
- utilization
- forecast
- category allocation

Configurable warnings:

- 0–70% normal
- 70–85% warning
- 85–100% critical
- >100% blocked

Approval must check:

- available budget
- existing commitments
- contract value
- current payment
- cumulative payments

If insufficient:

**INSUFFICIENT AVAILABLE BUDGET**

and prevent normal approval.

---

# 48. Finance Payment Requests

Route:

`/finance/payments`

Columns:

- request ID
- startup
- pilot
- milestone
- gross amount
- deductions
- net payable
- submitted date
- SLA
- risk
- status
- action

Statuses:

- Submitted
- Under Review
- Verification Pending
- Finance Review
- Approved
- Processing
- Paid
- On Hold
- Rejected
- Disputed

Filters:

- status
- amount
- startup
- department
- pilot
- date
- risk
- overdue
- district

---

# 49. Finance Payment Detail

Show:

Contract Value  
Previously Disbursed  
Current Request  
Remaining Contract Value  
Available Budget  
Gross Amount  
GST  
TDS  
Other Deductions  
Net Payable

Checklist:

- contract valid
- milestone approved
- inspector verification
- invoice matched
- required documents
- budget available
- no blocking anomaly

Timeline:

Startup Submission  
→ Inspector Verification  
→ Pilot Manager Approval  
→ Finance Review  
→ Payment Approval  
→ Payment Processing  
→ Payment Completed

Actions:

- Approve Payment
- Put on Hold
- Raise Query
- Request Inspection

AI cannot auto-approve.

---

# 50. Finance Milestone Payment System

Example:

M1 Prototype ₹4L  
M2 Deployment ₹6L  
M3 Performance ₹5L  
M4 Final ₹5L

For each:

- objective
- amount
- completion
- evidence
- inspection
- approval
- payment status

Flow:

Startup → Evidence → Inspector → Pilot Manager → Finance → Payment

---

# 51. Finance Copilot

Floating button bottom-right:

**🤖 Finance Copilot**

Default state: button only.

Click:

- open right-side drawer
- show header
- close X
- chat
- suggested actions
- input

X closes drawer.

Floating button remains.

Click again reopens.

Do not navigate to another page.

On mobile, use a full-height drawer.

---

# 52. Context-Aware Finance AI

If Finance is viewing Payment PR-1024, asking:

"Why is this pending?"

AI receives authorized context:

- payment
- startup
- project
- contract
- milestone
- invoice
- budget
- inspector verification
- anomalies
- payment history

Show:

**Context: Payment PR-1024**

Suggested actions:

- Summarize this project
- Explain this payment
- Check payment eligibility
- Show financial history
- Check budget impact
- Explain anomalies
- Show missing documents
- Find similar payments
- Show stalled pilots
- Generate audit summary

---

# 53. Finance AI Brief

Generate:

### Project Summary

### Financial Summary

- contract
- committed
- disbursed
- current request
- remaining commitment
- available budget

### Milestone Status

### Verified Evidence

### Startup-Reported Information

### Potential / Scale-Up Information

### Financial Risks

### Missing Information

End:

**Human Finance Review Required**

---

# 54. AI Data Trust

Distinguish:

- VERIFIED DATA
- STARTUP-REPORTED DATA
- SYSTEM CALCULATIONS
- AI INTERPRETATION

Show source references:

"Based on Contract CP-1024, Invoice INV-2034, Inspection IR-442."

---

# 55. Finance Invoice & Deductions

Features:

- invoice upload
- validation
- contract match
- milestone match
- duplicate detection
- GST
- TDS
- other deductions
- net payable

Example:

Gross ₹10,00,000  
TDS ₹X  
GST adjustment ₹X  
Other deduction ₹X  
Net ₹X

Keep deduction rules configurable.

---

# 56. Financial Anomalies

Route:

`/finance/anomalies`

Detect:

- duplicate invoice
- duplicate payment
- invoice mismatch
- payment above milestone value
- unusual cost increase
- repeated milestone delays
- contract expiry
- bank detail change
- budget overrun
- stalled project
- suspicious transaction patterns

Severity:

- Low
- Medium
- High
- Critical

Each anomaly:

- reason
- payment
- amount
- project
- date
- status
- assigned officer
- resolution

Humans resolve anomalies.

---

# 57. Stalled / Failed Pilot Finance Workflow

Workflow:

**Identify Stall → Notify Startup → Request Explanation → Inspection/Assessment → Department Decision → Extension / Recovery / Refund / Termination**

Show outstanding financial exposure.

Track:

- amount paid
- committed
- recoverable
- recovered
- outstanding
- deadlines

---

# 58. Finance Inspection Requests

Button:

**Request Inspection**

Form:

- pilot
- location
- reason
- priority
- evidence required

Show:

- inspector
- contact
- assigned date
- visit date
- status

Inspection result:

- GPS/location
- photos
- timestamp
- checklist
- findings
- documents
- conclusion

---

# 59. Finance Disputes & Refunds

Types:

- payment
- milestone
- invoice
- contract
- deduction
- refund

Display:

- dispute ID
- amount
- startup
- pilot
- issue
- evidence
- assigned officer
- deadline
- status
- resolution

Recovery:

- amount disbursed
- recoverable
- recovered
- outstanding
- due date
- status

---

# 60. Payment SLA

Track:

- average processing time
- within SLA
- near SLA
- breached

Highlight overdue requests.

Provide escalation actions.

---

# 61. Finance Reports & Audit

Generate PDF/CSV:

- payment report
- budget report
- deduction report
- pilot financial report
- anomaly report
- dispute report
- refund/recovery report
- complete audit report

Generate Complete Case File:

- contract
- amendments
- milestones
- invoices
- payment records
- inspections
- deductions
- disputes
- refunds
- AI Finance Brief
- audit trail

---

# 62. Finance Audit Timeline

Example:

10:42 Invoice uploaded  
11:04 Inspector verified  
11:17 Pilot Manager approved  
11:31 Finance reviewed  
11:46 Query raised  
14:21 Startup responded  
15:03 Payment approved  
15:04 Payment instruction generated

Record:

- user
- role
- action
- timestamp
- affected record
- old value
- new value
- reason

---

# 63. Finance Scale-Up Assessment

For successful pilots show:

- current pilot cost
- proposed scale
- estimated scale-up cost
- additional funding requirement
- available budget
- existing commitments
- financial impact

---

# 64. Finance Analytics

Charts:

- budget utilization
- monthly disbursement
- processing time
- payment delays
- pilot expenditure
- department expenditure
- startup expenditure
- scale-up expenditure
- anomaly trends

Filters should update the charts.

---

# 65. Finance Approval Controls

Implement optional maker-checker controls.

For configurable high-value thresholds:

- first review
- second approval
- approval authority
- timestamp
- remarks

Never bypass configured approval requirements.

---

# 66. Finance Bank Detail Protection

If startup bank details change:

- flag change
- display old/new masked details
- require verification workflow
- place affected payment on hold when configured
- record audit event

Never expose unnecessary sensitive banking information.

---

# 67. Finance Contract Financial View

Show:

- contract value
- original value
- revised value
- paid
- remaining
- milestones
- amendments
- payment status

Contract amendments must show:

- original
- revised
- reason
- financial impact
- approval history

---

# 68. Finance Payment Rule

Actual government money must not be represented as transferred directly by the website unless a real authorized payment integration exists.

Prototype flow:

Startup submits  
→ verification  
→ Finance review  
→ approval  
→ Payment Instruction Generated  
→ Processing  
→ Completed

Use a clearly fictional demo transaction ID.

---

# 69. Super Admin Login

Route:

`/admin/dashboard`

Purpose:

Platform administration, user management, roles, departments, system configuration, AI configuration, audit monitoring, analytics, security, and reference data.

Dashboard cards:

- Total Users
- Government Officials
- Startups
- Inspectors
- Finance Officers
- Active Challenges
- Active Pilots
- Total Funding Requests

System health:

- AI Service
- Database
- File Storage
- Notifications
- Report Generator

---

# 70. Super Admin User Management

Route:

`/admin/users`

Features:

- create user
- edit user
- activate
- deactivate
- reset access
- assign role
- assign department
- view activity

Roles:

- Government Official
- Startup
- Finance Officer
- Inspector / Pilot Manager
- Super Admin

All role changes audited.

---

# 71. Super Admin Role Management

Define permissions.

Government:

- create challenges
- review proposals
- approve shortlist
- launch pilots
- submit finance requests

Startup:

- view challenges
- submit proposals
- submit pilot evidence
- view payments

Inspector:

- inspect pilots
- verify KPI evidence
- record risks
- generate validation reports

Finance:

- review funding
- approve payments
- track payments

Super Admin:

- platform administration

---

# 72. Department Management

Manage:

- department name
- department code
- description
- active/inactive
- government users

---

# 73. Startup Administration

View:

- startup
- registration status
- profile
- documents
- active proposals
- pilots
- status

Admin must not modify government evaluation results.

---

# 74. Challenge Administration

Monitor:

- total challenges
- published
- closed
- active
- department distribution

Administrative actions:

- archive
- restore
- flag
- disable

All audited.

---

# 75. AI Configuration

Route:

`/admin/ai`

Services:

- Challenge Generator
- Startup Matching
- Proposal Analyzer
- Shortlist Recommendation
- Risk Analyzer
- KPI Analyzer
- Report Generator
- Finance Brief
- Finance Anomaly Explanation

Allow:

- enable/disable
- threshold configuration
- model/provider configuration
- service status

Never expose secret API keys in frontend.

---

# 76. AI Audit

Track:

- AI request
- user
- feature
- input reference
- output
- timestamp
- model/provider
- version

Avoid unnecessary sensitive data.

---

# 77. Platform Analytics

Charts:

- challenges by department
- startups by sector
- proposals by status
- pilot metrics
- finance requests
- payment statistics
- challenge-to-pilot time
- proposal evaluation time

Use filters and date ranges.

---

# 78. Super Admin Audit Logs

Route:

`/admin/audit`

Display:

- user
- role
- action
- entity
- timestamp
- IP/session information where appropriate
- result

Logs should be append-only through application interface.

---

# 79. System Settings

Configure:

- categories
- sectors
- KPI types
- risk levels
- notification rules
- report templates
- status definitions
- SLA definitions
- financial deduction rules
- approval thresholds

Configuration changes must be audited.

---

# 80. Security

Super Admin should have:

- strong authentication
- role-based permissions
- session management
- suspicious activity monitoring
- audit logging
- secure access controls

---

# 81. Super Admin Restrictions

Super Admin must not silently alter historical:

- government decisions
- startup submissions
- inspection records
- Finance decisions
- KPI evidence
- audit logs

Administrative corrections create audit records.

---

# 82. Notifications & Escalations

Implement role-specific notification center.

Notification categories:

- new submission
- evaluation complete
- shortlist action
- pilot milestone
- KPI evidence
- inspection
- payment
- SLA
- anomaly
- dispute
- refund
- budget threshold
- contract expiry
- bank detail change
- report ready

Support:

- read/unread
- priority
- timestamp
- related record
- action link

---

# 83. File & Evidence Management

Create reusable evidence/document component.

Features:

- upload
- preview
- metadata
- versioning
- status
- uploader
- timestamp
- related entity
- access control

Never allow unauthorized users to access confidential files.

---

# 84. Common Record Detail Pattern

Use a consistent detail layout:

1. Header
2. Status
3. Summary
4. Key metrics
5. Tabs
6. Timeline
7. Evidence
8. AI explanation
9. Actions
10. Audit history

This should work for:

- challenge
- proposal
- pilot
- payment
- dispute
- anomaly
- report

---

# 85. Global Auditability

Important changes require:

- authenticated user
- role
- timestamp
- entity
- action
- old value
- new value
- reason where relevant

Do not expose edit/delete controls for immutable historical records.

---

# 86. Demo Data

Use realistic fictional Indian government/procurement data.

Startups:

- ABC Technologies Pvt Ltd
- GreenGrid Innovations
- AgriSense Labs
- CivicFlow Technologies

Projects:

- Smart Waste Management
- Intelligent Traffic Monitoring
- Rural Healthcare Monitoring
- Smart Agriculture

Use realistic INR values.

Clearly label data as demo data.

---

# 87. Technical Implementation Expectations

Before coding:

1. Inspect existing project architecture.
2. Identify framework and routing.
3. Identify styling system.
4. Identify component system.
5. Identify authentication.
6. Identify API/data layer.
7. Reuse existing architecture where practical.
8. Do not rewrite working infrastructure unnecessarily.

Build reusable components:

- AppShell
- Sidebar
- Topbar
- Breadcrumbs
- DataTable
- FilterBar
- StatusBadge
- KPI Card
- Timeline
- EvidencePanel
- AuditTimeline
- AI Drawer
- ConfirmationDialog
- FileUploader
- EmptyState
- ErrorState
- Skeleton
- Chart components

Keep business rules separate from presentation.

Financial calculations must be deterministic.

AI should consume structured context rather than the entire database.

---

# 88. AI Context Architecture

Create a structured context object per record.

Example finance context:

- payment
- startup
- challenge
- pilot
- contract
- milestone
- invoice
- inspection
- budget
- anomalies
- dispute
- payment history

AI should query authorized structured context.

Do not expose unauthorized records.

---

# 89. Role-Based Access Control

Implement permissions at:

- route level
- page level
- component/action level
- API/data level

Examples:

A Startup cannot see another startup's proposal.

An Inspector cannot approve Finance payments.

A Government Official cannot directly release payment.

Finance cannot alter technical KPI evidence.

Super Admin administrative changes must be audited.

---

# 90. Responsive Requirements

Desktop-first, but fully responsive.

Desktop:

- sidebar
- multi-column dashboard
- data tables
- contextual AI drawer

Tablet:

- collapsible navigation
- adaptive tables

Mobile:

- navigation drawer
- stacked KPI cards
- responsive cards
- horizontal table scrolling where necessary
- AI Copilot full-height drawer
- touch-friendly controls

No accidental horizontal overflow.

---

# 91. Performance & UX

Use:

- lazy loading where appropriate
- skeleton states
- optimistic UI only where safe
- pagination
- debounced search
- sensible chart rendering
- clear loading indicators

Do not hide slow operations.

Show meaningful errors.

---

# 92. Final Quality Gate

Before finishing, verify:

- all role routes work
- role permissions work
- navigation is connected
- no dead buttons
- forms validate
- tables filter/search
- detail pages open
- dialogs work
- AI drawers open/close
- contextual AI works with demo data
- audit events appear
- KPI evidence is versioned
- payment calculations are deterministic
- budget controls prevent overspending
- payment workflow is realistic
- confidential information is protected
- responsive layouts work
- loading/empty/error states exist
- accessibility is acceptable
- visual system is consistent
- demo data is coherent
- no broken links
- no console errors in normal flows

---

# 93. Final UX Objective

The final platform should feel like a serious digital public-procurement operating system.

It should demonstrate:

**Government Problem → Innovation Challenge → Startup Discovery → AI-Assisted Evaluation → Human Selection → Pilot → Evidence → Validation → Financial Review → Payment Workflow → Audit → Scale-Up**

The interface must make that lifecycle understandable at a glance while keeping every important decision attributable to the appropriate human role.
