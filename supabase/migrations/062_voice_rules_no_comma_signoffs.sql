-- Add explicit voice rules banning the AI-tell of trailing commas after
-- sign-off phrases. The salutation comma ("Hi Adria,") is harder to catch
-- via simple string matching because the name varies; we enforce it in the
-- LLM prompt instead. This migration adds the SIGN-OFF patterns we can
-- detect reliably.

INSERT INTO voice_rules (rule_type, pattern, replacement, severity, channel, notes) VALUES
  ('banned_phrase','Best regards,','Use "Best regards" with no comma','block','all','Trailing-comma sign-off is an AI tell'),
  ('banned_phrase','Kind regards,','Use "Kind regards" with no comma','block','all','Trailing-comma sign-off is an AI tell'),
  ('banned_phrase','Regards,','Use "Regards" with no comma','block','all','Trailing-comma sign-off is an AI tell'),
  ('banned_phrase','All the best,','Use "All the best" with no comma','block','all','Trailing-comma sign-off is an AI tell'),
  ('banned_phrase','Many thanks,','Use "Many thanks" with no comma','block','all','Trailing-comma sign-off is an AI tell'),
  ('banned_phrase','Cheers,','Use "Cheers" with no comma','block','all','Trailing-comma sign-off is an AI tell'),
  ('banned_phrase','Thanks,','Use "Thanks" with no comma at sign-off','warn','all','Banned at sign-off; acceptable in body'),
  ('banned_phrase','Best,','Use "Best regards" or "All the best" without trailing comma','block','all','Trailing-comma sign-off is an AI tell'),
  ('banned_phrase','Apologies for the uncertainty','Drop. Be confident. The contact is in our follow-up list because we DID meet them.','block','all','Hedging tell - never apologise for context we already have'),
  ('banned_phrase','I cannot confirm whether','Drop. State what we know.','block','all','Hedging tell'),
  ('banned_phrase','whether we connected at all','Drop. We connected - that is why they are in our follow-up list.','block','all','Hedging tell'),
  ('banned_phrase','before diving into specifics','Drop the throat-clearing. Get to the point.','block','all','Throat-clearing'),
  ('banned_phrase','before we get into the details','Drop the throat-clearing. Get to the point.','block','all','Throat-clearing')
ON CONFLICT (rule_type, lower(pattern), channel) DO NOTHING;

DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM voice_rules WHERE active = true;
  RAISE NOTICE 'voice_rules: % active rules after seed', n;
END $$;
