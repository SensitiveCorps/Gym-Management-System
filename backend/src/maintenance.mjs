import { transaction, rows } from './database.mjs';
export async function maintenance(
  pool,
  { idleMinutes = 15, autoCheckout = false } = {},
) {
  return transaction(pool, async (db) => {
    await db.query(
      `UPDATE staff_presence p SET signed_out_at=LEAST(s.expires_at,s.touched_at+($1::integer*INTERVAL '1 minute')) FROM gms_sessions s
   WHERE p.session_hash=s.token_hash AND p.signed_out_at IS NULL AND (s.expires_at<=NOW() OR s.touched_at<=NOW()-($1::integer*INTERVAL '1 minute'))`,
      [idleMinutes],
    );
    await db.query(
      "DELETE FROM gms_sessions WHERE expires_at<=NOW() OR touched_at<=NOW()-($1::integer*INTERVAL '1 minute')",
      [idleMinutes],
    );
    if (!autoCheckout) return 0;
    // Closing-time automation is opt-in until the gym confirms its policy and hours.
    const visits = await rows(
      db,
      `SELECT c.checkin_id,((c.checked_in_at AT TIME ZONE 'Africa/Mbabane')::date+
   CASE WHEN o.time_override_id IS NOT NULL THEN CASE WHEN o.is_closed THEN NULL ELSE o.closes_at END
        ELSE CASE WHEN h.is_closed THEN NULL ELSE h.closes_at END END) AT TIME ZONE 'Africa/Mbabane' AS closing
   FROM checkins c LEFT JOIN time_overrides o ON o.service_id IS NULL AND NOT o.is_cancelled AND o.override_date=(c.checked_in_at AT TIME ZONE 'Africa/Mbabane')::date
   LEFT JOIN operating_times h ON h.service_id IS NULL AND h.day_of_week=EXTRACT(DOW FROM c.checked_in_at AT TIME ZONE 'Africa/Mbabane')
   WHERE c.checked_out_at IS NULL FOR UPDATE OF c`,
    );
    let closed = 0;
    for (const c of visits) {
      if (!c.closing) continue;
      const result = await db.query(
        "UPDATE checkins SET checked_out_at=$2,checkout_method='AUTO' WHERE checkin_id=$1 AND checked_out_at IS NULL AND checked_in_at<=$2 AND $2<=NOW()",
        [c.checkin_id, c.closing],
      );
      closed += result.rowCount || result.affectedRows || 0;
    }
    return closed;
  });
}
