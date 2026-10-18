# Gym Management System — Database relationships

The relationships below reflect the *proposed PostgreSQL schema v1.0*. Optional `service_id` in notices/hours/overrides means the whole gym rather than an individual area. A current membership is **derived from payments**; there is no separate `membership` table duplicating plan/expiry state.

```mermaid
erDiagram
    STAFF_ACCOUNTS ||--o{ PAYMENTS : records
    STAFF_ACCOUNTS ||--o{ CHECKINS : confirms
    STAFF_ACCOUNTS ||--o{ DENIED_ATTEMPTS : handles
    STAFF_ACCOUNTS ||--o{ NOTICES : publishes
    STAFF_ACCOUNTS ||--o{ OPERATING_TIMES : updates
    STAFF_ACCOUNTS ||--o{ TIME_OVERRIDES : updates
    STAFF_ACCOUNTS ||--o{ AUDIT_EVENTS : performs

    MEMBERS ||--o{ PAYMENTS : makes
    MEMBERS ||--o{ CHECKINS : attends
    MEMBERS |o--o{ DENIED_ATTEMPTS : involved_in
    PLANS ||--o{ PAYMENTS : purchased_as

    SERVICES |o--o{ NOTICES : may_affect
    SERVICES |o--o{ OPERATING_TIMES : may_schedule
    SERVICES |o--o{ TIME_OVERRIDES : may_override

    STAFF_ACCOUNTS {
      bigint staff_account_id PK
      text username UK
      text password_hash
      text role
      boolean is_enabled
    }
    MEMBERS {
      bigint member_id PK
      text first_name
      text surname
      text id_type
      text id_number
      text photo_path
      text password_hash
      text account_status
    }
    PLANS {
      bigint plan_id PK
      text plan_name UK
      numeric price
      int duration_days
      boolean is_available
    }
    PAYMENTS {
      bigint payment_id PK
      bigint member_id FK
      bigint plan_id FK
      bigint recorded_by FK
      text receipt_number UK
      date payment_date
      date resulting_expiry_date
      numeric amount
    }
    CHECKINS {
      bigint checkin_id PK
      bigint member_id FK
      bigint confirmed_by FK
      timestamp checked_in_at
      timestamp checked_out_at
      boolean photo_confirmed
    }
    DENIED_ATTEMPTS {
      bigint denied_attempt_id PK
      bigint member_id FK
      bigint handled_by FK
      text reason
    }
    SERVICES {
      bigint service_id PK
      text service_name UK
    }
    NOTICES {
      bigint notice_id PK
      bigint service_id FK
      bigint posted_by FK
      text title
      date starts_on
      date ends_on
      text status
    }
    OPERATING_TIMES {
      bigint operating_time_id PK
      bigint service_id FK
      bigint changed_by FK
      int day_of_week
      boolean is_closed
    }
    TIME_OVERRIDES {
      bigint time_override_id PK
      bigint service_id FK
      bigint changed_by FK
      date override_date
      boolean is_closed
    }
    AUDIT_EVENTS {
      bigint audit_event_id PK
      bigint actor_staff_account_id FK
      text action
      text entity_name
    }
```

Additional foreign keys omitted from individual association lines for diagram readability: `CHECKINS.checked_out_by → STAFF_ACCOUNTS`, `NOTICES.updated_by → STAFF_ACCOUNTS`. The database DDL is the definitive reference for nullability, checks, foreign keys and unique indexes.
