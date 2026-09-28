-- Back-office : suppression autorisée sur les seules tables de liaison du catalogue.
GRANT DELETE ON item_option_groups, menu_steps, menu_step_choices, staff_establishments TO caissebox_app;

CREATE INDEX IF NOT EXISTS cash_sessions_day ON cash_sessions (business_day_id);
CREATE INDEX IF NOT EXISTS business_days_establishment ON business_days (establishment_id, opened_at DESC);
