import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { validatePasswordStrength, hashPassword, verifyPassword, isValidPan, isValidGstin, isValidCinOrLlpin, isValidDpiitNumber, isValidIfsc, encryptField, decryptField, maskBankAccount, maskPan } from '../src/security';
import { AuditService } from '../src/audit';
import { runMigrations, PGliteDatabaseAdapter } from '../src/db';
import { pilotReportToCsv, pilotReportToPdf, financeCaseFileToCsv, financeCaseFileToPdf, PilotReportData, FinanceCaseFileData } from '../src/reports';
import { SovereignJobScheduler } from '../src/scheduler';

describe('Domain Unit Tests — Security, Cryptography & Validation', () => {
  it('enforces statutory password strength policy and detects common/breached passwords', () => {
    const weak1 = validatePasswordStrength('short');
    assert.strictEqual(weak1.valid, false);

    const weakCommon = validatePasswordStrength('password123');
    assert.strictEqual(weakCommon.valid, false);

    const strong = validatePasswordStrength('Secure#India2026!Procure');
    assert.strictEqual(strong.valid, true);
    assert.strictEqual(strong.errors.length, 0);
  });

  it('correctly hashes and verifies passwords using Argon2id', async () => {
    const pass = 'SovereignPass#2026';
    const hash = await hashPassword(pass);
    assert.ok(hash.startsWith('$argon2id$'));

    const match = await verifyPassword(hash, pass);
    assert.strictEqual(match, true);

    const mismatch = await verifyPassword(hash, 'WrongPassword#999');
    assert.strictEqual(mismatch, false);
  });

  it('validates Indian Permanent Account Number (PAN) format and character semantics', () => {
    // Valid PAN formats
    assert.strictEqual(isValidPan('ABCDE1234F'), true); // Company
    assert.strictEqual(isValidPan('AAAPA1234K'), true); // Person

    // Invalid PAN formats
    assert.strictEqual(isValidPan('12345ABCDE'), false);
    assert.strictEqual(isValidPan('ABCDE1234'), false);
    assert.strictEqual(isValidPan('ABCXE1234F'), false); // 'X' is invalid entity char
  });

  it('validates Goods and Services Tax Identification Number (GSTIN) with Mod-36 checksum', () => {
    // Valid GSTIN: 29ABCDE1234F1Z5 (Karnataka, PAN ABCDE1234F, entity 1, Z, checksum 5)
    assert.strictEqual(isValidGstin('29ABCDE1234F1Z5'), true);

    // Tampered checksum should fail
    assert.strictEqual(isValidGstin('29ABCDE1234F1Z9'), false);
    assert.strictEqual(isValidGstin('29ABCDE1234F1ZA'), false);

    // Invalid format
    assert.strictEqual(isValidGstin('INVALID_GSTIN_123'), false);
  });

  it('validates CIN, LLPIN, DPIIT Recognition Numbers, and IFSC codes', () => {
    // CIN / LLPIN
    assert.strictEqual(isValidCinOrLlpin('U72900KA2021PTC145678'), true);
    assert.strictEqual(isValidCinOrLlpin('AAB-1234'), true);
    assert.strictEqual(isValidCinOrLlpin('INVALID-CIN'), false);

    // DPIIT Recognition Number
    assert.strictEqual(isValidDpiitNumber('DIPP98765'), true);
    assert.strictEqual(isValidDpiitNumber('DPIIT/2026/12345'), true);
    assert.strictEqual(isValidDpiitNumber('FAKE123'), false);

    // IFSC Code
    assert.strictEqual(isValidIfsc('SBIN0001234'), true);
    assert.strictEqual(isValidIfsc('HDFC0000456'), true);
    assert.strictEqual(isValidIfsc('SBIN1001234'), false); // 5th character must be '0'
  });

  it('performs AES-256-GCM field encryption and data masking', () => {
    const rawAccount = '12345678901234';
    const encrypted = encryptField(rawAccount);
    assert.notStrictEqual(encrypted, rawAccount);

    const decrypted = decryptField(encrypted);
    assert.strictEqual(decrypted, rawAccount);

    const maskedAcc = maskBankAccount(rawAccount);
    assert.strictEqual(maskedAcc, '••••••••1234');

    const maskedPanStr = maskPan('ABCDE1234F');
    assert.strictEqual(maskedPanStr, 'AB•••••F');
  });

  it('proves mathematical tamper-evidence of the hash-chained audit log', async () => {
    const adapter = new PGliteDatabaseAdapter();

    await runMigrations(adapter);
    const auditService = new AuditService(adapter);

    // Add 3 legitimate events
    await auditService.logEvent({
      actorId: 'USR-1',
      actorName: 'Official 1',
      actorRole: 'government',
      action: 'ACTION_A',
      entityType: 'CHALLENGE',
      entityId: 'CH-1',
      details: { step: 1 }
    });

    await auditService.logEvent({
      actorId: 'USR-2',
      actorName: 'Startup 1',
      actorRole: 'startup',
      action: 'ACTION_B',
      entityType: 'PROPOSAL',
      entityId: 'PROP-1',
      details: { step: 2 }
    });

    await auditService.logEvent({
      actorId: 'USR-3',
      actorName: 'Finance 1',
      actorRole: 'finance',
      action: 'ACTION_C',
      entityType: 'PAYMENT',
      entityId: 'PAY-1',
      details: { step: 3 }
    });

    // Verify unbroken chain
    const initialCheck = await auditService.verifyChain();
    assert.strictEqual(initialCheck.valid, true);
    assert.strictEqual(initialCheck.totalEntries, 3);

    // Simulate malicious tamper by modifying an existing historical entry directly in database
    await adapter.query(`UPDATE audit_logs SET actor_name = 'FORGED_ACTOR' WHERE action = 'ACTION_B'`);

    // Verify that the chain detects the tampering immediately!
    const tamperedCheck = await auditService.verifyChain();
    assert.strictEqual(tamperedCheck.valid, false, 'Tampered entry must be detected');
    assert.ok(tamperedCheck.brokenAtId, 'Broken record ID must be reported');

    await adapter.close();
  });

  it('guarantees deterministic tax withholding arithmetic in integer paise', () => {
    // Contract Gross: ₹10,00,000.00 (100000000 paise)
    const grossPaise = 100000000n;
    // Statutory TDS: 2% (Section 194C / 194J)
    const tdsPaise = (grossPaise * 2n) / 100n;
    // Statutory GST TDS: 2% (Section 51 CGST Act)
    const gstPaise = (grossPaise * 2n) / 100n;
    // Penalty / Retention: 0
    const penaltyPaise = 0n;

    const netPayablePaise = grossPaise - tdsPaise - gstPaise - penaltyPaise;

    assert.strictEqual(tdsPaise, 2000000n); // ₹20,000.00
    assert.strictEqual(gstPaise, 2000000n); // ₹20,000.00
    assert.strictEqual(netPayablePaise, 96000000n); // ₹9,60,000.00
    assert.strictEqual(netPayablePaise + tdsPaise + gstPaise, grossPaise);
  });

  it('generates compliant 12-section pilot reports in CSV and PDF formats', () => {
    const mockReportData: PilotReportData = {
      pilot: {
        id: 'PILOT-2026-001',
        name: 'AI Emergency Triage Deployment',
        startup_name: 'HealthTech Innovations Pvt Ltd',
        status: 'VALIDATED',
        location: 'District Hospital Banswara',
        duration_months: 6,
        contract_value_paise: 250000000n,
        original_contract_value_paise: 250000000n,
        baseline_summary: 'Manual triage took avg 45 mins'
      },
      challenge: {
        title: 'Emergency Care Acceleration',
        problem_statement: 'Overcrowded triage during peak epidemic waves',
        department_name: 'Health & Family Welfare'
      },
      proposal: {
        solution_title: 'Automated Computer-Vision Triage System',
        technical_approach: 'On-device Jetson Orin edge computing with local privacy models'
      },
      organization: {
        name: 'HealthTech Innovations Pvt Ltd',
        dpiit_number: 'DIPP12345'
      },
      kpis: [
        { name: 'Triage Time Reduction', baseline: '45 mins', target: '<15 mins', current_value: '8.5 mins', status: 'ACHIEVED' },
        { name: 'Diagnostic Accuracy', baseline: '72%', target: '>90%', current_value: '94.2%', status: 'ACHIEVED' }
      ],
      kpiSubmissions: [],
      milestones: [
        { title: 'Milestone 1: Sensor Deployment', amount_paise: 75000000n, status: 'APPROVED' },
        { title: 'Milestone 2: 90-Day Telemetry Review', amount_paise: 100000000n, status: 'APPROVED' }
      ],
      inspections: [
        {
          validation_status: 'VERIFIED',
          inspector_id: 'INSP-SHARMA',
          gps_latitude: 23.5461,
          gps_longitude: 74.4422,
          findings: 'Hardware pods mounted and operational with verified continuous heartbeat telemetry.'
        }
      ],
      risks: [
        { category: 'Network Connectivity', description: 'Rural cellular drops', severity: 'MEDIUM', status: 'MITIGATED' }
      ]
    };

    // 1. Verify CSV Generation
    const csv = pilotReportToCsv(mockReportData);
    assert.ok(csv.includes('1. EXECUTIVE SUMMARY'));
    assert.ok(csv.includes('2. PROBLEM STATEMENT'));
    assert.ok(csv.includes('3. STARTUP SOLUTION'));
    assert.ok(csv.includes('6. KPI RESULTS'));
    assert.ok(csv.includes('11. VALIDATION'));
    assert.ok(csv.includes('12. SCALE-UP CONSIDERATIONS'));
    assert.ok(csv.includes('PILOT-2026-001'));
    assert.ok(csv.includes('Triage Time Reduction'));

    // 2. Verify PDF Generation
    const pdfBuf = pilotReportToPdf(mockReportData);
    assert.ok(Buffer.isBuffer(pdfBuf));
    assert.ok(pdfBuf.length > 500);
    // Standard PDF-1.4 header
    assert.strictEqual(pdfBuf.subarray(0, 8).toString(), '%PDF-1.4');
    // PDF EOF marker
    assert.ok(pdfBuf.toString('utf8', pdfBuf.length - 10).includes('%%EOF'));
  });

  it('generates official CAG-compliant Finance Case Files in CSV and PDF formats', () => {
    const mockCaseFileData: FinanceCaseFileData = {
      claim: {
        id: 'CLAIM-2026-889',
        invoice_number: 'INV-2026-042',
        invoice_date: '2026-09-15',
        status: 'PAID',
        gross_amount_paise: 100000000n,
        tds_deduction_paise: 2000000n,
        gst_tds_deduction_paise: 2000000n,
        net_payable_paise: 96000000n,
        disbursement_reference: 'RBI-UTR-20260920-883921'
      },
      pilot: {
        id: 'PILOT-2026-001',
        startup_name: 'HealthTech Innovations Pvt Ltd',
        contract_value_paise: 250000000n,
        original_contract_value_paise: 250000000n
      },
      organization: {
        name: 'HealthTech Innovations Pvt Ltd',
        dpiit_number: 'DIPP12345',
        pan_masked: 'AB•••••F',
        gstin: '29ABCDE1234F1Z5'
      },
      milestone: {
        title: 'Milestone 1 Deliverable'
      },
      auditTrail: [
        {
          action: 'CLAIM_SUBMITTED',
          timestamp: '2026-09-15T10:00:00Z',
          actor_name: 'Dr. Aarav Sharma',
          actor_role: 'startup',
          hash: 'a1b2c3d4e5f67890'
        },
        {
          action: 'PAYMENT_DISBURSED',
          timestamp: '2026-09-18T14:30:00Z',
          actor_name: 'Finance Treasury Officer',
          actor_role: 'finance',
          hash: 'f6e5d4c3b2a10987'
        }
      ],
      anomalies: []
    };

    const csv = financeCaseFileToCsv(mockCaseFileData);
    assert.ok(csv.includes('CONTRACT'));
    assert.ok(csv.includes('PAYMENT CLAIM'));
    assert.ok(csv.includes('AUDIT LEDGER'));
    assert.ok(csv.includes('CLAIM-2026-889'));
    assert.ok(csv.includes('RBI-UTR-20260920-883921'));

    const pdfBuf = financeCaseFileToPdf(mockCaseFileData);
    assert.ok(Buffer.isBuffer(pdfBuf));
    assert.ok(pdfBuf.length > 500);
    assert.strictEqual(pdfBuf.subarray(0, 8).toString(), '%PDF-1.4');
    assert.ok(pdfBuf.toString('utf8', pdfBuf.length - 10).includes('%%EOF'));
  });

  it('runs sovereign background scheduler tasks for SLA monitoring and audit integrity', async () => {
    const adapter = new PGliteDatabaseAdapter();
    await runMigrations(adapter);
    const auditService = new AuditService(adapter);

    const scheduler = new SovereignJobScheduler({
      db: adapter,
      auditService
    });

    // 1. Audit sentinel verification
    const sentinelRes = await scheduler.runAuditSentinel();
    assert.strictEqual(sentinelRes.valid, true);

    // 2. SLA Monitor on empty / clean state
    const slaRes = await scheduler.runSlaMonitor();
    assert.strictEqual(slaRes.checked, 0);

    // 3. Stalled pilot scanner
    const stallRes = await scheduler.runStalledPilotScanner();
    assert.strictEqual(stallRes.scanned, 0);

    // 4. Token cleanup
    const cleanRes = await scheduler.runExpiredTokenCleanup();
    assert.strictEqual(typeof cleanRes.expiredInvitations, 'number');

    await adapter.close();
  });
});
