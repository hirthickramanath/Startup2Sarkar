import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DatabaseAdapter, getSetting } from '../db';
import { AuditService } from '../audit';
import { AiProvider } from '../ai';
import { AuthenticatedRequest, createAuthMiddleware, requireRole } from '../security';

const submitProposalSchema = z.object({
  challengeId: z.string(),
  solutionTitle: z.string().min(5),
  problemSolutionFit: z.string().min(20),
  technicalApproach: z.string().min(20),
  deploymentPlan: z.string().min(10),
  implementationTimeline: z.string().min(5),
  pilotCostPaise: z.number().int().min(100),
  scaleupCostPaise: z.number().int().min(100),
  evidenceDeployments: z.array(z.any()).default([]),
  certifications: z.array(z.any()).default([]),
  // Supporting material is shared as links (Drive, YouTube, GitHub ...): at most 3, https only, each with a short label.
  documents: z.array(z.object({
    label: z.string().trim().min(2).max(80),
    url: z.string().trim().url().max(300).refine((u) => /^https:\/\//i.test(u), 'Links must start with https://')
  })).max(3, 'You can add at most 3 links').default([])
});

export async function proposalRoutes(
  app: FastifyInstance,
  opts: { db: DatabaseAdapter; auditService: AuditService; aiProvider: AiProvider }
) {
  const { db, auditService, aiProvider } = opts;
  const authenticate = createAuthMiddleware(db);

  // 1. Submit Proposal (Startup only)
  app.post('/', { preHandler: [authenticate, requireRole('startup')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const parseResult = submitProposalSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const data = parseResult.data;

    // Spec Requirement: Startup must have VERIFIED organization status before submitting proposals!
    const orgRes = await db.query(
      'SELECT id, name, verification_status FROM organizations WHERE id = $1',
      [authReq.user.organizationId]
    );

    if (orgRes.rows.length === 0 || orgRes.rows[0].verification_status !== 'VERIFIED') {
      const currentStatus = orgRes.rows[0]?.verification_status || 'UNREGISTERED';
      return reply.status(403).send({
        error: `Statutory Submission Barrier: Your organization registration is currently '${currentStatus}'. Startup proposals can only be submitted after official DPIIT & corporate verification is completed.`,
        code: 'ORG_NOT_VERIFIED'
      });
    }

    const orgName = orgRes.rows[0].name;

    // Verify challenge is published and not expired
    const chalRes = await db.query(
      'SELECT id, title, status, deadline FROM challenges WHERE id = $1',
      [data.challengeId]
    );

    if (chalRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Challenge not found' });
    }

    const challenge = chalRes.rows[0];
    if (challenge.status !== 'PUBLISHED' && challenge.status !== 'PROPOSALS_RECEIVED') {
      return reply.status(400).send({ error: `Cannot submit proposal to challenge in status '${challenge.status}'` });
    }

    if (new Date(challenge.deadline) < new Date()) {
      return reply.status(400).send({ error: 'The statutory deadline for proposal submissions on this challenge has passed.' });
    }

    const proposalId = `PROP-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;

    await db.query(
      `INSERT INTO proposals (
        id, challenge_id, organization_id, startup_name, solution_title,
        problem_solution_fit, technical_approach, deployment_plan, implementation_timeline,
        pilot_cost_paise, scaleup_cost_paise, evidence_deployments, certifications,
        documents, status, submitted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'SUBMITTED', CURRENT_TIMESTAMP)`,
      [
        proposalId,
        data.challengeId,
        authReq.user.organizationId,
        orgName,
        data.solutionTitle,
        data.problemSolutionFit,
        data.technicalApproach,
        data.deploymentPlan,
        data.implementationTimeline,
        data.pilotCostPaise,
        data.scaleupCostPaise,
        JSON.stringify(data.evidenceDeployments),
        JSON.stringify(data.certifications),
        JSON.stringify(data.documents)
      ]
    );

    // Update challenge status to PROPOSALS_RECEIVED if still in PUBLISHED
    if (challenge.status === 'PUBLISHED') {
      await db.query(`UPDATE challenges SET status = 'PROPOSALS_RECEIVED' WHERE id = $1`, [data.challengeId]);
    }

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: 'startup',
      action: 'PROPOSAL_SUBMITTED',
      entityType: 'PROPOSAL',
      entityId: proposalId,
      details: { challengeId: data.challengeId, solutionTitle: data.solutionTitle },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.status(201).send({
      success: true,
      proposalId,
      message: 'Proposal successfully submitted for government review.'
    });
  });

  // 2. List Proposals (Tenant Isolated: Startup sees only their own; Government/Admin sees authorized)
  app.get('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authReq = request as AuthenticatedRequest;
    const { challengeId } = request.query as { challengeId?: string };

    let sql = `
      SELECT p.*,
             ae.overall_score, ae.why_recommended, ae.concerns, ae.limitations, ae.is_recommended_top3,
             ae.basis_data, ae.model_name AS ai_model, ae.evaluated_at,
             ae.problem_alignment_score, ae.technical_feasibility_score, ae.expected_impact_score,
             ae.evidence_strength_score, ae.deployment_readiness_score, ae.cost_feasibility_score, ae.risk_score
      FROM proposals p
      LEFT JOIN ai_evaluations ae ON ae.proposal_id = p.id
    `;
    const params: any[] = [];
    const conditions: string[] = [];

    // Tenant Isolation (Spec Section 89)
    if (authReq.user.role === 'startup') {
      conditions.push(`p.organization_id = $${params.length + 1}`);
      params.push(authReq.user.organizationId);
    } else if (authReq.user.role === 'government' && authReq.user.departmentId) {
      // Government official sees proposals for their department's challenges
      conditions.push(`p.challenge_id IN (SELECT id FROM challenges WHERE department_id = $${params.length + 1})`);
      params.push(authReq.user.departmentId);
    }

    if (challengeId) {
      conditions.push(`p.challenge_id = $${params.length + 1}`);
      params.push(challengeId);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += ' ORDER BY p.submitted_at DESC';

    const res = await db.query(sql, params);

    // Spec Section 26: If startup views proposals, never expose confidential internal evaluator notes!
    const sanitized = res.rows.map(row => {
      if (authReq.user.role === 'startup') {
        return {
          id: row.id,
          challenge_id: row.challenge_id,
          organization_id: row.organization_id,
          startup_name: row.startup_name,
          solution_title: row.solution_title,
          problem_solution_fit: row.problem_solution_fit,
          technical_approach: row.technical_approach,
          deployment_plan: row.deployment_plan,
          implementation_timeline: row.implementation_timeline,
          status: row.status,
          submitted_at: row.submitted_at,
          pilot_cost_paise: row.pilot_cost_paise,
          scaleup_cost_paise: row.scaleup_cost_paise,
          evidence_deployments: row.evidence_deployments,
          certifications: row.certifications,
          evaluation_summary: row.why_recommended ? {
            concerns: row.concerns,
            why_recommended: row.why_recommended
          } : null
        };
      }
      return row;
    });

    return reply.send({ data: sanitized });
  });

  // 3. AI Proposal Evaluation (Spec Section 10 & 11)
  app.post('/:id/ai-evaluate', { preHandler: [authenticate, requireRole('government', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;

    if (!(await getSetting<boolean>(db, 'ai.proposal_evaluation.enabled', true))) {
      return reply.status(403).send({ error: 'AI proposal evaluation has been disabled by the administrator.', code: 'AI_DISABLED' });
    }
    const propRes = await db.query('SELECT * FROM proposals WHERE id = $1', [id]);
    if (propRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }
    const proposal = propRes.rows[0];
    const chRes = await db.query('SELECT * FROM challenges WHERE id = $1', [proposal.challenge_id]);
    // The evaluator needs the FULL challenge (budget, KPIs, duration, capabilities), not a trimmed copy
    const challenge = chRes.rows[0];

    // Department scoping: officers evaluate only their own department's challenges (admins: all)
    if (authReq.user.role === 'government' && authReq.user.departmentId && challenge.department_id !== authReq.user.departmentId) {
      return reply.status(403).send({ error: 'Forbidden: this challenge belongs to another department' });
    }

    const evaluation = await aiProvider.evaluateProposal(challenge, proposal);
    const evalId = `EVAL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await db.transaction(async (tx) => {
      // Upsert evaluation
      await tx.query('DELETE FROM ai_evaluations WHERE proposal_id = $1', [id]);
      await tx.query(
        `INSERT INTO ai_evaluations (
          id, challenge_id, proposal_id, overall_score, problem_alignment_score,
          technical_feasibility_score, expected_impact_score, evidence_strength_score,
          deployment_readiness_score, cost_feasibility_score, risk_score,
          why_recommended, concerns, limitations, is_recommended_top3, basis_data,
          model_name, prompt_version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          evalId,
          proposal.challenge_id,
          id,
          evaluation.overall_score,
          evaluation.problem_alignment_score,
          evaluation.technical_feasibility_score,
          evaluation.expected_impact_score,
          evaluation.evidence_strength_score,
          evaluation.deployment_readiness_score,
          evaluation.cost_feasibility_score,
          evaluation.risk_score,
          JSON.stringify(evaluation.why_recommended),
          JSON.stringify(evaluation.concerns),
          JSON.stringify(evaluation.limitations),
          evaluation.is_recommended_top3,
          JSON.stringify(evaluation.basis),
          evaluation.model_name,
          evaluation.prompt_version
        ]
      );

      // Update proposal status
      await tx.query(
        `UPDATE proposals
         SET status = 'AI_EVALUATED', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id]
      );

      // Rank within the challenge: only the 3 best-scoring evaluations (score >= 50) carry the "AI Recommended" badge
      await tx.query(
        `UPDATE ai_evaluations SET is_recommended_top3 = (id IN (
           SELECT id FROM ai_evaluations WHERE challenge_id = $1 AND overall_score >= 50
           ORDER BY overall_score DESC, evaluated_at ASC LIMIT 3))
         WHERE challenge_id = $1`,
        [proposal.challenge_id]
      );

      await tx.query(
        `INSERT INTO ai_audit_logs (id, user_id, feature, model_name, prompt_version, input_ref, tokens_used, raw_output)
         VALUES ($1, $2, 'proposal.evaluate', $3, $4, $5, 0, $6)`,
        [`AIA-${Date.now()}-${Math.floor(Math.random() * 1000)}`, authReq.user.userId, evaluation.model_name, evaluation.prompt_version, id,
         JSON.stringify({ overall: evaluation.overall_score, risk: evaluation.risk_score })]
      );
    });

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'PROPOSAL_AI_EVALUATED',
      entityType: 'PROPOSAL',
      entityId: id,
      details: {
        overallScore: evaluation.overall_score,
        isRecommendedTop3: evaluation.is_recommended_top3
      },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    const finalFlag = await db.query('SELECT is_recommended_top3 FROM ai_evaluations WHERE proposal_id = $1', [id]);
    evaluation.is_recommended_top3 = !!finalFlag.rows[0]?.is_recommended_top3;
    return reply.send({ success: true, evaluation });
  });

  // 4. Human Startup Selection for Pilot Execution (Spec Section 12)
  // A startup can withdraw its own proposal until it is selected
  app.post('/:id/withdraw', { preHandler: [authenticate, requireRole('startup')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const authReq = request as AuthenticatedRequest;
    const p = (await db.query('SELECT id, status, organization_id FROM proposals WHERE id = $1', [id])).rows[0];
    if (!p || p.organization_id !== authReq.user.organizationId) return reply.status(404).send({ error: 'Proposal not found' });
    if (!['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'AI_EVALUATED', 'SHORTLISTED', 'NOT_SHORTLISTED'].includes(p.status)) return reply.status(409).send({ error: `A proposal in status '${p.status}' cannot be withdrawn.` });
    await db.query(`UPDATE proposals SET status = 'WITHDRAWN', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
    await auditService.logEvent({ actorId: authReq.user.userId, actorName: authReq.user.name, actorRole: 'startup', action: 'PROPOSAL_WITHDRAWN', entityType: 'PROPOSAL', entityId: id, ipAddress: request.ip || '127.0.0.1', userAgent: request.headers['user-agent'] || 'Unknown' });
    return reply.send({ success: true });
  });

  app.post('/:id/select', { preHandler: [authenticate, requireRole('government', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { remarks } = request.body as { remarks: string };
    const authReq = request as AuthenticatedRequest;

    if (!remarks || remarks.trim().length < 10) {
      return reply.status(400).send({ error: 'A written official justification of at least 10 characters is mandatory for startup procurement selection.' });
    }

    const propRes = await db.query(
      `SELECT p.*, c.department_id, c.pilot_duration_months, c.kpis as challenge_kpis
       FROM proposals p
       JOIN challenges c ON p.challenge_id = c.id
       WHERE p.id = $1`,
      [id]
    );

    if (propRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Proposal not found' });
    }

    const proposal = propRes.rows[0];
    if (authReq.user.role === 'government' && authReq.user.departmentId && proposal.department_id !== authReq.user.departmentId) {
      return reply.status(403).send({ error: 'Forbidden: this proposal belongs to another department' });
    }
    if (['SELECTED', 'REJECTED', 'DRAFT', 'WITHDRAWN'].includes(proposal.status)) {
      return reply.status(409).send({ error: `A proposal in status '${proposal.status}' cannot be selected.` });
    }
    const alreadyPilot = await db.query(`SELECT id FROM pilots WHERE challenge_id = $1 AND status <> 'TERMINATED'`, [proposal.challenge_id]);
    if (alreadyPilot.rows.length > 0) {
      return reply.status(409).send({ error: 'A startup has already been selected for this challenge.', code: 'ALREADY_SELECTED' });
    }
    const pilotId = `PILOT-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;

    await db.transaction(async (tx) => {
      // 1. Mark proposal as SELECTED
      await tx.query(`UPDATE proposals SET status = 'SELECTED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

      // 2. Automatically seed pilot record in LAUNCHED state
      await tx.query(
        `INSERT INTO pilots (
          id, name, challenge_id, proposal_id, organization_id, startup_name,
          department_id, location, duration_months, contract_value_paise,
          original_contract_value_paise, baseline_summary, target_outcome, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'LAUNCHED')`,
        [
          pilotId,
          `${proposal.startup_name} - Pilot Implementation`,
          proposal.challenge_id,
          proposal.id,
          proposal.organization_id,
          proposal.startup_name,
          proposal.department_id,
          'Selected District Field Sites',
          proposal.pilot_duration_months || 3,
          proposal.pilot_cost_paise,
          proposal.pilot_cost_paise,
          'Pre-pilot baseline established in challenge specification',
          proposal.solution_title
        ]
      );

      // 3. Seed initial standard milestones
      const m1Amount = Math.floor(Number(proposal.pilot_cost_paise) * 0.3);
      const m2Amount = Math.floor(Number(proposal.pilot_cost_paise) * 0.4);
      const m3Amount = Number(proposal.pilot_cost_paise) - m1Amount - m2Amount;

      await tx.query(
        `INSERT INTO pilot_milestones (id, pilot_id, title, due_date, amount_paise, deliverable_description, status)
         VALUES
         ($1, $2, 'Milestone 1: Field Installation & Telemetry Activation', CURRENT_TIMESTAMP + INTERVAL '30 days', $3, 'Sensors/edge devices operational with live data streaming.', 'PENDING'),
         ($4, $5, 'Milestone 2: Interim Performance Validation', CURRENT_TIMESTAMP + INTERVAL '60 days', $6, '60 days operational data analyzed with inspector verification.', 'PENDING'),
         ($7, $8, 'Milestone 3: Final Outcome Demonstration & Scaling Report', CURRENT_TIMESTAMP + INTERVAL '90 days', $9, 'Final performance targets verified; scale-up dossier submitted.', 'PENDING')`,
        [
          `MS-${pilotId}-01`, pilotId, m1Amount,
          `MS-${pilotId}-02`, pilotId, m2Amount,
          `MS-${pilotId}-03`, pilotId, m3Amount
        ]
      );

      // 4. Seed the pilot KPIs from the challenge definition (baseline/target come from the officer, never invented)
      const kpiDefs: any[] = typeof proposal.challenge_kpis === 'string' ? JSON.parse(proposal.challenge_kpis) : (proposal.challenge_kpis || []);
      let i = 0;
      for (const k of kpiDefs) {
        i += 1;
        await tx.query(
          `INSERT INTO pilot_kpis (id, pilot_id, name, baseline_value, target_value, current_value, unit, measurement_method, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ON_TRACK')`,
          [`KPI-${pilotId}-${i}`, pilotId, k.name, String(k.baseline ?? 'n/a'), String(k.target ?? 'n/a'), String(k.baseline ?? 'n/a'), k.unit || null, k.measurementMethod || null]
        );
      }

      // 5. Move the challenge forward and tell the startup
      await tx.query(`UPDATE challenges SET status = 'PILOT_ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [proposal.challenge_id]);
      await tx.query(`UPDATE proposals SET status = 'NOT_SHORTLISTED', updated_at = CURRENT_TIMESTAMP WHERE challenge_id = $1 AND id <> $2 AND status IN ('SUBMITTED','UNDER_REVIEW','AI_EVALUATED')`, [proposal.challenge_id, id]);
      await tx.query(
        `INSERT INTO notifications (id, user_id, title, message, priority, action_link)
         SELECT $1, u.id, 'Your proposal was selected', $2, 'INFO', $3 FROM users u WHERE u.organization_id = $4`,
        [`NTF-${Date.now()}-${Math.floor(Math.random() * 1000)}`, `${proposal.solution_title} was selected for a pilot. Pilot ${pilotId} has been created.`, `/startup/pilots/${pilotId}`, proposal.organization_id]
      );
    });

    await auditService.logEvent({
      actorId: authReq.user.userId,
      actorName: authReq.user.name,
      actorRole: authReq.user.role,
      action: 'HUMAN_STARTUP_SELECTION_CONFIRMED',
      entityType: 'PROPOSAL',
      entityId: id,
      details: {
        pilotId,
        startupName: proposal.startup_name,
        writtenRemarks: remarks,
        advisoryStatement: 'AI recommendations are advisory. Selection confirmed by authorized government official.'
      },
      ipAddress: request.ip || '127.0.0.1',
      userAgent: request.headers['user-agent'] || 'Unknown'
    });

    return reply.send({
      success: true,
      pilotId,
      message: `Startup ${proposal.startup_name} explicitly selected for pilot execution. Pilot docket ${pilotId} created.`
    });
  });
}
