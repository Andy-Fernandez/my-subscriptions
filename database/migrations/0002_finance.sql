CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
  paid_on TEXT NOT NULL,
  note TEXT,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE charge_batches (
  id INTEGER PRIMARY KEY,
  agreement_id INTEGER NOT NULL REFERENCES agreements(id),
  issued_on TEXT NOT NULL,
  due_on TEXT CHECK (due_on IS NULL OR due_on >= issued_on),
  note TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  UNIQUE (agreement_id, issued_on)
);

CREATE TABLE charges (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id),
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  charge_batch_id INTEGER REFERENCES charge_batches(id),
  amount_cents INTEGER NOT NULL CHECK (
    typeof(amount_cents) = 'integer' AND
    (amount_cents > 0 OR (amount_cents = 0 AND charge_batch_id IS NOT NULL))
  ),
  issued_on TEXT NOT NULL,
  due_on TEXT CHECK (due_on IS NULL OR due_on >= issued_on),
  note TEXT,
  idempotency_key TEXT UNIQUE,
  UNIQUE (charge_batch_id, subscription_id)
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  charge_id INTEGER NOT NULL REFERENCES charges(id),
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
  received_on TEXT NOT NULL,
  note TEXT,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE INDEX expenses_date ON expenses (paid_on, id);
CREATE INDEX expenses_service_date ON expenses (service_id, paid_on);
CREATE INDEX charges_date ON charges (issued_on, id);
CREATE INDEX charges_person_date ON charges (person_id, issued_on);
CREATE INDEX charges_service_date ON charges (service_id, issued_on);
CREATE INDEX payments_date ON payments (received_on, id);
CREATE INDEX payments_charge_date ON payments (charge_id, received_on);

CREATE TRIGGER validate_agreement_charge_batch
BEFORE INSERT ON charge_batches
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'finance_agreement_missing')
  WHERE NOT EXISTS (SELECT 1 FROM agreements WHERE id = NEW.agreement_id);

  SELECT RAISE(ABORT, 'finance_agreement_inactive')
  WHERE NOT EXISTS (
    SELECT 1 FROM agreements
    WHERE id = NEW.agreement_id
      AND start_date <= NEW.issued_on
      AND (end_date IS NULL OR NEW.issued_on < end_date)
  );

  SELECT RAISE(ABORT, 'finance_agreement_distribution')
  WHERE NOT EXISTS (
    SELECT 1 FROM agreement_items AS item
    JOIN agreements AS agreement ON agreement.id = item.agreement_id
    WHERE item.agreement_id = NEW.agreement_id
    GROUP BY agreement.id
    HAVING SUM(item.amount_cents) = agreement.amount_cents
  );

  SELECT RAISE(ABORT, 'finance_agreement_already_issued')
  WHERE EXISTS (
    SELECT 1 FROM agreement_items AS item
    JOIN agreements AS agreement ON agreement.id = item.agreement_id
    JOIN charges AS charge ON charge.person_id = agreement.person_id
      AND charge.subscription_id = item.subscription_id
    WHERE item.agreement_id = NEW.agreement_id AND charge.issued_on = NEW.issued_on
      AND charge.charge_batch_id IS NOT NULL
  );
END;

CREATE TRIGGER copy_agreement_charges
AFTER INSERT ON charge_batches
FOR EACH ROW
BEGIN
  INSERT INTO charges (
    charge_batch_id, person_id, subscription_id, service_id, amount_cents, issued_on, due_on, note
  )
  SELECT NEW.id, agreement.person_id, item.subscription_id, subscription.service_id, item.amount_cents,
    NEW.issued_on, NEW.due_on, NEW.note
  FROM agreements AS agreement
  JOIN agreement_items AS item ON item.agreement_id = agreement.id
  JOIN subscriptions AS subscription ON subscription.id = item.subscription_id
  WHERE agreement.id = NEW.agreement_id;
END;

CREATE TRIGGER validate_charge_payment
BEFORE INSERT ON payments
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'finance_charge_missing')
  WHERE NOT EXISTS (SELECT 1 FROM charges WHERE id = NEW.charge_id);

  SELECT RAISE(ABORT, 'finance_payment_before_charge')
  WHERE NEW.received_on < (SELECT issued_on FROM charges WHERE id = NEW.charge_id);

  SELECT RAISE(ABORT, 'finance_payment_over_balance')
  WHERE NEW.amount_cents > (
    SELECT amount_cents FROM charges WHERE id = NEW.charge_id
  ) - COALESCE((SELECT SUM(amount_cents) FROM payments WHERE charge_id = NEW.charge_id), 0);
END;
