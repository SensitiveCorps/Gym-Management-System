import { one, rows } from './database.mjs';
import { paymentPreview, confirmPreview } from './payments.mjs';
import {
  UserError,
  text,
  id,
  bool,
  date,
  time,
  plan,
  identityType,
  hashPassword,
  verifyPassword,
  photoBytes,
  password,
} from './security.mjs';

const STAFF = ['staff', 'manager'];
const permissions = {
  register: STAFF,
  renew: STAFF,
  checkin: STAFF,
  checkout: STAFF,
  memberedit: STAFF,
  memberstatus: STAFF,
  plans: ['manager'],
  mempw: ['manager'],
  newstaff: ['manager'],
  staffedit: ['manager'],
  staffreset: ['manager'],
  stafftoggle: ['manager'],
  hours: ['manager'],
  override: ['manager'],
  overridecancel: ['manager'],
  notice: ['manager'],
  noticecancel: ['manager'],
  contact: ['manager'],
  service: ['manager'],
  staffmsg: ['manager'],
  messagecancel: ['manager'],
  readmessages: STAFF,
  changepw: ['member'],
};
export function authorize(actor, action) {
  if (!actor || !permissions[action]?.includes(actor.role))
    throw new UserError('You are not authorized to perform this action.', 403);
  if (actor.mustChangePassword && action !== 'changepw')
    throw new UserError('Change your temporary password first.', 403);
}
const audit = (db, actor, entity, target, action, details) =>
  db.query(
    'INSERT INTO audit_events(actor_staff_account_id,entity_name,entity_id,action,details) VALUES($1,$2,$3,$4,$5)',
    [actor.id, entity, target, action, JSON.stringify(details)],
  );
async function existing(db, table, column, value) {
  const allowed = {
    members: 'member_id',
    staff_accounts: 'staff_account_id',
    plans: 'plan_id',
    services: 'service_id',
    notices: 'notice_id',
    time_overrides: 'time_override_id',
  };
  if (allowed[table] !== column) throw new Error('Unsupported table');
  const record = await one(
    db,
    `SELECT * FROM ${table} WHERE ${column}=$1 FOR UPDATE`,
    [id(value)],
  );
  if (!record) throw new UserError('The record no longer exists.', 404);
  return record;
}
async function salePlan(db, value) {
  const p = await one(
    db,
    'SELECT * FROM plans WHERE plan_id=$1 AND is_available FOR SHARE',
    [id(value)],
  );
  if (!p)
    throw new UserError(
      'That plan is no longer available. Choose another before collecting cash.',
      409,
    );
  return p;
}
async function scopeId(db, value) {
  if (value == null || value === '') return null;
  await existing(db, 'services', 'service_id', value);
  return id(value);
}
async function cash(
  db,
  actor,
  member,
  selected,
  receipt,
  expected,
  registration = false,
) {
  receipt = text(receipt, 'Cash receipt number', 100);
  const previous = await one(
    db,
    'SELECT payment_id FROM payments WHERE LOWER(receipt_number)=LOWER($1)',
    [receipt],
  );
  if (!previous) {
    await salePlan(db, selected);
    confirmPreview(
      expected,
      await paymentPreview(db, selected, registration ? null : String(member)),
    );
  }
  return (
    await one(db, 'SELECT record_cash_payment($1,$2,$3,$4) AS payment_id', [
      member,
      selected,
      receipt,
      actor.id,
    ])
  ).payment_id;
}
function validateIdentity(d) {
  return {
    first: text(d.first, 'First name', 100),
    sur: text(d.sur, 'Surname', 100),
    type: identityType(d.idType),
    number: text(d.idNum, 'ID number', 100),
  };
}

export async function executeAction(db, actor, action, d) {
  authorize(actor, action);
  if (action === 'register') {
    const m = validateIdentity(d);
    await salePlan(db, d.plan);
    const bytes = await photoBytes(d.photo),
      hash = await hashPassword(d.password);
    const member = await one(
      db,
      `INSERT INTO members(first_name,surname,id_type,id_number,photo_path,photo_bytes,password_hash)
   VALUES($1,$2,$3,$4,'database:protected-photo',$5,$6) RETURNING member_id`,
      [m.first, m.sur, m.type, m.number, bytes, hash],
    );
    const payment = await cash(
      db,
      actor,
      member.member_id,
      d.plan,
      d.receipt,
      d.expected,
      true,
    );
    return { memberId: String(member.member_id), paymentId: String(payment) };
  }
  if (action === 'renew') {
    const member = await existing(db, 'members', 'member_id', d.id);
    // record_cash_payment owns availability, immutable snapshots, receipt retry and member locking.
    return {
      memberId: String(member.member_id),
      paymentId: String(
        await cash(
          db,
          actor,
          member.member_id,
          id(d.plan),
          d.receipt,
          d.expected,
        ),
      ),
    };
  }
  if (action === 'checkin') {
    if (d.memberId != null) id(d.memberId);
    bool(d.confirmed, 'Photo confirmation');
    const result = await one(db, 'SELECT * FROM attempt_checkin($1,$2,$3,$4)', [
      d.memberId || null,
      text(d.entered, 'Entered identity or search', 150),
      actor.id,
      d.confirmed,
    ]);
    return result;
  }
  if (action === 'checkout') {
    const visit = await one(
      db,
      'SELECT checkin_id FROM checkins WHERE member_id=$1 AND checked_out_at IS NULL FOR UPDATE',
      [id(d.id)],
    );
    if (!visit) throw new UserError('There is no open visit to close.', 409);
    await db.query('SELECT record_checkout($1,$2)', [
      visit.checkin_id,
      actor.id,
    ]);
    return {};
  }
  if (action === 'memberedit') {
    const before = await existing(db, 'members', 'member_id', d.id),
      m = validateIdentity(d);
    const bytes = d.photo ? await photoBytes(d.photo) : before.photo_bytes;
    if (!bytes) throw new UserError('A valid member photo is required.');
    await db.query(
      'UPDATE members SET first_name=$2,surname=$3,id_type=$4,id_number=$5,photo_bytes=$6 WHERE member_id=$1',
      [before.member_id, m.first, m.sur, m.type, m.number, bytes],
    );
    await audit(db, actor, 'members', before.member_id, 'UPDATE', {
      fields: ['name', 'identity', 'photo'],
      photoReplaced: !!d.photo,
    });
    return {};
  }
  if (action === 'memberstatus') {
    const enabled = bool(d.enabled, 'Account access');
    if (!Array.isArray(d.ids) || !d.ids.length || d.ids.length > 500)
      throw new UserError('Choose between 1 and 500 members.');
    if (d.inactiveOnly && actor.role !== 'manager')
      throw new UserError('Manager access is required.', 403);
    for (const memberId of [...new Set(d.ids.map(id))].sort(
      (a, b) => Number(a) - Number(b),
    )) {
      const member = await existing(db, 'members', 'member_id', memberId);
      if (d.inactiveOnly) {
        const eligible = await one(
          db,
          `SELECT COALESCE((SELECT resulting_expiry_date FROM payments WHERE member_id=$1 ORDER BY payment_id DESC LIMIT 1),registered_at::date)<CURRENT_DATE-365
    AND NOT EXISTS(SELECT 1 FROM checkins WHERE member_id=$1 AND checked_in_at::date>=CURRENT_DATE-365) AS ok FROM members WHERE member_id=$1`,
          [memberId],
        );
        if (!eligible.ok)
          throw new UserError(
            'The inactive list changed. Refresh before suspending accounts.',
            409,
          );
      }
      const status = enabled ? 'ENABLED' : 'SUSPENDED';
      if (member.account_status === status) continue;
      await db.query(
        'UPDATE members SET account_status=$2 WHERE member_id=$1',
        [memberId, status],
      );
      await audit(db, actor, 'members', memberId, 'UPDATE', {
        accountStatus: { before: member.account_status, after: status },
      });
    }
    return {};
  }
  if (action === 'plans') {
    if (!Array.isArray(d.plans) || !d.plans.length || d.plans.length > 100)
      throw new UserError('Supply between 1 and 100 plans.');
    const plans = d.plans.map(plan);
    if (new Set(plans.map((p) => p.name.toLowerCase())).size !== plans.length)
      throw new UserError('Plan names must be unique.');
    for (const p of plans) {
      let row;
      if (/^p\d+$/.test(p.id || ''))
        row = await one(
          db,
          'INSERT INTO plans(plan_name,price,duration_days,is_available) VALUES($1,$2,$3,$4) RETURNING plan_id',
          [p.name, p.price, p.days, p.on],
        );
      else {
        await existing(db, 'plans', 'plan_id', p.id);
        row = await one(
          db,
          'UPDATE plans SET plan_name=$2,price=$3,duration_days=$4,is_available=$5 WHERE plan_id=$1 RETURNING plan_id',
          [id(p.id), p.name, p.price, p.days, p.on],
        );
      }
      await audit(db, actor, 'plans', row.plan_id, 'UPDATE', {
        name: p.name,
        price: p.price,
        days: p.days,
        available: p.on,
      });
    }
    return {};
  }
  if (action === 'mempw') {
    const m = await existing(db, 'members', 'member_id', d.id);
    await db.query(
      'UPDATE members SET password_hash=$2,must_change_password=TRUE,failed_login_count=0,locked_until=NULL WHERE member_id=$1',
      [m.member_id, await hashPassword(d.password)],
    );
    await db.query('DELETE FROM gms_sessions WHERE member_id=$1', [
      m.member_id,
    ]);
    await audit(db, actor, 'members', m.member_id, 'UPDATE', {
      passwordReset: true,
    });
    return {};
  }
  if (action === 'changepw') {
    const m = await existing(db, 'members', 'member_id', actor.id);
    if (!(await verifyPassword(d.current, m.password_hash)))
      throw new UserError('The current password is not correct.');
    password(d.password);
    if (d.password === d.current || d.password !== d.confirm)
      throw new UserError('Use a different password and confirm it exactly.');
    await db.query(
      'UPDATE members SET password_hash=$2,must_change_password=FALSE,failed_login_count=0,locked_until=NULL WHERE member_id=$1',
      [m.member_id, await hashPassword(d.password)],
    );
    await db.query(
      'DELETE FROM gms_sessions WHERE member_id=$1 AND token_hash<>$2',
      [m.member_id, actor.tokenHash],
    );
    return {};
  }
  if (['newstaff', 'staffedit', 'staffreset', 'stafftoggle'].includes(action)) {
    let account;
    if (action !== 'newstaff') {
      account = await one(
        db,
        'SELECT * FROM staff_accounts WHERE username=$1 FOR UPDATE',
        [text(d.username, 'Username', 60).toLowerCase()],
      );
      if (!account) throw new UserError('Staff account not found.', 404);
    }
    if (action === 'newstaff') {
      const name = text(d.name, 'Staff name', 150),
        username = text(d.username, 'Username', 60).toLowerCase();
      if (username.length < 3)
        throw new UserError('Username requires at least three characters.');
      account = await one(
        db,
        "INSERT INTO staff_accounts(username,display_name,password_hash,role) VALUES($1,$2,$3,'STAFF') RETURNING *",
        [username, name, await hashPassword(d.password)],
      );
    }
    if (action === 'staffedit') {
      if (account.role !== 'STAFF')
        throw new UserError('This action only edits staff accounts.');
      const username = text(d.newUsername, 'Username', 60).toLowerCase();
      if (username.length < 3)
        throw new UserError('Username requires at least three characters.');
      await db.query(
        'UPDATE staff_accounts SET username=$2,display_name=$3 WHERE staff_account_id=$1',
        [account.staff_account_id, username, text(d.name, 'Staff name', 150)],
      );
    }
    if (action === 'stafftoggle') {
      if (account.role !== 'STAFF')
        throw new UserError('Manager accounts cannot be disabled here.');
      await db.query(
        'UPDATE staff_accounts SET is_enabled=NOT is_enabled WHERE staff_account_id=$1',
        [account.staff_account_id],
      );
    }
    if (action === 'staffreset')
      await db.query(
        'UPDATE staff_accounts SET password_hash=$2 WHERE staff_account_id=$1',
        [account.staff_account_id, await hashPassword(d.password)],
      );
    if (
      action === 'staffreset' ||
      (action === 'stafftoggle' && account.is_enabled)
    ) {
      await db.query('DELETE FROM gms_sessions WHERE staff_id=$1', [
        account.staff_account_id,
      ]);
      await db.query(
        'UPDATE staff_presence SET signed_out_at=NOW() WHERE staff_id=$1 AND signed_out_at IS NULL',
        [account.staff_account_id],
      );
    }
    await audit(
      db,
      actor,
      'staff_accounts',
      account.staff_account_id,
      'UPDATE',
      { change: action },
    );
    return {};
  }
  if (action === 'hours') {
    const scope = await scopeId(db, d.scope);
    if (!Array.isArray(d.week) || d.week.length !== 7)
      throw new UserError('Supply a schedule for all seven days.');
    for (let i = 0; i < 7; i++) {
      const h = d.week[i],
        closed = bool(h.closed, 'Closed day'),
        open = closed ? null : time(h.open),
        close = closed ? null : time(h.close);
      if (!closed && open >= close)
        throw new UserError('Closing must be after opening.');
      const day = (i + 1) % 7;
      const changed = await one(
        db,
        'UPDATE operating_times SET opens_at=$3,closes_at=$4,is_closed=$5,changed_by=$6 WHERE service_id IS NOT DISTINCT FROM $1::bigint AND day_of_week=$2 RETURNING operating_time_id',
        [scope, day, open, close, closed, actor.id],
      );
      if (!changed)
        await db.query(
          'INSERT INTO operating_times(service_id,day_of_week,opens_at,closes_at,is_closed,changed_by) VALUES($1,$2,$3,$4,$5,$6)',
          [scope, day, open, close, closed, actor.id],
        );
    }
    return {};
  }
  if (action === 'override') {
    const scope = await scopeId(db, d.scope),
      day = date(d.date),
      closed = bool(d.closed, 'Date closure'),
      open = closed ? null : time(d.open),
      close = closed ? null : time(d.close);
    if (!closed && open >= close)
      throw new UserError('Closing must be after opening.');
    const args = [
      scope,
      day,
      open,
      close,
      closed,
      String(d.reason || '').slice(0, 500),
      actor.id,
    ];
    const row = await one(
      db,
      'UPDATE time_overrides SET opens_at=$3,closes_at=$4,is_closed=$5,reason=$6,changed_by=$7,is_cancelled=FALSE WHERE service_id IS NOT DISTINCT FROM $1::bigint AND override_date=$2 RETURNING time_override_id',
      args,
    );
    if (!row)
      await db.query(
        'INSERT INTO time_overrides(service_id,override_date,opens_at,closes_at,is_closed,reason,changed_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
        args,
      );
    return {};
  }
  if (action === 'overridecancel') {
    await existing(db, 'time_overrides', 'time_override_id', d.id);
    await db.query(
      'UPDATE time_overrides SET is_cancelled=TRUE,changed_by=$2 WHERE time_override_id=$1',
      [id(d.id), actor.id],
    );
    return {};
  }
  if (action === 'notice') {
    const scope = await scopeId(db, d.scope),
      msg = text(d.message, 'Notice message', 4000),
      title = text(d.title || msg.slice(0, 100), 'Notice title', 100),
      start = date(d.start),
      end = date(d.end);
    if (start > end)
      throw new UserError('The end date must be on or after the start date.');
    if (d.id) {
      await existing(db, 'notices', 'notice_id', d.id);
      await db.query(
        'UPDATE notices SET service_id=$2,title=$3,message=$4,starts_on=$5,ends_on=$6,updated_by=$7 WHERE notice_id=$1',
        [id(d.id), scope, title, msg, start, end, actor.id],
      );
    } else
      await db.query(
        'INSERT INTO notices(service_id,title,message,starts_on,ends_on,posted_by) VALUES($1,$2,$3,$4,$5,$6)',
        [scope, title, msg, start, end, actor.id],
      );
    return {};
  }
  if (action === 'noticecancel') {
    await existing(db, 'notices', 'notice_id', d.id);
    await db.query(
      "UPDATE notices SET status='CANCELLED',cancelled_at=NOW(),updated_by=$2 WHERE notice_id=$1",
      [id(d.id), actor.id],
    );
    return {};
  }
  if (action === 'contact') {
    const contact = {
      address: text(d.address, 'Address', 500),
      phone: text(d.phone, 'Phone', 100),
      email: text(d.email, 'Email', 200),
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email))
      throw new UserError('Enter a valid email address.');
    await db.query(
      "INSERT INTO app_settings(name,value) VALUES('contact',$1) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value",
      [JSON.stringify(contact)],
    );
    await audit(db, actor, 'app_settings', 1, 'UPDATE', { contact });
    return {};
  }
  if (action === 'service') {
    const service = d.service || {},
      name = text(service.name, 'Service name', 100),
      desc = text(service.desc, 'Description', 4000),
      tag = String(service.tag || '').slice(0, 200);
    if (
      !Array.isArray(service.slots) ||
      service.slots.length > 20 ||
      !Array.isArray(service.instructors) ||
      service.instructors.length > 20
    )
      throw new UserError('Invalid service schedule.');
    const slots = service.slots.map((s) => {
      if (
        !Array.isArray(s.days) ||
        !s.days.length ||
        s.days.some((n) => !Number.isInteger(n) || n < 0 || n > 6)
      )
        throw new UserError('Choose valid schedule days.');
      const start = time(s.start),
        end = time(s.end);
      if (start >= end)
        throw new UserError('A session must end after it starts.');
      return { days: [...new Set(s.days)], start, end };
    });
    const instructors = service.instructors
      .filter((x) => x.name?.trim())
      .map((x) => ({
        name: text(x.name, 'Instructor', 100),
        role: String(x.role || '').slice(0, 100),
      }));
    const photo = service.photo
      ? 'data:image/jpeg;base64,' +
        (await photoBytes(service.photo)).toString('base64')
      : null;
    const presentation = {
      tag,
      art: ['weights', 'cardio', 'classes', 'boxing', 'yoga', 'spin'].includes(
        service.art,
      )
        ? service.art
        : 'classes',
      photo,
      instructors,
      slots,
    };
    let record;
    if (/^s\d+$/.test(service.id || ''))
      record = await one(
        db,
        'INSERT INTO services(service_name,description,is_active,presentation) VALUES($1,$2,$3,$4) RETURNING service_id',
        [
          name,
          desc,
          bool(service.on, 'Service availability'),
          JSON.stringify(presentation),
        ],
      );
    else {
      await existing(db, 'services', 'service_id', service.id);
      record = await one(
        db,
        'UPDATE services SET service_name=$2,description=$3,is_active=$4,presentation=$5 WHERE service_id=$1 RETURNING service_id',
        [
          id(service.id),
          name,
          desc,
          bool(service.on, 'Service availability'),
          JSON.stringify(presentation),
        ],
      );
    }
    await audit(db, actor, 'services', record.service_id, 'UPDATE', {
      name,
      available: service.on,
    });
    return {};
  }
  if (action === 'staffmsg') {
    let recipient = null;
    if (d.to !== 'all') {
      const a = await one(
        db,
        "SELECT staff_account_id FROM staff_accounts WHERE username=$1 AND is_enabled AND role='STAFF'",
        [text(d.to, 'Recipient', 60)],
      );
      if (!a) throw new UserError('Choose an enabled staff account.');
      recipient = a.staff_account_id;
    }
    await db.query(
      'INSERT INTO staff_messages(message,recipient,posted_by) VALUES($1,$2,$3)',
      [text(d.message, 'Message', 4000), recipient, actor.id],
    );
    return {};
  }
  if (action === 'messagecancel') {
    await db.query(
      'UPDATE staff_messages SET cancelled=TRUE WHERE message_id=$1',
      [id(d.id)],
    );
    return {};
  }
  if (action === 'readmessages') {
    await db.query(
      'INSERT INTO staff_message_reads(message_id,staff_id) SELECT message_id,$1 FROM staff_messages WHERE NOT cancelled AND (recipient IS NULL OR recipient=$1) ON CONFLICT DO NOTHING',
      [actor.id],
    );
    return {};
  }
  throw new UserError('Unknown action.', 404);
}
