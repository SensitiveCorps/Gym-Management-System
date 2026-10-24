import express from 'express';
import { readFile } from 'node:fs/promises';
import { transaction, one, rows } from './database.mjs';
import {
  UserError,
  text,
  id,
  token,
  hashToken,
  hashPassword,
  verifyPassword,
} from './security.mjs';
import { executeAction, authorize } from './actions.mjs';
import { applicationState, memberData, reportData } from './state.mjs';
import { paymentPreview } from './payments.mjs';

export async function createApp(pool, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxy) app.set('trust proxy', 1);
  const idle = options.idleMinutes || 15,
    lock = options.lockMinutes || 15,
    production = options.production === true;
  const policy = {
    timezone: 'Africa/Mbabane',
    inclusiveExpiry: true,
    expiryPolicyApproved: options.expiryPolicyApproved === true,
    idleMinutes: idle,
    lockMinutes: lock,
    autoCheckout: options.autoCheckout === true,
  };
  const dummyHash = await hashPassword(token()),
    attempts = new Map();
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
    });
    if (production) {
      res.set('Strict-Transport-Security', 'max-age=31536000');
      if (!req.secure)
        return res.status(400).json({ error: 'HTTPS is required.' });
    }
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      req.get('origin') &&
      req.get('origin') !==
        (options.origin || `${req.protocol}://${req.get('host')}`)
    )
      return res.status(403).json({ error: 'Untrusted request origin.' });
    next();
  });
  app.use(express.json({ limit: '4mb', strict: true }));
  async function actorFor(req, { touch = true } = {}) {
    const cookie = (req.headers.cookie || '')
      .split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('gms_session='))
      ?.slice(12);
    if (!cookie || !/^[a-f0-9]{64}$/.test(cookie)) return null;
    const session = await one(
      pool,
      `SELECT x.*,s.username,s.role,s.is_enabled,m.must_change_password FROM gms_sessions x
   LEFT JOIN staff_accounts s ON s.staff_account_id=x.staff_id LEFT JOIN members m ON m.member_id=x.member_id
   WHERE token_hash=$1 AND expires_at>NOW() AND touched_at>NOW()-($2::integer*INTERVAL '1 minute')`,
      [hashToken(cookie), idle],
    );
    if (!session || (session.staff_id && !session.is_enabled)) return null;
    if (touch)
      await pool.query(
        'UPDATE gms_sessions SET touched_at=NOW() WHERE token_hash=$1',
        [session.token_hash],
      );
    return {
      id: String(session.staff_id || session.member_id),
      staffId: session.staff_id ? String(session.staff_id) : null,
      role: session.staff_id ? session.role.toLowerCase() : 'member',
      username: session.username,
      tokenHash: session.token_hash,
      csrf: session.csrf_token,
      mustChangePassword: !!session.must_change_password,
    };
  }
  async function auth(req, res, next) {
    req.actor = await actorFor(req);
    if (!req.actor)
      return res.status(401).json({ error: 'Sign in again to continue.' });
    next();
  }
  function csrf(req, res, next) {
    if (req.get('x-csrf-token') !== req.actor.csrf)
      return res
        .status(403)
        .json({ error: 'Invalid request token. Reload the page.' });
    next();
  }
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: production,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  };
  app.post('/api/login', async (req, res) => {
    const key = req.ip || 'local',
      now = Date.now(),
      bucket = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (bucket.until < now) {
      bucket.count = 0;
      bucket.until = now + 15 * 60 * 1000;
    }
    bucket.count++;
    attempts.set(key, bucket);
    if (attempts.size > 10000) attempts.delete(attempts.keys().next().value);
    if (bucket.count > 30)
      throw new UserError('Too many login attempts. Try later.', 429);
    const d = req.body || {};
    if (!['member', 'staff', 'manager'].includes(d.role))
      throw new UserError('Choose a valid sign-in tab.');
    const raw = token(),
      csrfToken = token();
    const result = await transaction(pool, async (db) => {
      let account;
      if (d.role === 'member')
        account = await one(
          db,
          'SELECT * FROM members WHERE id_type=$1 AND LOWER(id_number)=LOWER($2) FOR UPDATE',
          [
            {
              'Student ID': 'STUDENT_ID',
              'National ID': 'NATIONAL_ID',
              Passport: 'PASSPORT',
              'Birth certificate': 'BIRTH_CERTIFICATE',
            }[d.idType] || '',
            text(d.idNum, 'ID number', 100),
          ],
        );
      else
        account = await one(
          db,
          'SELECT * FROM staff_accounts WHERE LOWER(username)=LOWER($1) FOR UPDATE',
          [text(d.username, 'Username', 60)],
        );
      if (account?.locked_until && new Date(account.locked_until) > new Date())
        return {
          error: 'This account is temporarily locked. Try later or ask staff.',
          status: 429,
        };
      const valid = await verifyPassword(
        d.password,
        account?.password_hash || dummyHash,
      );
      if (!account || !valid) {
        if (account && d.role === 'member')
          await db.query(
            `UPDATE members SET failed_login_count=CASE WHEN locked_until IS NOT NULL AND locked_until<=NOW() THEN 1 ELSE failed_login_count+1 END,
    locked_until=CASE WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until<=NOW() THEN 1 ELSE failed_login_count+1 END)>=5 THEN NOW()+($2::integer*INTERVAL '1 minute') ELSE NULL END WHERE member_id=$1`,
            [account.member_id, lock],
          );
        return { error: 'The sign-in details are not correct.', status: 401 };
      }
      if (
        d.role !== 'member' &&
        (!account.is_enabled || account.role.toLowerCase() !== d.role)
      )
        return { error: 'The sign-in details are not correct.', status: 401 };
      if (d.role === 'member')
        await db.query('SELECT reset_member_login_failures($1)', [
          account.member_id,
        ]);
      await db.query(
        'INSERT INTO gms_sessions(token_hash,staff_id,member_id,csrf_token) VALUES($1,$2,$3,$4)',
        [
          hashToken(raw),
          account.staff_account_id || null,
          account.member_id || null,
          csrfToken,
        ],
      );
      if (d.role !== 'member')
        await db.query(
          'INSERT INTO staff_presence(staff_id,session_hash) VALUES($1,$2)',
          [account.staff_account_id, hashToken(raw)],
        );
      return {
        session: {
          role: d.role,
          id:
            d.role === 'member' ? String(account.member_id) : account.username,
        },
      };
    });
    if (result.error)
      return res.status(result.status).json({ error: result.error });
    const previous = await actorFor(req, { touch: false });
    if (previous)
      await pool.query('DELETE FROM gms_sessions WHERE token_hash=$1', [
        previous.tokenHash,
      ]);
    res
      .cookie('gms_session', raw, cookieOptions)
      .json({ ...result, csrf: csrfToken });
  });
  app.post('/api/logout', auth, csrf, async (req, res) => {
    await transaction(pool, async (db) => {
      await db.query(
        'UPDATE staff_presence SET signed_out_at=NOW() WHERE session_hash=$1 AND signed_out_at IS NULL',
        [req.actor.tokenHash],
      );
      await db.query('DELETE FROM gms_sessions WHERE token_hash=$1', [
        req.actor.tokenHash,
      ]);
    });
    res.clearCookie('gms_session', cookieOptions).json({});
  });
  app.get('/api/public', async (req, res) =>
    res.json(await applicationState(pool, null, policy)),
  );
  app.get('/api/state', async (req, res) => {
    const actor = await actorFor(req);
    const state = await transaction(pool, async (db) => {
      await db.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      return applicationState(db, actor, policy);
    });
    res.json({
      state,
      csrf: actor?.csrf || null,
      session: actor
        ? {
            role: actor.role,
            id: actor.role === 'member' ? actor.id : actor.username,
          }
        : null,
    });
  });
  app.get('/api/members', auth, async (req, res) => {
    authorize(req.actor, 'memberedit');
    const q = text(req.query.q, 'Search', 100),
      found = await rows(
        pool,
        "SELECT member_id FROM members WHERE LOWER(first_name||' '||surname) LIKE '%'||LOWER($1)||'%' OR LOWER(id_number) LIKE '%'||LOWER($1)||'%' ORDER BY surname,first_name,member_id LIMIT 50",
        [q],
      );
    res.json(
      await memberData(
        pool,
        req.actor,
        found.map((m) => m.member_id),
      ),
    );
  });
  app.get('/api/members/:id/photo', auth, async (req, res) => {
    authorize(req.actor, 'memberedit');
    const record = await one(
      pool,
      'SELECT photo_bytes FROM members WHERE member_id=$1',
      [id(req.params.id)],
    );
    if (!record?.photo_bytes)
      return res.status(404).json({ error: 'No photo is available.' });
    res.type('jpeg').send(Buffer.from(record.photo_bytes));
  });
  app.get('/api/members/:id', auth, async (req, res) => {
    if (req.actor.role === 'member' && id(req.params.id) !== req.actor.id)
      throw new UserError('You may only view your own record.', 403);
    if (req.actor.role !== 'member') authorize(req.actor, 'memberedit');
    if (req.actor.mustChangePassword)
      throw new UserError('Change your temporary password first.', 403);
    const data = await memberData(pool, req.actor, [id(req.params.id)], {
      history: true,
    });
    if (!data.members.length) throw new UserError('Member not found.', 404);
    res.json(data);
  });
  app.get('/api/manager/reports', auth, async (req, res) => {
    authorize(req.actor, 'plans');
    res.json(await reportData(pool));
  });
  app.get('/api/payments/preview', auth, async (req, res) => {
    authorize(req.actor, 'renew');
    const preview = await transaction(pool, async (db) => {
      await db.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      return paymentPreview(db, req.query.planId, req.query.memberId ?? null);
    });
    res.json(preview);
  });
  app.get('/api/manager/dashboard', auth, async (req, res) => {
    authorize(req.actor, 'plans');
    res.json({
      summary: await one(pool, 'SELECT * FROM v_manager_dashboard'),
      weekly: await rows(pool, 'SELECT * FROM v_weekly_checkins'),
      monthly: await rows(pool, 'SELECT * FROM v_monthly_checkins'),
    });
  });
  app.post('/api/actions/:action', auth, csrf, async (req, res) => {
    const action = req.params.action;
    authorize(req.actor, action);
    const key = req.get('idempotency-key');
    if (!key || !/^[a-zA-Z0-9-]{16,100}$/.test(key))
      throw new UserError('A valid request key is required.');
    const data = req.body || {},
      fingerprint = hashToken(action + '\n' + JSON.stringify(data)),
      actorKey = req.actor.role + ':' + req.actor.id;
    const result = await transaction(pool, async (db) => {
      // Recheck account authorization inside the transaction; UI role/actor IDs are never trusted.
      const liveSession = await one(
        db,
        "SELECT token_hash FROM gms_sessions WHERE token_hash=$1 AND expires_at>NOW() AND touched_at>NOW()-($2::integer*INTERVAL '1 minute') FOR SHARE",
        [req.actor.tokenHash, idle],
      );
      if (!liveSession) throw new UserError('Sign in again to continue.', 401);
      if (req.actor.staffId) {
        const live = await one(
          db,
          'SELECT role,is_enabled FROM staff_accounts WHERE staff_account_id=$1 FOR SHARE',
          [req.actor.staffId],
        );
        if (!live?.is_enabled || live.role.toLowerCase() !== req.actor.role)
          throw new UserError('This account is no longer authorized.', 403);
      }
      await db.query(
        'INSERT INTO gms_requests(actor,request_key,fingerprint) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [actorKey, key, fingerprint],
      );
      const previous = await one(
        db,
        'SELECT * FROM gms_requests WHERE actor=$1 AND request_key=$2 FOR UPDATE',
        [actorKey, key],
      );
      if (previous.fingerprint !== fingerprint)
        throw new UserError(
          'This request key was already used for different input.',
          409,
        );
      if (previous.result !== null) return previous.result;
      const value = await executeAction(db, req.actor, action, data);
      await db.query(
        'UPDATE gms_requests SET result=$3 WHERE actor=$1 AND request_key=$2',
        [actorKey, key, JSON.stringify(value)],
      );
      return value;
    });
    res.json(result);
  });
  const bridge = await readFile(
    new URL('../../frontend/public/server-bridge.js', import.meta.url),
    'utf8',
  );
  const template = (
    await readFile(
      new URL('../../frontend/public/index.html', import.meta.url),
      'utf8',
    )
  ).replace(
    '/* ---------- events ---------- */',
    bridge + '\n/* ---------- events ---------- */',
  );
  app.get('/', (req, res) => {
    const nonce = token();
    res.set(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    );
    res
      .type('html')
      .send(
        template.replace(
          '<script>',
          `<script nonce="${nonce}">\nwindow.GMS_API_MODE=true;`,
        ),
      );
  });
  app.use((req, res) =>
    res.status(404).json({ error: 'This route does not exist.' }),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error.status || 500,
      message = error.status
        ? error.message
        : 'The request could not be completed. Try again.';
    if (error.code === '23505') {
      status = 409;
      message =
        'That identity, username, plan name or receipt number already exists.';
    }
    if (['23514', '23503', '22P02', '22007', '22008'].includes(error.code)) {
      status = 400;
      message = 'The supplied record values are not valid.';
    }
    if (error.code === 'P0001') {
      status = 409;
      message = /Receipt/.test(error.message)
        ? 'The receipt belongs to another payment.'
        : 'The record changed or the operation is not allowed. Refresh and try again.';
    }
    if (error.type === 'entity.parse.failed') {
      status = 400;
      message = 'Send a valid JSON request.';
    }
    if (error.type === 'entity.too.large') {
      status = 413;
      message = 'The upload is too large.';
    }
    if (status === 500 && options.onError) options.onError(error);
    res.status(status).json({ error: message });
  });
  return app;
}
