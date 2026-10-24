import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { createPool } from '../src/database.mjs';
import { createApp } from '../src/app.mjs';
import { hashPassword, verifyPassword } from '../src/security.mjs';
import { maintenance } from '../src/maintenance.mjs';

let pool, engine, server, base, manager, staff, member, photo, ids;
async function query(sql, args = []) {
  return (await pool.query(sql, args)).rows;
}
async function call(
  path,
  { session, method = 'GET', body, key = randomUUID(), headers = {} } = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(session
        ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf }
        : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'Idempotency-Key': key,
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.headers.get('content-type')?.includes('json')
    ? await response.json()
    : await response.arrayBuffer();
  return { status: response.status, data, headers: response.headers };
}
async function login(role, username, password = 'StaffPass123!') {
  const body =
    role === 'member'
      ? { role, idType: 'Student ID', idNum: username, password }
      : { role, username, password };
  const response = await call('/api/login', { method: 'POST', body });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return {
    cookie: response.headers.get('set-cookie').split(';')[0],
    csrf: response.data.csrf,
  };
}
const action = async (name, body, session = manager, key) => {
  if (['register', 'renew'].includes(name) && body.expected === undefined) {
    const p = (
      await query('SELECT price,duration_days FROM plans WHERE plan_id=$1', [
        body.plan,
      ])
    )[0];
    const latest =
      name === 'renew'
        ? (
            await query(
              'SELECT resulting_expiry_date::text AS expiry FROM payments WHERE member_id=$1 ORDER BY payment_id DESC LIMIT 1',
              [body.id],
            )
          )[0]
        : null;
    body = {
      ...body,
      expected: {
        price: Number(p?.price),
        days: p?.duration_days,
        expiryBefore: latest?.expiry || null,
      },
    };
  }
  return call('/api/actions/' + name, { method: 'POST', body, session, key });
};

before(async () => {
  if (process.env.TEST_DATABASE_URL) {
    pool = createPool(process.env.TEST_DATABASE_URL);
    assert.equal(
      (await query("SELECT to_regclass('public.members') AS name"))[0].name,
      null,
      'TEST_DATABASE_URL must point to a new disposable database.',
    );
  } else {
    engine = new PGlite();
    let tail = Promise.resolve();
    const connect = async () => {
      let release;
      const previous = tail;
      tail = new Promise((resolve) => (release = resolve));
      await previous;
      return { query: (sql, args) => engine.query(sql, args), release };
    };
    pool = {
      connect,
      query: async (sql, args) => {
        const client = await connect();
        try {
          return await client.query(sql, args);
        } finally {
          client.release();
        }
      },
      end: () => engine.close(),
    };
  }
  for (const name of [
    '01_schema.sql',
    '02_logic_and_views.sql',
    '04_application.sql',
    '05_workflow_fixes.sql',
  ]) {
    const sql = await readFile(
      new URL('../../Database/database/' + name, import.meta.url),
      'utf8',
    );
    if (engine) await engine.exec(sql);
    else await pool.query(sql);
  }
  await pool.query("SET TIME ZONE 'Africa/Mbabane'");
  const hash = await hashPassword('StaffPass123!');
  const accounts = await query(
    "INSERT INTO staff_accounts(username,display_name,password_hash,role) VALUES('manager','Manager',$1,'MANAGER'),('desk','Desk',$1,'STAFF'),('other','Other staff',$1,'STAFF') RETURNING staff_account_id,username",
    [hash],
  );
  const plan = (
    await query(
      "INSERT INTO plans(plan_name,price,duration_days) VALUES('Monthly',250,30) RETURNING plan_id",
    )
  )[0];
  const svc = (
    await query(
      "INSERT INTO services(service_name,description) VALUES('Weights','Gym area') RETURNING service_id",
    )
  )[0];
  const bytes = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer();
  photo = 'data:image/png;base64,' + bytes.toString('base64');
  const people = await query(
    "INSERT INTO members(first_name,surname,id_type,id_number,photo_path,photo_bytes,password_hash) VALUES('One','Member','STUDENT_ID','MEMBER-ONE','database:protected-photo',$1,$2),('Two','Member','STUDENT_ID','MEMBER-TWO','database:protected-photo',$1,$2),('Old','Member','PASSPORT','OLD-MEMBER','database:protected-photo',NULL,$2) RETURNING member_id",
    [bytes, hash],
  );
  ids = {
    manager: String(accounts[0].staff_account_id),
    staff: String(accounts[1].staff_account_id),
    other: String(accounts[2].staff_account_id),
    plan: String(plan.plan_id),
    svc: String(svc.service_id),
    one: String(people[0].member_id),
    two: String(people[1].member_id),
    old: String(people[2].member_id),
  };
  await query("SELECT record_cash_payment($1,$2,'BASE-ONE',$3)", [
    ids.one,
    ids.plan,
    ids.staff,
  ]);
  await query("SELECT record_cash_payment($1,$2,'BASE-TWO',$3)", [
    ids.two,
    ids.plan,
    ids.staff,
  ]);
  await query(
    "SELECT record_cash_payment($1,$2,'BASE-OLD',$3,CURRENT_DATE-60)",
    [ids.old, ids.plan, ids.staff],
  );
  const app = await createApp(pool, {
    onError: (error) => console.error('Test server error:', error.message),
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  manager = await login('manager', 'manager');
  staff = await login('staff', 'desk');
  member = await login('member', 'MEMBER-ONE');
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await pool?.end();
});

test('passwords are salted hashes and verification rejects wrong values', async () => {
  const a = await hashPassword('SecretPass123!'),
    b = await hashPassword('SecretPass123!');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('SecretPass123!', a), true);
  assert.equal(await verifyPassword('wrong', a), false);
  assert.ok(!a.includes('SecretPass'));
});
test('public state exposes no members, passwords, photos, private staff or cash ledger', async () => {
  const result = await call('/api/state');
  assert.equal(result.status, 200);
  for (const key of [
    'members',
    'payments',
    'checkins',
    'denied',
    'staff',
    'audit',
  ])
    assert.deepEqual(result.data.state[key], []);
  assert.doesNotMatch(
    JSON.stringify(result.data),
    /password_hash|MEMBER-ONE|MEMBER-TWO|BASE-ONE|database:protected/,
  );
});
test('server serves the selected UI with API mode, nonce CSP and no cache', async () => {
  const result = await call('/');
  assert.equal(result.status, 200);
  const html = Buffer.from(result.data).toString();
  assert.match(html, /window.GMS_API_MODE=true/);
  assert.match(html, /async function serverSubmit/);
  assert.match(
    result.headers.get('content-security-policy'),
    /script-src 'nonce-/,
  );
  assert.equal(result.headers.get('cache-control'), 'no-store');
});
test('sessions use an HttpOnly cookie and hashed database tokens', async () => {
  const result = await call('/api/login', {
    method: 'POST',
    body: { role: 'staff', username: 'desk', password: 'StaffPass123!' },
  });
  assert.match(result.headers.get('set-cookie'), /HttpOnly/);
  assert.match(result.headers.get('set-cookie'), /SameSite=Strict/);
  const raw = result.headers.get('set-cookie').split(';')[0].split('=')[1];
  assert.equal(
    (
      await query(
        'SELECT COUNT(*)::int AS n FROM gms_sessions WHERE token_hash=$1',
        [raw],
      )
    )[0].n,
    0,
  );
});
test('private routes require sign-in and mutations require CSRF and request keys', async () => {
  assert.equal((await call('/api/manager/dashboard')).status, 401);
  assert.equal(
    (await action('plans', { plans: [] }, { ...manager, csrf: 'wrong' }))
      .status,
    403,
  );
  assert.equal(
    (
      await call('/api/actions/plans', {
        session: manager,
        method: 'POST',
        body: { plans: [] },
        key: 'short',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call('/api/login', {
        method: 'POST',
        body: { role: 'staff', username: 'desk', password: 'StaffPass123!' },
        headers: { Origin: 'https://evil.invalid' },
      })
    ).status,
    403,
  );
});
test('staff cannot mutate manager resources or request manager reports/dashboard', async () => {
  for (const name of [
    'plans',
    'notice',
    'hours',
    'newstaff',
    'staffreset',
    'contact',
    'service',
  ])
    assert.equal((await action(name, {}, staff)).status, 403, name);
  assert.equal(
    (await call('/api/manager/reports', { session: staff })).status,
    403,
  );
  assert.equal(
    (await call('/api/manager/dashboard', { session: staff })).status,
    403,
  );
});
test('member sees only own masked data and cannot fetch other members or any photo', async () => {
  const state = (await call('/api/state', { session: member })).data.state;
  assert.deepEqual(
    state.members.map((m) => m.id),
    [ids.one],
  );
  assert.notEqual(state.members[0].idNum, 'MEMBER-ONE');
  assert.equal(state.members[0].photo, null);
  assert.ok(state.payments.every((p) => p.memberId === ids.one));
  assert.equal(
    (await call('/api/members/' + ids.two, { session: member })).status,
    403,
  );
  assert.equal(
    (await call('/api/members/' + ids.one + '/photo', { session: member }))
      .status,
    403,
  );
  assert.equal(
    (await call('/api/members?q=Member', { session: member })).status,
    403,
  );
});
test('authorized staff search and protected photo route work without returning hashes or paths', async () => {
  const result = await call('/api/members?q=MEMBER-ONE', { session: staff });
  assert.equal(result.data.members[0].id, ids.one);
  assert.equal(
    (await call('/api/members/' + ids.one + '/photo', { session: staff }))
      .status,
    200,
  );
  assert.doesNotMatch(
    JSON.stringify(result.data),
    /password_hash|database:protected/,
  );
});
test('reports omit identity document numbers and photographs', async () => {
  const report = (await call('/api/manager/reports', { session: manager }))
    .data;
  assert.ok(report.length >= 3);
  assert.doesNotMatch(
    JSON.stringify(report),
    /MEMBER-ONE|MEMBER-TWO|photo|id_number|password|database:/,
  );
});
test('registration validates a plan and leaves no partial member or payment on failure', async () => {
  const before = await query(
    'SELECT (SELECT COUNT(*) FROM members) AS m,(SELECT COUNT(*) FROM payments) AS p',
  );
  const result = await action(
    'register',
    {
      first: 'Test',
      sur: 'Invalid',
      idType: 'Passport',
      idNum: 'INVALID-PLAN',
      password: 'MemberPass123!',
      photo,
      plan: '999999',
      receipt: 'TEST-INVALID',
    },
    staff,
  );
  assert.equal(result.status, 409);
  assert.deepEqual(
    await query(
      'SELECT (SELECT COUNT(*) FROM members) AS m,(SELECT COUNT(*) FROM payments) AS p',
    ),
    before,
  );
});
test('malformed photo bytes are rejected by the server decoder', async () => {
  const result = await action(
    'register',
    {
      first: 'Test',
      sur: 'Image',
      idType: 'Passport',
      idNum: 'BAD-PHOTO',
      password: 'MemberPass123!',
      photo: 'data:image/png;base64,AAAA',
      plan: ids.plan,
      receipt: 'BAD-PHOTO',
    },
    staff,
  );
  assert.equal(result.status, 400);
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS n FROM members WHERE id_number='BAD-PHOTO'",
      )
    )[0].n,
    0,
  );
});
test('registration and retry commit exactly one member, protected photo and cash receipt', async () => {
  const key = randomUUID(),
    payload = {
      first: 'New',
      sur: 'Member',
      idType: 'Passport',
      idNum: 'NEW-REGISTRATION',
      password: 'MemberPass123!',
      photo,
      plan: ids.plan,
      receipt: 'NEW-REGISTRATION',
    };
  const result = await action('register', payload, staff, key);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual(
    (await action('register', payload, staff, key)).data,
    result.data,
  );
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS n FROM members WHERE id_number='NEW-REGISTRATION'",
      )
    )[0].n,
    1,
  );
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS n FROM payments WHERE receipt_number='NEW-REGISTRATION'",
      )
    )[0].n,
    1,
  );
  assert.equal(
    (await action('register', { ...payload, idNum: 'DIFFERENT' }, staff, key))
      .status,
    409,
  );
});
test('duplicate receipt rolls back a newly inserted registration including its photo', async () => {
  const result = await action(
    'register',
    {
      first: 'Duplicate',
      sur: 'Receipt',
      idType: 'Passport',
      idNum: 'ROLLBACK-MEMBER',
      password: 'MemberPass123!',
      photo,
      plan: ids.plan,
      receipt: 'base-one',
    },
    staff,
  );
  assert.equal(result.status, 409);
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS n FROM members WHERE id_number='ROLLBACK-MEMBER'",
      )
    )[0].n,
    0,
  );
});
test('new membership uses inclusive dates, and renewal/retry never adds days twice', async () => {
  const initial = (
    await query(
      "SELECT resulting_expiry_date=CURRENT_DATE+29 AS correct FROM payments WHERE receipt_number='BASE-ONE'",
    )
  )[0];
  assert.equal(initial.correct, true);
  const expiryBefore = (
    await query(
      'SELECT resulting_expiry_date::text AS expiry FROM payments WHERE member_id=$1 ORDER BY payment_id DESC LIMIT 1',
      [ids.one],
    )
  )[0].expiry;
  const key = randomUUID(),
    payload = {
      id: ids.one,
      plan: ids.plan,
      receipt: 'RENEW-ONCE',
      expected: { price: 250, days: 30, expiryBefore },
    };
  assert.equal((await action('renew', payload, staff, key)).status, 200);
  assert.equal((await action('renew', payload, staff, key)).status, 200);
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS n FROM payments WHERE receipt_number='RENEW-ONCE'",
      )
    )[0].n,
    1,
  );
  assert.equal(
    (
      await query(
        "SELECT resulting_expiry_date=CURRENT_DATE+59 AS correct FROM payments WHERE receipt_number='RENEW-ONCE'",
      )
    )[0].correct,
    true,
  );
});
test('invalid plan values fail, edits preserve purchased name, amount and duration snapshots', async () => {
  assert.equal(
    (
      await action('plans', {
        plans: [
          { id: ids.plan, name: 'Monthly', price: -1, days: 1.5, on: true },
        ],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await action('plans', {
        plans: [
          {
            id: ids.plan,
            name: 'Changed monthly',
            price: 400,
            days: 60,
            on: false,
          },
        ],
      })
    ).status,
    200,
  );
  const p = (
    await query(
      "SELECT plan_name_snapshot,duration_days_snapshot,amount FROM payments WHERE receipt_number='BASE-ONE'",
    )
  )[0];
  assert.equal(p.plan_name_snapshot, 'Monthly');
  assert.equal(p.duration_days_snapshot, 30);
  assert.equal(Number(p.amount), 250);
  // A lost response may be retried even after retirement without charging again.
  assert.equal(
    (
      await action(
        'renew',
        { id: ids.one, plan: ids.plan, receipt: 'RENEW-ONCE' },
        staff,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await action(
        'renew',
        { id: ids.one, plan: ids.plan, receipt: 'UNAVAILABLE' },
        staff,
      )
    ).status,
    409,
  );
  await action('plans', {
    plans: [{ id: ids.plan, name: 'Monthly', price: 250, days: 30, on: true }],
  });
});
test('missing stored photo cannot be bypassed by a true confirmation flag', async () => {
  const saved = (
    await query('SELECT photo_bytes FROM members WHERE member_id=$1', [ids.one])
  )[0].photo_bytes;
  await query('UPDATE members SET photo_bytes=NULL WHERE member_id=$1', [
    ids.one,
  ]);
  const r = await action(
    'checkin',
    { memberId: ids.one, entered: 'MEMBER-ONE', confirmed: true },
    staff,
  );
  assert.equal(r.data.accepted, false);
  assert.equal(r.data.reason, 'PHOTO_NOT_CONFIRMED');
  await query('UPDATE members SET photo_bytes=$2 WHERE member_id=$1', [
    ids.one,
    saved,
  ]);
});
test('check-in, duplicate denial and checkout use the authenticated staff actor', async () => {
  const entry = await action(
    'checkin',
    {
      memberId: ids.one,
      entered: 'MEMBER-ONE',
      confirmed: true,
      staffId: ids.manager,
    },
    staff,
  );
  assert.equal(entry.data.accepted, true);
  assert.equal(
    (
      await action(
        'checkin',
        { memberId: ids.one, entered: 'MEMBER-ONE', confirmed: true },
        staff,
      )
    ).data.reason,
    'ALREADY_INSIDE',
  );
  assert.equal(
    (await action('checkout', { id: ids.one }, manager)).status,
    200,
  );
  const row = (
    await query(
      'SELECT confirmed_by,checked_out_by,checkout_method FROM checkins WHERE checkin_id=$1',
      [entry.data.checkin_id],
    )
  )[0];
  assert.equal(String(row.confirmed_by), ids.staff);
  assert.equal(String(row.checked_out_by), ids.manager);
  assert.equal(row.checkout_method, 'MANUAL');
});
test('expired and unknown entries are retained as denials without visits', async () => {
  assert.equal(
    (
      await action(
        'checkin',
        { memberId: ids.old, entered: 'OLD-MEMBER', confirmed: true },
        staff,
      )
    ).data.reason,
    'EXPIRED',
  );
  assert.equal(
    (
      await action(
        'checkin',
        { memberId: null, entered: 'UNKNOWN-ID', confirmed: false },
        staff,
      )
    ).data.reason,
    'UNKNOWN_ID',
  );
});
test('suspension/re-enable preserve history and paid dashboard counts', async () => {
  const counts = await query(
    'SELECT (SELECT COUNT(*) FROM members) AS m,(SELECT COUNT(*) FROM payments) AS p,(SELECT COUNT(*) FROM checkins) AS c,(SELECT COUNT(*) FROM denied_attempts) AS d',
  );
  const dash = (await call('/api/manager/dashboard', { session: manager })).data
    .summary;
  assert.equal(
    (await action('memberstatus', { ids: [ids.one], enabled: false }, staff))
      .status,
    200,
  );
  assert.deepEqual(
    (await call('/api/manager/dashboard', { session: manager })).data.summary,
    dash,
  );
  assert.deepEqual(
    await query(
      'SELECT (SELECT COUNT(*) FROM members) AS m,(SELECT COUNT(*) FROM payments) AS p,(SELECT COUNT(*) FROM checkins) AS c,(SELECT COUNT(*) FROM denied_attempts) AS d',
    ),
    counts,
  );
  assert.equal(
    (
      await action(
        'checkin',
        { memberId: ids.one, entered: 'MEMBER-ONE', confirmed: true },
        staff,
      )
    ).data.reason,
    'SUSPENDED',
  );
  assert.equal(
    (await action('memberstatus', { ids: [ids.one], enabled: true }, staff))
      .status,
    200,
  );
});
test('physical deletion and financial/denial mutation are blocked in PostgreSQL', async () => {
  await assert.rejects(
    pool.query('DELETE FROM members WHERE member_id=$1', [ids.one]),
  );
  await assert.rejects(
    pool.query("UPDATE payments SET amount=0 WHERE receipt_number='BASE-ONE'"),
  );
  await assert.rejects(pool.query('DELETE FROM denied_attempts'));
});
test('member edits enforce duplicate identity and preserve payment/visit relationships', async () => {
  const before = await query(
    'SELECT COUNT(*) AS n FROM payments WHERE member_id=$1',
    [ids.one],
  );
  assert.equal(
    (
      await action(
        'memberedit',
        {
          id: ids.one,
          first: 'Updated',
          sur: 'Name',
          idType: 'Student ID',
          idNum: 'MEMBER-TWO',
        },
        staff,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await action(
        'memberedit',
        {
          id: ids.one,
          first: 'Updated',
          sur: 'Name',
          idType: 'Student ID',
          idNum: 'MEMBER-ONE',
        },
        staff,
      )
    ).status,
    200,
  );
  assert.deepEqual(
    await query('SELECT COUNT(*) AS n FROM payments WHERE member_id=$1', [
      ids.one,
    ]),
    before,
  );
});
test('notice edits/cancellation retain original author, future visibility and append-only audits', async () => {
  const day = (await query('SELECT (CURRENT_DATE+2)::text AS d'))[0].d;
  assert.equal(
    (
      await action('notice', {
        message: 'Future maintenance',
        start: day,
        end: day,
        scope: ids.svc,
      })
    ).status,
    200,
  );
  const n = (
    await query("SELECT * FROM notices WHERE message='Future maintenance'")
  )[0];
  let state = (await call('/api/state', { session: member })).data.state;
  assert.ok(state.notices.some((x) => x.id === String(n.notice_id)));
  assert.equal(
    (
      await action('notice', {
        id: String(n.notice_id),
        message: 'Updated maintenance',
        start: day,
        end: day,
        scope: ids.svc,
      })
    ).status,
    200,
  );
  assert.equal(
    (await action('noticecancel', { id: String(n.notice_id) })).status,
    200,
  );
  state = (await call('/api/public')).data;
  assert.ok(!state.notices.some((x) => x.id === String(n.notice_id)));
  const after = (
    await query('SELECT * FROM notices WHERE notice_id=$1', [n.notice_id])
  )[0];
  assert.equal(after.posted_by, n.posted_by);
  assert.equal(String(after.published_at), String(n.published_at));
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS n FROM audit_events WHERE entity_name='notices' AND entity_id=$1",
        [n.notice_id],
      )
    )[0].n,
    3,
  );
});
test('all seven weekdays and gym/area overrides are stored, audited and cancellable', async () => {
  const week = Array.from({ length: 7 }, () => ({
    closed: false,
    open: '06:00',
    close: '21:00',
  }));
  assert.equal((await action('hours', { week })).status, 200);
  assert.equal((await action('hours', { week, scope: ids.svc })).status, 200);
  const day = (
    await query(
      'SELECT (CURRENT_DATE+(7-EXTRACT(DOW FROM CURRENT_DATE)::int)%7)::text AS d',
    )
  )[0].d;
  assert.equal(
    (
      await action('override', {
        date: day,
        scope: ids.svc,
        closed: true,
        reason: 'Area repair',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await action('override', {
        date: day,
        closed: false,
        open: '09:00',
        close: '16:00',
        reason: 'Sunday opening',
      })
    ).status,
    200,
  );
  const override = (
    await query('SELECT * FROM time_overrides WHERE service_id=$1', [ids.svc])
  )[0];
  assert.equal(
    (await action('overridecancel', { id: String(override.time_override_id) }))
      .status,
    200,
  );
  const state = (await call('/api/public')).data;
  assert.equal(state.hours[6].closed, false);
  assert.ok(
    !state.overrides.some((o) => o.id === String(override.time_override_id)),
  );
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS n FROM audit_events WHERE entity_name IN ('operating_times','time_overrides')",
      )
    )[0].n,
    17,
  );
});
test('temporary password reset revokes old sessions and requires a new member password', async () => {
  assert.equal(
    (await action('mempw', { id: ids.one, password: 'Temporary123!' })).status,
    200,
  );
  assert.equal(
    (await call('/api/members/' + ids.one, { session: member })).status,
    401,
  );
  member = await login('member', 'MEMBER-ONE', 'Temporary123!');
  assert.equal(
    (await call('/api/members/' + ids.one, { session: member })).status,
    403,
  );
  assert.equal(
    (
      await action(
        'changepw',
        {
          current: 'Temporary123!',
          password: 'Replacement123!',
          confirm: 'Replacement123!',
        },
        member,
      )
    ).status,
    200,
  );
  assert.equal(
    (await call('/api/members/' + ids.one, { session: member })).status,
    200,
  );
});
test('five wrong member passwords cause a temporary lock and manager reset clears it', async () => {
  for (let i = 0; i < 5; i++)
    await call('/api/login', {
      method: 'POST',
      body: {
        role: 'member',
        idType: 'Student ID',
        idNum: 'MEMBER-TWO',
        password: 'wrong',
      },
    });
  assert.equal(
    (
      await call('/api/login', {
        method: 'POST',
        body: {
          role: 'member',
          idType: 'Student ID',
          idNum: 'MEMBER-TWO',
          password: 'StaffPass123!',
        },
      })
    ).status,
    429,
  );
  assert.equal(
    (
      await query(
        'SELECT locked_until>NOW() AS locked FROM members WHERE member_id=$1',
        [ids.two],
      )
    )[0].locked,
    true,
  );
  await action('mempw', { id: ids.two, password: 'ResetMember123!' });
  assert.equal(
    (
      await query(
        'SELECT locked_until IS NULL AS clear FROM members WHERE member_id=$1',
        [ids.two],
      )
    )[0].clear,
    true,
  );
});
test('disabled staff and idle sessions lose access immediately', async () => {
  const other = await login('staff', 'other');
  assert.equal(
    (await action('stafftoggle', { username: 'other' })).status,
    200,
  );
  assert.equal(
    (await call('/api/members?q=Member', { session: other })).status,
    401,
  );
  await query(
    "UPDATE gms_sessions SET touched_at=NOW()-INTERVAL '16 minutes' WHERE staff_id=$1",
    [ids.staff],
  );
  assert.equal(
    (await call('/api/members?q=Member', { session: staff })).status,
    401,
  );
  await maintenance(pool);
  assert.equal(
    (
      await query(
        'SELECT COUNT(*)::int AS n FROM gms_sessions WHERE staff_id=$1',
        [ids.staff],
      )
    )[0].n,
    0,
  );
});

test('cash confirmation rejects stale price or expiry previews without recording money', async () => {
  staff = await login('staff', 'desk');
  const before = await query('SELECT COUNT(*) AS n FROM payments');
  const stale = await action(
    'renew',
    {
      id: ids.one,
      plan: ids.plan,
      receipt: 'STALE-PREVIEW',
      expected: { price: 1, days: 30, expiryBefore: '1900-01-01' },
    },
    staff,
  );
  assert.equal(stale.status, 409);
  assert.deepEqual(await query('SELECT COUNT(*) AS n FROM payments'), before);
  const omitted = await call('/api/actions/renew', {
    session: staff,
    method: 'POST',
    body: { id: ids.one, plan: ids.plan, receipt: 'NO-PREVIEW' },
  });
  assert.equal(omitted.status, 400);
});
test('concurrent repeated requests commit one receipt and return the same result', async () => {
  const expiryBefore = (
    await query(
      'SELECT resulting_expiry_date::text AS expiry FROM payments WHERE member_id=$1 ORDER BY payment_id DESC LIMIT 1',
      [ids.two],
    )
  )[0].expiry;
  const payload = {
      id: ids.two,
      plan: ids.plan,
      receipt: 'CONCURRENT-RETRY',
      expected: { price: 250, days: 30, expiryBefore },
    },
    key = randomUUID();
  const result = await Promise.all([
    action('renew', payload, staff, key),
    action('renew', payload, staff, key),
  ]);
  assert.ok(result.every((x) => x.status === 200));
  assert.deepEqual(result[0].data, result[1].data);
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS n FROM payments WHERE receipt_number='CONCURRENT-RETRY'",
      )
    )[0].n,
    1,
  );
});
test('concurrent distinct cash receipts require a refreshed preview after the first renewal', async () => {
  const expiryBefore = (
    await query(
      'SELECT resulting_expiry_date::text AS expiry FROM payments WHERE member_id=$1 ORDER BY payment_id DESC LIMIT 1',
      [ids.two],
    )
  )[0].expiry;
  const common = {
    id: ids.two,
    plan: ids.plan,
    expected: { price: 250, days: 30, expiryBefore },
  };
  const result = await Promise.all([
    action('renew', { ...common, receipt: 'CONCURRENT-A' }, staff),
    action('renew', { ...common, receipt: 'CONCURRENT-B' }, staff),
  ]);
  assert.deepEqual(result.map((x) => x.status).sort(), [200, 409]);
});
test('automatic closing is opt-in and records AUTO with no invented staff actor', async () => {
  const c = (
    await query(
      "INSERT INTO checkins(member_id,confirmed_by,photo_confirmed,checked_in_at) VALUES($1,$2,TRUE,(CURRENT_DATE-1+TIME '10:00') AT TIME ZONE 'Africa/Mbabane') RETURNING checkin_id",
      [ids.two, ids.staff],
    )
  )[0];
  await maintenance(pool, { autoCheckout: false });
  assert.equal(
    (
      await query('SELECT checked_out_at FROM checkins WHERE checkin_id=$1', [
        c.checkin_id,
      ])
    )[0].checked_out_at,
    null,
  );
  await maintenance(pool, { autoCheckout: true });
  const row = (
    await query(
      'SELECT checkout_method,checked_out_by,checked_out_at IS NOT NULL AS closed FROM checkins WHERE checkin_id=$1',
      [c.checkin_id],
    )
  )[0];
  assert.equal(row.closed, true);
  assert.equal(row.checkout_method, 'AUTO');
  assert.equal(row.checked_out_by, null);
});
test('staff password reset invalidates old sessions and old password immediately', async () => {
  await action('newstaff', {
    username: 'resettest',
    name: 'Reset Test',
    password: 'Original123!',
  });
  const session = await login('staff', 'resettest', 'Original123!');
  assert.equal(
    (
      await action('staffreset', {
        username: 'resettest',
        password: 'Replacement123!',
      })
    ).status,
    200,
  );
  assert.equal((await call('/api/members?q=Member', { session })).status, 401);
  assert.equal(
    (
      await call('/api/login', {
        method: 'POST',
        body: {
          role: 'staff',
          username: 'resettest',
          password: 'Original123!',
        },
      })
    ).status,
    401,
  );
  assert.ok(await login('staff', 'resettest', 'Replacement123!'));
});
test('real selected UI adapter signs in, searches and registers through HTTP without local storage', async () => {
  const shortPlan = String(
    (
      await query(
        "INSERT INTO plans(plan_name,price,duration_days) VALUES('Short adapter test',50,9) RETURNING plan_id",
      )
    )[0].plan_id,
  );
  const html = Buffer.from((await call('/')).data).toString(),
    script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const elements = new Map();
  const element = (key) => {
    if (!elements.has(key)) {
      const el = {
        innerHTML: '',
        textContent: '',
        value: '',
        hidden: false,
        dataset: {},
        style: {},
        focus() {},
        setAttribute() {},
        querySelector: () => null,
        getBoundingClientRect: () => ({ top: 0 }),
        scrollIntoView() {},
      };
      el.parentElement = el;
      elements.set(key, el);
    }
    return elements.get(key);
  };
  let cookie = '',
    writes = 0;
  const context = {
    window: { GMS_API_MODE: true, scrollTo() {} },
    console,
    Date,
    crypto: webcrypto,
    scrollY: 0,
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    document: {
      querySelector: element,
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    localStorage: {
      getItem() {
        throw new Error('Server mode must not read browser records');
      },
      setItem() {
        writes++;
        throw new Error('Server mode must not save private records');
      },
    },
    FileReader: class {},
    Image: class {},
    fetch: async (url, init = {}) => {
      const response = await fetch(base + url, {
        ...init,
        headers: { ...init.headers, ...(cookie ? { Cookie: cookie } : {}) },
      });
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie').split(';')[0];
      return response;
    },
  };
  vm.createContext(context);
  const run = (code) => vm.runInContext(code, context, { timeout: 5000 });
  await run(script);
  function form(k, values) {
    return {
      dataset: { form: k },
      querySelector: (selector) =>
        selector === '.msg'
          ? { textContent: '', className: '' }
          : { value: values[selector.slice(1)] },
    };
  }
  context.loginForm = form('login', {
    'lg-u': 'desk',
    'lg-p': 'StaffPass123!',
  });
  run("ui.login='staff'");
  await run('serverSubmit(loginForm)');
  assert.equal(run('ui.session.role'), 'staff');
  context.searchInput = { value: 'MEMBER-ONE', dataset: { live: 'ci' } };
  await run('serverSearch(searchInput)');
  assert.equal(run(`S.members.some(m=>m.id==='${ids.one}')`), true);
  context.registerForm = form('register', {
    'rg-f': 'Adapter',
    'rg-s': 'Example',
    'rg-t': 'Passport',
    'rg-n': 'UI-ADAPTER-MEMBER',
    'rg-p': 'AdapterPass123!',
    'rg-l': shortPlan,
    'rg-r': 'UI-ADAPTER-CASH',
  });
  context.testPhoto = photo;
  run('ui.regPhoto=testPhoto;ui.tab="register"');
  await run('serverSubmit(registerForm)');
  assert.equal(
    (
      await query(
        "SELECT COUNT(*)::int AS n FROM payments WHERE receipt_number='UI-ADAPTER-CASH'",
      )
    )[0].n,
    1,
  );
  assert.equal(run('ui.regDone.first'), 'Adapter');
  assert.equal(writes, 0);
  run("ui.q='UI-ADAPTER-MEMBER';ui.tab='checkin'");
  await run('A.ciconfirm({dataset:{id:ui.regDone.id}})');
  assert.equal(run('ui.ciMsg.type'), 'warn');
  assert.match(run('ui.ciMsg.text'), /renew soon/);
  await run('A.checkout({dataset:{id:ui.regDone.id}})');
  assert.equal(run('ui.ciMsg.type'), 'info');
});

test('additive migration retains legacy members/payments without inventing snapshots or photos', async () => {
  const legacy = new PGlite();
  try {
    for (const name of ['01_schema.sql', '02_logic_and_views.sql'])
      await legacy.exec(
        await readFile(
          new URL('../../Database/database/' + name, import.meta.url),
          'utf8',
        ),
      );
    const hash = await hashPassword('LegacyPass123!');
    await legacy.query(
      "INSERT INTO staff_accounts(username,password_hash,role) VALUES('legacy_manager',$1,'MANAGER')",
      [hash],
    );
    await legacy.query(
      "INSERT INTO members(first_name,surname,id_type,id_number,photo_path,password_hash) VALUES('Legacy','Member','PASSPORT','LEGACY-ONE','protected/legacy-placeholder.jpg',$1)",
      [hash],
    );
    await legacy.exec(
      "INSERT INTO plans(plan_name,price,duration_days) VALUES('Legacy plan',100,7);SELECT record_cash_payment(1,1,'LEGACY-CASH',1);",
    );
    const before = (
      await legacy.query(
        'SELECT member_id,amount,resulting_expiry_date FROM payments',
      )
    ).rows;
    for (const name of ['04_application.sql', '05_workflow_fixes.sql'])
      await legacy.exec(
        await readFile(
          new URL('../../Database/database/' + name, import.meta.url),
          'utf8',
        ),
      );
    assert.deepEqual(
      (
        await legacy.query(
          'SELECT member_id,amount,resulting_expiry_date FROM payments',
        )
      ).rows,
      before,
    );
    const saved = (
      await legacy.query(
        'SELECT plan_name_snapshot,duration_days_snapshot FROM payments',
      )
    ).rows[0];
    assert.equal(saved.plan_name_snapshot, null);
    assert.equal(saved.duration_days_snapshot, null);
    assert.equal(
      (await legacy.query('SELECT photo_bytes FROM members')).rows[0]
        .photo_bytes,
      null,
    );
    await legacy.exec("UPDATE plans SET plan_name='Renamed',price=999;");
    assert.match(
      (await legacy.query('SELECT plan_name FROM v_current_memberships'))
        .rows[0].plan_name,
      /Legacy payment/,
    );
  } finally {
    await legacy.close();
  }
});
test('manager can publish a service and contact details through the connected UI contract', async () => {
  const service = {
    id: 's999',
    name: 'Mobility room',
    desc: 'Open practice space',
    tag: 'Stretch and recover',
    art: 'yoga',
    photo,
    on: true,
    instructors: [{ name: 'Coach', role: 'Instructor' }],
    slots: [{ days: [6], start: '10:00', end: '12:00' }],
  };
  assert.equal((await action('service', { service })).status, 200);
  assert.equal(
    (
      await action('contact', {
        address: 'Synthetic gym address',
        phone: '+268 0000 0000',
        email: 'test@example.invalid',
      })
    ).status,
    200,
  );
  const state = (await call('/api/public')).data,
    s = state.services.find((s) => s.name === 'Mobility room');
  assert.ok(s);
  assert.deepEqual(s.slots[0].days, [6]);
  assert.match(s.photo, /^data:image\/jpeg;base64,/);
  assert.equal(state.contact.email, 'test@example.invalid');
});
test('staff messages respect recipient, read and cancellation history', async () => {
  assert.equal(
    (
      await action('staffmsg', {
        to: 'desk',
        message: 'Synthetic desk instruction',
      })
    ).status,
    200,
  );
  let state = (await call('/api/state', { session: staff })).data.state;
  const message = state.staffMsgs.find(
    (m) => m.msg === 'Synthetic desk instruction',
  );
  assert.ok(message);
  assert.equal((await action('readmessages', {}, staff)).status, 200);
  state = (await call('/api/state', { session: staff })).data.state;
  assert.ok(
    state.staffMsgs.find((m) => m.id === message.id).read.includes('desk'),
  );
  assert.equal((await action('messagecancel', { id: message.id })).status, 200);
  assert.equal(
    (
      await query('SELECT cancelled FROM staff_messages WHERE message_id=$1', [
        message.id,
      ])
    )[0].cancelled,
    true,
  );
});
