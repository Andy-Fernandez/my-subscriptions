CREATE VIEW IF NOT EXISTS active_subscription_ids AS
SELECT subscriptions.id
FROM subscriptions
JOIN services ON services.id = subscriptions.service_id
WHERE subscriptions.active = 1 AND services.active = 1;
