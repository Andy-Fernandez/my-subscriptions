CREATE TABLE services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  CHECK (length(trim(name)) > 0)
) STRICT;

CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  contact TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  CHECK (length(trim(name)) > 0)
) STRICT;

CREATE TABLE access_accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  login TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  CHECK (length(trim(name)) > 0 AND length(trim(login)) > 0)
) STRICT;

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id),
  access_account_id INTEGER REFERENCES access_accounts(id),
  name TEXT NOT NULL COLLATE NOCASE,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (service_id, name),
  CHECK (length(trim(name)) > 0)
) STRICT;

CREATE INDEX subscriptions_access_account ON subscriptions(access_account_id);

CREATE TABLE memberships (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id),
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  start_date TEXT NOT NULL,
  end_date TEXT,
  CHECK (end_date IS NULL OR end_date >= start_date)
) STRICT;

CREATE INDEX memberships_person_subscription_date
  ON memberships(person_id, subscription_id, start_date);
CREATE INDEX memberships_subscription_date
  ON memberships(subscription_id, start_date);

CREATE TABLE agreements (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id),
  previous_agreement_id INTEGER UNIQUE REFERENCES agreements(id),
  name TEXT NOT NULL COLLATE NOCASE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  start_date TEXT NOT NULL,
  end_date TEXT,
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (length(trim(name)) > 0)
) STRICT;

CREATE INDEX agreements_person_date ON agreements(person_id, start_date);

CREATE TABLE agreement_items (
  agreement_id INTEGER NOT NULL REFERENCES agreements(id),
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  PRIMARY KEY (agreement_id, subscription_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX agreement_items_subscription
  ON agreement_items(subscription_id, agreement_id);

CREATE TABLE service_cost_history (
  id INTEGER PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  start_date TEXT NOT NULL,
  end_date TEXT,
  CHECK (end_date IS NULL OR end_date >= start_date)
) STRICT;

CREATE INDEX service_cost_history_subscription_date
  ON service_cost_history(subscription_id, start_date);

CREATE UNIQUE INDEX service_cost_history_open
  ON service_cost_history(subscription_id) WHERE end_date IS NULL;

CREATE TRIGGER memberships_non_overlapping
BEFORE INSERT ON memberships
WHEN NEW.end_date IS NULL OR NEW.end_date > NEW.start_date
BEGIN
  SELECT RAISE(ABORT, 'membership_overlap')
  WHERE EXISTS (
    SELECT 1
    FROM memberships
    WHERE person_id = NEW.person_id AND subscription_id = NEW.subscription_id
      AND (end_date IS NULL OR (end_date > start_date AND NEW.start_date < end_date))
      AND (NEW.end_date IS NULL OR start_date < NEW.end_date)
  );
END;

CREATE TRIGGER agreement_items_non_overlapping
BEFORE INSERT ON agreement_items
BEGIN
  SELECT RAISE(ABORT, 'agreement_overlap')
  WHERE EXISTS (
    SELECT 1
    FROM agreements AS proposed
    JOIN agreement_items AS item ON item.subscription_id = NEW.subscription_id
    JOIN agreements AS existing ON existing.id = item.agreement_id
    WHERE proposed.id = NEW.agreement_id AND existing.person_id = proposed.person_id
      AND (proposed.end_date IS NULL OR proposed.end_date > proposed.start_date)
      AND (existing.end_date IS NULL OR
        (existing.end_date > existing.start_date AND proposed.start_date < existing.end_date))
      AND (proposed.end_date IS NULL OR existing.start_date < proposed.end_date)
  );
END;
