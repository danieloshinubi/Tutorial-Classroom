-- Mail domains and Microsoft 365 linking (2026-10-15).
--
-- 1. A domain was "taken" by whichever school typed it first, verified or
--    not, so anyone could block a school from its own domain by claiming it
--    early. Now the school that proves it owns the domain (its DNS records
--    verified) holds it; an unverified claim blocks nobody.
-- 2. Microsoft 365 (bringing old mail across) is linked only for a school
--    whose own domain is verified, and one Microsoft 365 organisation can be
--    linked to one school only.

do $do$
declare d text;
begin
  d := replace(pg_get_functiondef('classroom.mail_domain_taken(text,uuid)'::regprocedure), chr(13), '');
  d := replace(d, 'where domain = lower(btrim(domain_in)) and school_id <> target_school)',
                  'where domain = lower(btrim(domain_in)) and school_id <> target_school and domain_status = ''verified'')');
  if position('domain_status = ''verified''' in d) = 0 then raise exception 'mail_domain_taken patch did not apply'; end if;
  execute d;

  d := replace(pg_get_functiondef('classroom.mail_settings_save(uuid,text,text,text,text,jsonb,text,text,text,text,uuid)'::regprocedure), chr(13), '');
  d := replace(d, 'exists (select 1 from classroom.mail_settings where domain = lower(domain_in) and school_id <> target_school)',
                  'exists (select 1 from classroom.mail_settings where domain = lower(domain_in) and school_id <> target_school and domain_status = ''verified'')');
  if position('domain_status = ''verified''' in d) = 0 then raise exception 'mail_settings_save patch did not apply'; end if;
  execute d;
end;
$do$;

drop index if exists classroom.mail_settings_domain_key;
create unique index if not exists mail_settings_verified_domain_key on classroom.mail_settings (domain)
  where domain is not null and domain_status = 'verified';

create unique index if not exists mail_settings_microsoft_tenant_key on classroom.mail_settings (lower(microsoft_tenant))
  where microsoft_tenant is not null;

do $do$
declare d text;
begin
  d := replace(pg_get_functiondef('classroom.mail_set_microsoft_tenant(uuid,text,uuid)'::regprocedure), chr(13), '');
  d := replace(d, $a$  insert into classroom.mail_settings (school_id) values (target_school) on conflict (school_id) do nothing;$a$,
                  $b$  insert into classroom.mail_settings (school_id) values (target_school) on conflict (school_id) do nothing;
  if tenant_in is not null then
    if not exists (select 1 from classroom.mail_settings where school_id = target_school and domain_status = 'verified') then
      raise exception 'Verify the school''s own domain under Mail settings first.';
    end if;
    if exists (select 1 from classroom.mail_settings where lower(microsoft_tenant) = lower(tenant_in) and school_id <> target_school) then
      raise exception 'That Microsoft 365 organisation is already linked to another school.';
    end if;
  end if;$b$);
  if position('already linked to another school' in d) = 0 then raise exception 'mail_set_microsoft_tenant patch did not apply'; end if;
  execute d;
end;
$do$;

notify pgrst, 'reload schema';
