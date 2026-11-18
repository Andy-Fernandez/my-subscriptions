CREATE TABLE vault_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  salt TEXT NOT NULL,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version = 1)
);

CREATE TABLE credential_secrets (
  access_account_id INTEGER PRIMARY KEY REFERENCES access_accounts(id) ON DELETE RESTRICT,
  vault_id INTEGER NOT NULL DEFAULT 1 REFERENCES vault_settings(id),
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);
