-- CaisseBox : schéma initial
-- Conventions :
--   * toutes les clés sont des UUID, générables sur la tablette (création hors ligne) ;
--   * tous les montants sont en centimes (bigint), jamais en décimal flottant ;
--   * les taux de TVA sont en points de base (1000 = 10 %) ;
--   * chaque table porte tenant_id pour l'isolation par Row Level Security ;
--   * les tables synchronisées alimentent change_log par trigger (voir fin de fichier).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Rôle applicatif soumis à la RLS. L'API ouvre chaque transaction par
-- SET LOCAL ROLE caissebox_app puis fixe app.tenant_id.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'caissebox_app') THEN
    CREATE ROLE caissebox_app NOLOGIN;
  END IF;
END $$;

GRANT caissebox_app TO CURRENT_USER;

-- Utilitaires -----------------------------------------------------------------

CREATE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La table % est en ajout seul : % interdit', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END $$;

-- Plateforme BACYBRAINS -------------------------------------------------------

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  ice text,
  if_number text,
  rc text,
  patente text,
  address text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'terminated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE establishments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  address text,
  receipt_header text,
  receipt_footer text DEFAULT 'Merci de votre visite',
  service_mode text NOT NULL DEFAULT 'both' CHECK (service_mode IN ('counter', 'waiter_pays', 'both')),
  kitchen_send_mode text NOT NULL DEFAULT 'manual' CHECK (kitchen_send_mode IN ('manual', 'auto')),
  timezone text NOT NULL DEFAULT 'Africa/Casablanca',
  -- Blocage progressif pour impayé, piloté depuis la console.
  access_state text NOT NULL DEFAULT 'normal'
    CHECK (access_state IN ('normal', 'warning_manager', 'warning_all', 'refuse_day_open')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants (id),
  establishment_id uuid REFERENCES establishments (id),
  kind text NOT NULL CHECK (kind IN ('tablet', 'printer', 'drawer')),
  serial text NOT NULL UNIQUE,
  model text,
  label text,
  status text NOT NULL DEFAULT 'stock' CHECK (status IN ('stock', 'deployed', 'repair', 'lost', 'retired')),
  secret_hash text,
  app_version text,
  last_seen_at timestamptz,
  purchase_price_cents bigint CHECK (purchase_price_cents >= 0),
  purchased_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'deployed' OR (tenant_id IS NOT NULL AND establishment_id IS NOT NULL))
);

CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  plan text NOT NULL CHECK (plan IN ('solo', 'resto', 'chaine')),
  monthly_rent_cents bigint NOT NULL CHECK (monthly_rent_cents >= 0),
  launch_offer boolean NOT NULL DEFAULT false,
  deposit_cents bigint NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'ended', 'terminated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date > start_date)
);

CREATE TABLE contract_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  contract_id uuid NOT NULL REFERENCES contracts (id),
  label text NOT NULL,
  monthly_cents bigint NOT NULL CHECK (monthly_cents >= 0)
);

CREATE TABLE rent_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  contract_id uuid NOT NULL REFERENCES contracts (id),
  period date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  due_date date NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, period)
);

-- Comptes web : propriétaires (tenant_id renseigné) et opérateurs BACYBRAINS (tenant_id nul).
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants (id),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'operator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'operator') = (tenant_id IS NULL))
);

-- Équipe et droits ------------------------------------------------------------

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  is_manager boolean NOT NULL DEFAULT false,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  role_id uuid NOT NULL REFERENCES roles (id),
  full_name text NOT NULL,
  initials text NOT NULL,
  -- Haché côté serveur, recopié sur la tablette pour la vérification hors ligne.
  pin_hash text,
  pin_reset_required boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff_establishments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  staff_id uuid NOT NULL REFERENCES staff (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  UNIQUE (staff_id, establishment_id)
);

-- Paramètres ------------------------------------------------------------------

CREATE TABLE tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  label text NOT NULL,
  rate_bp integer NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  is_default boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tax_rates_one_default ON tax_rates (tenant_id) WHERE is_default;

CREATE TABLE payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  label text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cash', 'card', 'customer_credit', 'meal_voucher', 'other')),
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reason_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  category text NOT NULL CHECK (category IN ('void', 'comp', 'discount', 'cash_out', 'cash_variance')),
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  device_id uuid REFERENCES devices (id),
  name text NOT NULL,
  connection text NOT NULL CHECK (connection IN ('bluetooth', 'wifi')),
  address text NOT NULL,
  port integer NOT NULL DEFAULT 9100,
  paper_width_mm integer NOT NULL DEFAULT 80 CHECK (paper_width_mm IN (58, 80)),
  prints_receipts boolean NOT NULL DEFAULT false,
  prints_preparation boolean NOT NULL DEFAULT false,
  opens_drawer boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Catalogue -------------------------------------------------------------------

CREATE TABLE families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  -- Nul : famille commune à tous les établissements du client (chaînes).
  establishment_id uuid REFERENCES establishments (id),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#0B1F3A',
  sort integer NOT NULL DEFAULT 0,
  printer_id uuid REFERENCES printers (id),
  tax_rate_id uuid REFERENCES tax_rates (id),
  archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  family_id uuid NOT NULL REFERENCES families (id),
  kind text NOT NULL DEFAULT 'product' CHECK (kind IN ('product', 'menu')),
  name text NOT NULL,
  price_cents bigint NOT NULL CHECK (price_cents >= 0),
  tax_rate_id uuid REFERENCES tax_rates (id),
  -- inherit : imprimante de la famille ; none : aucun bon ; printer : printer_id.
  printer_mode text NOT NULL DEFAULT 'inherit' CHECK (printer_mode IN ('inherit', 'none', 'printer')),
  printer_id uuid REFERENCES printers (id),
  stock_mode text NOT NULL DEFAULT 'none' CHECK (stock_mode IN ('none', 'unit', 'recipe')),
  available boolean NOT NULL DEFAULT true,
  image_url text,
  sort integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((printer_mode = 'printer') = (printer_id IS NOT NULL))
);

CREATE TABLE establishment_item_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  item_id uuid NOT NULL REFERENCES items (id),
  price_cents bigint CHECK (price_cents >= 0),
  available boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (establishment_id, item_id)
);

CREATE TABLE option_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  min_select integer NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select integer NOT NULL DEFAULT 1 CHECK (max_select >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (max_select >= min_select)
);

CREATE TABLE options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  group_id uuid NOT NULL REFERENCES option_groups (id),
  name text NOT NULL,
  extra_cents bigint NOT NULL DEFAULT 0 CHECK (extra_cents >= 0),
  sort integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE item_option_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  item_id uuid NOT NULL REFERENCES items (id),
  group_id uuid NOT NULL REFERENCES option_groups (id),
  sort integer NOT NULL DEFAULT 0,
  UNIQUE (item_id, group_id)
);

-- Menus composés : un item de type 'menu' + des étapes de choix.
CREATE TABLE menu_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  menu_item_id uuid NOT NULL REFERENCES items (id),
  name text NOT NULL,
  min_select integer NOT NULL DEFAULT 1 CHECK (min_select >= 0),
  max_select integer NOT NULL DEFAULT 1 CHECK (max_select >= 1),
  sort integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (max_select >= min_select)
);

CREATE TABLE menu_step_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  step_id uuid NOT NULL REFERENCES menu_steps (id),
  item_id uuid NOT NULL REFERENCES items (id),
  extra_cents bigint NOT NULL DEFAULT 0 CHECK (extra_cents >= 0),
  sort integer NOT NULL DEFAULT 0,
  UNIQUE (step_id, item_id)
);

-- Salle -----------------------------------------------------------------------

CREATE TABLE zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  name text NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dining_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  zone_id uuid NOT NULL REFERENCES zones (id),
  label text NOT NULL,
  seats integer NOT NULL DEFAULT 4 CHECK (seats > 0),
  shape text NOT NULL DEFAULT 'square' CHECK (shape IN ('square', 'round', 'long')),
  x integer NOT NULL DEFAULT 0,
  y integer NOT NULL DEFAULT 0,
  w integer NOT NULL DEFAULT 120,
  h integer NOT NULL DEFAULT 96,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Journée et caisse -----------------------------------------------------------

CREATE TABLE business_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  -- Date d'exploitation = date de l'ouverture, même si la clôture a lieu après minuit.
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid NOT NULL REFERENCES staff (id),
  opening_float_cents bigint NOT NULL CHECK (opening_float_cents >= 0),
  closed_at timestamptz,
  closed_by uuid REFERENCES staff (id),
  z_number integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL AND closed_by IS NOT NULL AND z_number IS NOT NULL))
);
CREATE UNIQUE INDEX business_days_one_open ON business_days (establishment_id) WHERE status = 'open';
CREATE UNIQUE INDEX business_days_z ON business_days (establishment_id, z_number) WHERE z_number IS NOT NULL;

CREATE TABLE cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  business_day_id uuid NOT NULL REFERENCES business_days (id),
  register_label text NOT NULL,
  staff_id uuid NOT NULL REFERENCES staff (id),
  kind text NOT NULL DEFAULT 'register' CHECK (kind IN ('register', 'waiter')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_float_cents bigint NOT NULL DEFAULT 0 CHECK (opening_float_cents >= 0),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  expected_cash_cents bigint,
  counted_cash_cents bigint,
  variance_cents bigint,
  variance_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cash_sessions_one_open_per_register
  ON cash_sessions (business_day_id, register_label) WHERE status = 'open' AND kind = 'register';

CREATE TABLE cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  cash_session_id uuid NOT NULL REFERENCES cash_sessions (id),
  kind text NOT NULL CHECK (kind IN ('out', 'in', 'no_sale', 'waiter_handover')),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  reason_code_id uuid REFERENCES reason_codes (id),
  note text,
  staff_id uuid NOT NULL REFERENCES staff (id),
  approved_by uuid REFERENCES staff (id),
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cash_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  cash_session_id uuid NOT NULL REFERENCES cash_sessions (id),
  payment_method_id uuid NOT NULL REFERENCES payment_methods (id),
  expected_cents bigint NOT NULL,
  counted_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cash_session_id, payment_method_id)
);

-- Clients et ardoises ---------------------------------------------------------

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  full_name text NOT NULL,
  phone text,
  company text,
  ice text,
  credit_limit_cents bigint NOT NULL DEFAULT 0 CHECK (credit_limit_cents >= 0),
  is_default boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_one_default ON customers (tenant_id) WHERE is_default;

-- Montant positif = le client doit plus ; négatif = règlement.
CREATE TABLE customer_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid REFERENCES establishments (id),
  customer_id uuid NOT NULL REFERENCES customers (id),
  kind text NOT NULL CHECK (kind IN ('charge', 'payment', 'adjustment')),
  amount_cents bigint NOT NULL,
  order_id uuid,
  payment_method_id uuid REFERENCES payment_methods (id),
  note text,
  staff_id uuid REFERENCES staff (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'charge' AND amount_cents > 0) OR (kind = 'payment' AND amount_cents < 0) OR kind = 'adjustment')
);

-- Ventes ----------------------------------------------------------------------

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  business_day_id uuid NOT NULL REFERENCES business_days (id),
  -- Numéro continu par poste : préfixe du poste + compteur local (ex. C1-0147).
  number text NOT NULL,
  order_type text NOT NULL CHECK (order_type IN ('dine_in', 'takeaway', 'counter')),
  table_id uuid REFERENCES dining_tables (id),
  call_number integer,
  customer_id uuid NOT NULL REFERENCES customers (id),
  customer_name text,
  waiter_id uuid NOT NULL REFERENCES staff (id),
  covers integer CHECK (covers > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'voided')),
  discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  note text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  device_id uuid REFERENCES devices (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (establishment_id, number),
  CHECK (order_type <> 'dine_in' OR table_id IS NOT NULL)
);

CREATE TABLE order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  order_id uuid NOT NULL REFERENCES orders (id),
  -- Composant d'un menu : pointe vers la ligne du menu, prix unitaire 0 sauf supplément.
  parent_line_id uuid REFERENCES order_lines (id),
  item_id uuid NOT NULL REFERENCES items (id),
  name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  tax_rate_bp integer NOT NULL CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'voided', 'comp')),
  note text,
  printer_id uuid REFERENCES printers (id),
  sent_at timestamptz,
  voided_at timestamptz,
  void_reason_code_id uuid REFERENCES reason_codes (id),
  approved_by uuid REFERENCES staff (id),
  created_by uuid NOT NULL REFERENCES staff (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_line_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  order_line_id uuid NOT NULL REFERENCES order_lines (id),
  option_id uuid NOT NULL REFERENCES options (id),
  name text NOT NULL,
  extra_cents bigint NOT NULL DEFAULT 0 CHECK (extra_cents >= 0)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  order_id uuid NOT NULL REFERENCES orders (id),
  cash_session_id uuid NOT NULL REFERENCES cash_sessions (id),
  payment_method_id uuid NOT NULL REFERENCES payment_methods (id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  tendered_cents bigint CHECK (tendered_cents >= 0),
  change_cents bigint NOT NULL DEFAULT 0 CHECK (change_cents >= 0),
  customer_id uuid REFERENCES customers (id),
  split_label text,
  staff_id uuid NOT NULL REFERENCES staff (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kitchen_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  order_id uuid NOT NULL REFERENCES orders (id),
  printer_id uuid NOT NULL REFERENCES printers (id),
  kind text NOT NULL DEFAULT 'prep' CHECK (kind IN ('prep', 'void')),
  line_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'printed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  printed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Stock -----------------------------------------------------------------------

CREATE TABLE stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  name text NOT NULL,
  unit text NOT NULL,
  min_quantity numeric(12, 3) NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Article unitaire : une seule ligne de quantité 1 ; article à recette : sa fiche technique.
CREATE TABLE recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  item_id uuid NOT NULL REFERENCES items (id),
  stock_item_id uuid NOT NULL REFERENCES stock_items (id),
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  UNIQUE (item_id, stock_item_id)
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  phone text
);

CREATE TABLE stock_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  supplier_id uuid REFERENCES suppliers (id),
  reference text,
  received_on date NOT NULL,
  photo_url text,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  receipt_id uuid NOT NULL REFERENCES stock_receipts (id),
  stock_item_id uuid NOT NULL REFERENCES stock_items (id),
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents >= 0)
);

-- Le stock n'est jamais écrasé : c'est la somme des mouvements.
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid NOT NULL REFERENCES establishments (id),
  stock_item_id uuid NOT NULL REFERENCES stock_items (id),
  quantity numeric(12, 3) NOT NULL CHECK (quantity <> 0),
  kind text NOT NULL CHECK (kind IN ('sale', 'receipt', 'loss', 'inventory', 'adjustment')),
  source_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Traçabilité -----------------------------------------------------------------

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  establishment_id uuid REFERENCES establishments (id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  staff_id uuid REFERENCES staff (id),
  approved_by uuid REFERENCES staff (id),
  reason_code_id uuid REFERENCES reason_codes (id),
  reason_text text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  device_id uuid REFERENCES devices (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Synchronisation -------------------------------------------------------------

-- Chaque opération reçue d'une tablette est enregistrée une seule fois (idempotence).
CREATE TABLE sync_ops (
  op_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  device_id uuid NOT NULL REFERENCES devices (id),
  device_seq bigint NOT NULL CHECK (device_seq > 0),
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  kind text NOT NULL,
  result text NOT NULL CHECK (result IN ('applied', 'rejected')),
  error_code text,
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, device_seq)
);

CREATE TABLE change_log (
  server_seq bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  -- Nul : diffusé à tous les établissements du client.
  establishment_id uuid,
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  op text NOT NULL CHECK (op IN ('upsert', 'delete')),
  data jsonb,
  origin_device_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_log_pull ON change_log (tenant_id, server_seq);

CREATE FUNCTION log_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb;
  est uuid;
  tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := to_jsonb(OLD);
  ELSE
    row_data := to_jsonb(NEW);
  END IF;
  est := NULLIF(row_data ->> 'establishment_id', '')::uuid;
  IF TG_TABLE_NAME = 'establishments' THEN
    est := (row_data ->> 'id')::uuid;
  END IF;
  tenant := CASE WHEN TG_TABLE_NAME = 'tenants' THEN (row_data ->> 'id')::uuid ELSE (row_data ->> 'tenant_id')::uuid END;
  -- Sérialise les écritures du journal par client jusqu'au COMMIT : un numéro
  -- server_seq n'est attribué qu'après la validation des transactions précédentes,
  -- donc une tablette qui tire « tout ce qui suit mon curseur » ne rate jamais rien.
  PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text, 0));
  INSERT INTO change_log (tenant_id, establishment_id, entity, entity_id, op, data, origin_device_id)
  VALUES (
    tenant,
    est,
    TG_TABLE_NAME,
    (row_data ->> 'id')::uuid,
    CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_data END,
    NULLIF(current_setting('app.device_id', true), '')::uuid
  );
  RETURN NULL;
END $$;

CREATE TABLE device_sync_state (
  device_id uuid PRIMARY KEY REFERENCES devices (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  last_device_seq bigint NOT NULL DEFAULT 0,
  last_pulled_seq bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Règles d'inaltérabilité -----------------------------------------------------

CREATE FUNCTION protect_orders() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un ticket ne se supprime jamais' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('paid', 'voided') THEN
    RAISE EXCEPTION 'Ticket % déjà %, modification interdite', OLD.number, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.number <> OLD.number OR NEW.business_day_id <> OLD.business_day_id THEN
    RAISE EXCEPTION 'Numéro et journée d''un ticket sont figés' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION protect_order_children() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  SELECT status INTO st FROM orders
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  IF st IN ('paid', 'voided') THEN
    RAISE EXCEPTION 'Ticket clos : % sur % interdit', TG_OP, TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Une ligne ne se supprime pas, elle s''annule' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION protect_closed_day() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Journée clôturée : modification interdite' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orders_protect BEFORE UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION protect_orders();
CREATE TRIGGER order_lines_protect BEFORE INSERT OR UPDATE OR DELETE ON order_lines FOR EACH ROW EXECUTE FUNCTION protect_order_children();
CREATE TRIGGER business_days_protect BEFORE UPDATE OR DELETE ON business_days FOR EACH ROW EXECUTE FUNCTION protect_closed_day();

CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER cash_movements_append_only BEFORE UPDATE OR DELETE ON cash_movements FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER customer_ledger_append_only BEFORE UPDATE OR DELETE ON customer_ledger FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER change_log_append_only BEFORE UPDATE OR DELETE ON change_log FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER sync_ops_append_only BEFORE UPDATE OR DELETE ON sync_ops FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- updated_at automatique, journal de changements et RLS -----------------------

DO $$
DECLARE
  t text;
  -- Tables descendues sur les tablettes.
  synced text[] := ARRAY[
    'tenants', 'establishments', 'roles', 'staff', 'staff_establishments',
    'tax_rates', 'payment_methods', 'reason_codes', 'printers',
    'families', 'items', 'establishment_item_overrides', 'option_groups', 'options',
    'item_option_groups', 'menu_steps', 'menu_step_choices', 'zones', 'dining_tables',
    'business_days', 'cash_sessions', 'cash_movements', 'cash_counts',
    'customers', 'customer_ledger', 'orders', 'order_lines', 'order_line_options',
    'payments', 'kitchen_tickets'
  ];
  -- Tables isolées par client (toutes sauf le journal technique).
  tenant_scoped text[] := ARRAY[
    'establishments', 'contracts', 'contract_lines', 'rent_invoices',
    'roles', 'staff', 'staff_establishments', 'tax_rates', 'payment_methods', 'reason_codes',
    'printers', 'families', 'items', 'establishment_item_overrides', 'option_groups', 'options',
    'item_option_groups', 'menu_steps', 'menu_step_choices', 'zones', 'dining_tables',
    'business_days', 'cash_sessions', 'cash_movements', 'cash_counts', 'customers',
    'customer_ledger', 'orders', 'order_lines', 'order_line_options', 'payments',
    'kitchen_tickets', 'stock_items', 'recipes', 'suppliers', 'stock_receipts',
    'stock_receipt_lines', 'stock_movements', 'audit_log', 'sync_ops', 'change_log',
    'device_sync_state', 'devices'
  ];
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t || '_touch', t);
  END LOOP;

  FOREACH t IN ARRAY synced LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION log_change()', t || '_log', t);
  END LOOP;

  FOREACH t IN ARRAY tenant_scoped LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO caissebox_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO caissebox_app', t);
  END LOOP;

  ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON tenants TO caissebox_app USING (id = app_tenant_id());
  GRANT SELECT ON tenants TO caissebox_app;
  GRANT USAGE ON SEQUENCE change_log_server_seq_seq TO caissebox_app;
END $$;

-- Les rôles applicatifs n'écrivent jamais le secret d'une tablette ni les comptes web.
REVOKE UPDATE ON devices FROM caissebox_app;
GRANT UPDATE (app_version, last_seen_at) ON devices TO caissebox_app;

-- Index de lecture courants ---------------------------------------------------

CREATE INDEX orders_day ON orders (business_day_id);
CREATE INDEX order_lines_order ON order_lines (order_id);
CREATE INDEX payments_order ON payments (order_id);
CREATE INDEX payments_session ON payments (cash_session_id);
CREATE INDEX customer_ledger_customer ON customer_ledger (customer_id);
CREATE INDEX stock_movements_item ON stock_movements (stock_item_id);
CREATE INDEX audit_log_entity ON audit_log (entity, entity_id);
