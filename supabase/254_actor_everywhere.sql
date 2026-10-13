-- Server functions that act FOR a signed-in person say so (2026-10-08).
--
-- 253 stamped every live update with its actor: auth.uid(), or for work an
-- Edge Function does on someone's behalf, classroom.actor. But the database
-- functions those Edge Functions call took the person as an argument
-- without setting classroom.actor, so sending a ticket email (ticket-mail-
-- send → record_outbound_ticket_message) bumped the ticket with no actor and
-- the sender was told "1 new update · Reload" for their own reply. The same
-- gap was in admissions messages, family accounts, mail sending, imports and
-- a few console actions. Each now sets classroom.actor to the person it acts
-- for, first thing, so every broadcast and audit entry it causes is theirs.

do $do$
declare
  f record;
  d text;
  at int;
  arg text;
begin
  for f in
    select p.oid, p.oid::regprocedure::text as sig, x.arg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      join (values
        ('record_outbound_ticket_message', 'actor'),
        ('record_admission_message', 'sent_by_in'),
        ('finish_family_accounts', 'actor'),
        ('mail_send_as', 'actor'),
        ('mail_import_create', 'actor'),
        ('platform_grant_admin', 'actor'),
        ('platform_save_settings', 'actor'),
        ('record_email_change', 'actor'),
        ('record_password_reset', 'actor'),
        ('start_subscription_payment', 'actor')
      ) as x(fn, arg) on x.fn = p.proname
     where n.nspname = 'classroom'
  loop
    d := pg_get_functiondef(f.oid);
    if position('classroom.actor' in d) > 0 then continue; end if;
    if position('LANGUAGE sql' in d) > 0 then
      -- A plain SQL function: one more statement in front.
      at := position('$function$' in d) + length('$function$');
      d := substr(d, 1, at) || E'\n  select set_config(''classroom.actor'', coalesce(' || quote_ident(f.arg) || E'::text, ''''), true);'
           || substr(d, at + 1);
    else
      -- PL/pgSQL: the first BEGIN of the body (after its DECLARE section, if any).
      at := position(E'\nbegin' in lower(substr(d, position('$function$' in d))));
      if at = 0 then raise exception 'no begin in %', f.sig; end if;
      at := position('$function$' in d) + at - 1 + length(E'\nbegin');
      d := substr(d, 1, at) || E'\n  perform set_config(''classroom.actor'', coalesce(' || quote_ident(f.arg) || E'::text, ''''), true);'
           || substr(d, at + 1);
    end if;
    execute d;
    if position('classroom.actor' in pg_get_functiondef(f.oid)) = 0 then raise exception 'patch did not apply to %', f.sig; end if;
  end loop;
end
$do$;
