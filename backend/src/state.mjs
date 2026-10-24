import { one, rows } from './database.mjs';
import { ID_TYPES } from './security.mjs';
const TYPES = Object.fromEntries(
  Object.entries(ID_TYPES).map(([a, b]) => [b, a]),
);
const day = (value) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
const stamp = (value) =>
  value
    ? new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Africa/Mbabane',
        dateStyle: 'short',
        timeStyle: 'short',
        hourCycle: 'h23',
      })
        .format(new Date(value))
        .replace(' ', 'T')
    : null;
const mask = (value) => (value.length > 3 ? '••••••' + value.slice(-3) : '•••');
export async function memberData(db, actor, ids, { history = false } = {}) {
  if (!ids.length)
    return {
      members: [],
      payments: [],
      checkins: [],
      denied: [],
      memberStatusLog: [],
    };
  const own = actor.role === 'member';
  const members = (
    await rows(
      db,
      `SELECT member_id,first_name,surname,id_type,id_number,registered_at,account_status,must_change_password,
  photo_bytes IS NOT NULL AS has_photo FROM members WHERE member_id=ANY($1::bigint[]) ORDER BY member_id`,
      [ids],
    )
  ).map((m) => ({
    id: String(m.member_id),
    first: m.first_name,
    sur: m.surname,
    idType: TYPES[m.id_type],
    idNum: own ? mask(m.id_number) : m.id_number,
    photo: !own && m.has_photo ? `/api/members/${m.member_id}/photo` : null,
    reg: stamp(m.registered_at).slice(0, 10),
    active: m.account_status === 'ENABLED',
    mustChangePassword: m.must_change_password,
  }));
  const payments = (
    await rows(
      db,
      `SELECT p.*,s.username FROM payments p JOIN staff_accounts s ON s.staff_account_id=p.recorded_by
  WHERE p.member_id=ANY($1::bigint[]) ${history ? '' : 'AND p.payment_id IN (SELECT MAX(payment_id) FROM payments WHERE member_id=ANY($1::bigint[]) GROUP BY member_id)'} ORDER BY p.payment_id`,
      [ids],
    )
  ).map((p) => ({
    id: String(p.payment_id),
    memberId: String(p.member_id),
    planId: String(p.plan_id),
    plan: p.plan_name_snapshot || `Legacy payment (plan ${p.plan_id})`,
    amount: Number(p.amount),
    days: p.duration_days_snapshot,
    date: day(p.payment_date),
    recordedAt: stamp(p.recorded_at),
    expiry: day(p.resulting_expiry_date),
    receipt: p.receipt_number,
    staff: p.username,
    method: p.method,
    status: p.status,
  }));
  const checkins = (
    await rows(
      db,
      `SELECT c.*,a.username AS entered_by,b.username AS out_by FROM checkins c JOIN staff_accounts a ON a.staff_account_id=c.confirmed_by
  LEFT JOIN staff_accounts b ON b.staff_account_id=c.checked_out_by WHERE member_id=ANY($1::bigint[]) ${history ? '' : 'AND checked_out_at IS NULL'} ORDER BY checked_in_at`,
      [ids],
    )
  ).map((c) => ({
    id: String(c.checkin_id),
    m: String(c.member_id),
    in: stamp(c.checked_in_at),
    out: stamp(c.checked_out_at),
    staff: c.entered_by,
    outBy: c.out_by,
    outMethod: c.checkout_method,
  }));
  const denied =
    !own && history
      ? (
          await rows(
            db,
            'SELECT d.*,s.username FROM denied_attempts d JOIN staff_accounts s ON s.staff_account_id=d.handled_by WHERE member_id=ANY($1::bigint[]) ORDER BY attempted_at',
            [ids],
          )
        ).map((d) => ({
          id: String(d.denied_attempt_id),
          m: String(d.member_id),
          time: stamp(d.attempted_at),
          idEntered: d.entered_identifier,
          staff: d.username,
          reason: d.reason,
        }))
      : [];
  return { members, payments, checkins, denied, memberStatusLog: [] };
}
export async function applicationState(db, actor, policy) {
  const manager = actor?.role === 'manager',
    staff = actor?.role === 'staff',
    member = actor?.role === 'member';
  const plans = (
    await rows(
      db,
      'SELECT * FROM plans ' +
        (manager ? '' : 'WHERE is_available') +
        ' ORDER BY plan_id',
    )
  ).map((p) => ({
    id: String(p.plan_id),
    name: p.plan_name,
    price: Number(p.price),
    days: p.duration_days,
    on: p.is_available,
  }));
  const services = (
    await rows(
      db,
      'SELECT * FROM services ' +
        (manager ? '' : 'WHERE is_active') +
        ' ORDER BY service_id',
    )
  ).map((s) => ({
    id: String(s.service_id),
    name: s.service_name,
    desc: s.description || '',
    on: s.is_active,
    tag: '',
    art: 'classes',
    photo: null,
    instructors: [],
    slots: [],
    ...s.presentation,
  }));
  const schedule = await rows(
    db,
    'SELECT * FROM operating_times ORDER BY operating_time_id',
  );
  const hours = Array.from({ length: 7 }, () => ({
      closed: true,
      open: '',
      close: '',
    })),
    areaHours = {};
  for (const h of schedule) {
    const week = h.service_id
      ? (areaHours[String(h.service_id)] ??= Array.from({ length: 7 }, () => ({
          closed: true,
          open: '',
          close: '',
        })))
      : hours;
    week[(h.day_of_week + 6) % 7] = {
      closed: h.is_closed,
      open: h.opens_at?.slice(0, 5) || '',
      close: h.closes_at?.slice(0, 5) || '',
    };
  }
  const notices = (
    await rows(
      db,
      `SELECT n.*,a.username AS author,b.username AS updater FROM notices n JOIN staff_accounts a ON a.staff_account_id=n.posted_by LEFT JOIN staff_accounts b ON b.staff_account_id=n.updated_by ${manager ? '' : "WHERE n.status='PUBLISHED' AND n.published_at<=NOW() AND n.ends_on>=CURRENT_DATE"} ORDER BY notice_id`,
    )
  ).map((n) => ({
    id: String(n.notice_id),
    title: n.title,
    msg: n.message,
    svc: n.service_id ? String(n.service_id) : null,
    start: day(n.starts_on),
    end: day(n.ends_on),
    cancelled: n.status === 'CANCELLED',
    ...(manager
      ? {
          by: n.author,
          at: stamp(n.published_at),
          updatedBy: n.updater,
          updatedAt: stamp(n.updated_at),
        }
      : {}),
  }));
  const overrides = (
    await rows(
      db,
      'SELECT * FROM time_overrides ' +
        (manager ? '' : 'WHERE NOT is_cancelled') +
        ' ORDER BY override_date',
    )
  ).map((o) => ({
    id: String(o.time_override_id),
    date: day(o.override_date),
    svc: o.service_id ? String(o.service_id) : null,
    closed: o.is_closed,
    open: o.opens_at?.slice(0, 5) || '',
    close: o.closes_at?.slice(0, 5) || '',
    reason: o.reason,
    cancelled: o.is_cancelled,
  }));
  const contact = (
    await one(db, "SELECT value FROM app_settings WHERE name='contact'")
  )?.value || {
    address: 'Contact the gym for its address.',
    phone: 'Not configured',
    email: 'Not configured',
  };
  const result = {
    v: 3,
    plans,
    services,
    hours,
    areaHours,
    notices,
    overrides,
    contact,
    policy,
    members: [],
    payments: [],
    checkins: [],
    denied: [],
    staff: [],
    staffLog: [],
    staffMsgs: [],
    memberStatusLog: [],
    audit: [],
    nextId: Date.now(),
  };
  if (!actor) return result;
  result.staff = (
    await rows(
      db,
      `SELECT staff_account_id,username,display_name,role,is_enabled FROM staff_accounts ${manager ? '' : 'WHERE staff_account_id=$1'} ORDER BY staff_account_id`,
      manager ? [] : [actor.staffId || 0],
    )
  ).map((s) => ({
    u: s.username,
    name: s.display_name || s.username,
    role: s.role.toLowerCase(),
    on: s.is_enabled,
  }));
  let ids = [];
  if (manager)
    ids = (
      await rows(db, 'SELECT member_id FROM members ORDER BY member_id')
    ).map((x) => x.member_id);
  else if (member) ids = [actor.id];
  else
    ids = (
      await rows(
        db,
        'SELECT DISTINCT member_id FROM checkins WHERE checked_out_at IS NULL',
      )
    ).map((x) => x.member_id);
  Object.assign(
    result,
    await memberData(db, actor, ids, { history: manager || member }),
  );
  if (member && actor.mustChangePassword) {
    result.payments = [];
    result.checkins = [];
  }
  if (manager) {
    result.denied = (
      await rows(
        db,
        'SELECT d.*,s.username FROM denied_attempts d JOIN staff_accounts s ON s.staff_account_id=d.handled_by ORDER BY attempted_at',
      )
    ).map((d) => ({
      id: String(d.denied_attempt_id),
      m: d.member_id ? String(d.member_id) : null,
      time: stamp(d.attempted_at),
      idEntered: d.entered_identifier,
      staff: d.username,
      reason: d.reason,
    }));
    result.audit = (
      await rows(
        db,
        'SELECT a.*,s.username FROM audit_events a JOIN staff_accounts s ON s.staff_account_id=a.actor_staff_account_id ORDER BY audit_event_id',
      )
    ).map((a) => ({
      id: String(a.audit_event_id),
      entity: a.entity_name,
      target: String(a.entity_id),
      action: a.action,
      by: a.username,
      at: stamp(a.happened_at),
      before: a.details.old || a.details.accountStatus?.before || null,
      after: a.details.new || a.details.accountStatus?.after || a.details,
    }));
    result.memberStatusLog = result.audit
      .filter(
        (a) =>
          a.entity === 'members' && ['ENABLED', 'SUSPENDED'].includes(a.after),
      )
      .map((a) => ({
        memberId: a.target,
        enabled: a.after === 'ENABLED',
        at: a.at,
        by: a.by,
      }));
    result.staffLog = (
      await rows(
        db,
        'SELECT p.*,s.username FROM staff_presence p JOIN staff_accounts s ON s.staff_account_id=p.staff_id ORDER BY signed_in_at',
      )
    ).map((p) => ({
      u: p.username,
      in: stamp(p.signed_in_at),
      out: stamp(p.signed_out_at),
    }));
  }
  if (manager || staff) {
    result.staffMsgs = (
      await rows(
        db,
        `SELECT m.*,a.username AS author,b.username AS recipient_name FROM staff_messages m JOIN staff_accounts a ON a.staff_account_id=m.posted_by LEFT JOIN staff_accounts b ON b.staff_account_id=m.recipient WHERE NOT cancelled ${manager ? '' : 'AND (recipient IS NULL OR recipient=$1)'} ORDER BY message_id`,
        manager ? [] : [actor.id],
      )
    ).map((m) => ({
      id: String(m.message_id),
      msg: m.message,
      to: m.recipient_name || 'all',
      by: m.author,
      at: stamp(m.posted_at),
      read: [],
    }));
    const reads = await rows(
      db,
      `SELECT r.message_id,s.username FROM staff_message_reads r JOIN staff_accounts s ON s.staff_account_id=r.staff_id ${manager ? '' : 'WHERE r.staff_id=$1'}`,
      manager ? [] : [actor.id],
    );
    for (const r of reads)
      result.staffMsgs
        .find((m) => m.id === String(r.message_id))
        ?.read.push(r.username);
  }
  return result;
}
export async function reportData(db) {
  return rows(
    db,
    `SELECT m.member_id AS member_reference,m.first_name,m.surname,v.membership_status,v.days_remaining,v.expiry_date FROM members m JOIN v_current_memberships v USING(member_id) ORDER BY member_id`,
  );
}
