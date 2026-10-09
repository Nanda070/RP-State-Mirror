-- The bot hears about changes the moment they commit instead of polling or waiting for a cache to expire:
--   jobs     — a job became due (new, or put back to PENDING): the worker looks at the queue at once;
--   settings — system_settings changed: the bot drops its settings cache;
--   reference — factions, role mappings or guilds changed: the bot drops its reference cache;
--   bans     — technical bans changed: the bot reloads its ban list.
-- NOTIFY is delivered on commit and repeated payloads of one transaction are merged, so a batch is one signal.
CREATE OR REPLACE FUNCTION mirror_notify_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('mirror_changes', TG_ARGV[0]);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_notify_due
  AFTER INSERT OR UPDATE OF status ON jobs
  FOR EACH ROW WHEN (NEW.status = 'PENDING')
  EXECUTE FUNCTION mirror_notify_change('jobs');

CREATE TRIGGER system_settings_notify
  AFTER INSERT OR UPDATE OR DELETE ON system_settings
  FOR EACH STATEMENT EXECUTE FUNCTION mirror_notify_change('settings');

CREATE TRIGGER factions_notify
  AFTER INSERT OR UPDATE OR DELETE ON factions
  FOR EACH STATEMENT EXECUTE FUNCTION mirror_notify_change('reference');

CREATE TRIGGER role_mappings_notify
  AFTER INSERT OR UPDATE OR DELETE ON role_mappings
  FOR EACH STATEMENT EXECUTE FUNCTION mirror_notify_change('reference');

CREATE TRIGGER guilds_notify
  AFTER INSERT OR UPDATE OR DELETE ON guilds
  FOR EACH STATEMENT EXECUTE FUNCTION mirror_notify_change('reference');

CREATE TRIGGER tech_bans_notify
  AFTER INSERT OR UPDATE OR DELETE ON tech_bans
  FOR EACH STATEMENT EXECUTE FUNCTION mirror_notify_change('bans');
