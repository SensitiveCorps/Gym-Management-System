import { one } from './database.mjs';
import { id, UserError } from './security.mjs';

// Both this read-only preview and record_cash_payment use the same SQL function.
// Confirmation calls this again while the member and saleable plan are locked.
export async function paymentPreview(db, planId, memberId = null) {
  planId = id(planId);
  if (memberId !== null) {
    memberId = id(memberId);
    if (
      !(await one(db, 'SELECT member_id FROM members WHERE member_id=$1', [
        memberId,
      ]))
    )
      throw new UserError('Member not found.', 404);
  }
  const row = await one(
    db,
    `SELECT p.plan_id::text AS "planId",p.plan_name AS "planName",p.price,
      p.duration_days AS days,CURRENT_DATE::text AS "paymentDate",
      previous.resulting_expiry_date::text AS "expiryBefore",
      calculate_membership_expiry(previous.resulting_expiry_date,CURRENT_DATE,p.duration_days)::text AS "expiryAfter"
    FROM plans p LEFT JOIN LATERAL (
      SELECT resulting_expiry_date FROM payments WHERE member_id=$2
      ORDER BY payment_id DESC LIMIT 1
    ) previous ON TRUE WHERE p.plan_id=$1 AND p.is_available`,
    [planId, memberId],
  );
  if (!row)
    throw new UserError(
      'That plan is no longer available. Choose another before collecting cash.',
      409,
    );
  return { ...row, price: Number(row.price), memberId };
}

export function confirmPreview(expected, current) {
  const fields = [
    'planId',
    'planName',
    'price',
    'days',
    'memberId',
    'paymentDate',
    'expiryBefore',
    'expiryAfter',
  ];
  if (
    !expected ||
    typeof expected !== 'object' ||
    Array.isArray(expected) ||
    fields.some((field) => !Object.hasOwn(expected, field))
  )
    throw new UserError(
      'Review the server payment preview before confirming cash.',
    );
  if (fields.some((field) => expected[field] !== current[field]))
    throw new UserError(
      'The plan, payment date or membership changed after the preview. Review the new terms before collecting cash.',
      409,
    );
}
