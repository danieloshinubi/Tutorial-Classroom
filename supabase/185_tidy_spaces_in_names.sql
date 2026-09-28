-- Names are matched "ignoring case and spacing" — now for real.
--
-- Found in testing the store: " test cardigan " / "size 8 " saved beside
-- "TEST Cardigan" / "Size 8" — a second item for the same thing, splitting
-- its stock in two. The duplicate rules compared lower(btrim(name)), and
-- btrim only trims the ends, so a doubled space inside a name ("test
-- cardigan") got through, and was stored that way. The app's own error
-- message promises spacing is ignored.
--
-- So names are tidied as they are saved — ends trimmed, any run of spaces
-- made one — and the duplicate rules compare tidied names. Applied to the
-- four places that make that promise: store items, the fee catalogue, a fee
-- structure's lines and discount rules.
--
-- Checked before writing this: nothing already stored clashes under the
-- stricter rule, in any school.

create or replace function classroom.tidy_spaces(value text)
returns text
language sql
immutable
as $fn$
  select nullif(regexp_replace(btrim(value), '\s+', ' ', 'g'), '');
$fn$;

/* -- tidy on the way in ---------------------------------------------------- */
create or replace function classroom.tidy_store_product_names()
returns trigger language plpgsql as $fn$
begin
  new.name := coalesce(classroom.tidy_spaces(new.name), new.name);
  new.size := classroom.tidy_spaces(new.size);
  new.supplier := classroom.tidy_spaces(new.supplier);
  return new;
end;
$fn$;

create or replace function classroom.tidy_label()
returns trigger language plpgsql as $fn$
begin
  new.label := coalesce(classroom.tidy_spaces(new.label), new.label);
  return new;
end;
$fn$;

create or replace function classroom.tidy_name()
returns trigger language plpgsql as $fn$
begin
  new.name := coalesce(classroom.tidy_spaces(new.name), new.name);
  return new;
end;
$fn$;

drop trigger if exists store_products_tidy on classroom.store_products;
create trigger store_products_tidy before insert or update on classroom.store_products
  for each row execute function classroom.tidy_store_product_names();

drop trigger if exists fee_catalogue_tidy on classroom.fee_catalogue;
create trigger fee_catalogue_tidy before insert or update on classroom.fee_catalogue
  for each row execute function classroom.tidy_label();

drop trigger if exists discount_rules_tidy on classroom.discount_rules;
create trigger discount_rules_tidy before insert or update on classroom.discount_rules
  for each row execute function classroom.tidy_label();

drop trigger if exists fee_items_tidy on classroom.fee_items;
create trigger fee_items_tidy before insert or update on classroom.fee_items
  for each row execute function classroom.tidy_name();

/* -- tidy what is already there -------------------------------------------- */
update classroom.store_products
   set name = name
 where name is distinct from classroom.tidy_spaces(name)
    or size is distinct from classroom.tidy_spaces(size)
    or supplier is distinct from classroom.tidy_spaces(supplier);
update classroom.fee_catalogue set label = label where label is distinct from classroom.tidy_spaces(label);
update classroom.discount_rules set label = label where label is distinct from classroom.tidy_spaces(label);
update classroom.fee_items set name = name where name is distinct from classroom.tidy_spaces(name);

/* -- compare tidied names -------------------------------------------------- */
drop index if exists classroom.store_products_once;
create unique index store_products_once
  on classroom.store_products (school_id, lower(classroom.tidy_spaces(name)), lower(coalesce(classroom.tidy_spaces(size), '')));

drop index if exists classroom.fee_catalogue_label_once;
create unique index fee_catalogue_label_once
  on classroom.fee_catalogue (school_id, lower(classroom.tidy_spaces(label)));

drop index if exists classroom.discount_rules_label_once;
create unique index discount_rules_label_once
  on classroom.discount_rules (school_id, lower(classroom.tidy_spaces(label)));

drop index if exists classroom.fee_items_name_once_per_structure;
create unique index fee_items_name_once_per_structure
  on classroom.fee_items (structure_id, lower(classroom.tidy_spaces(name)));
