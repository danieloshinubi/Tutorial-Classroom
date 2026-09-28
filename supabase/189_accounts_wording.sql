-- Accounts wording, from testing with a bursar's eyes:
--
-- 1. Stock coming in is "Stock received: 100 × Exercise book", not
--    "Restock: ...". The first load of an item is not a restock, and read as
--    though more had been bought. Past entries keep their memo (posted
--    entries are never edited).
-- 2. Opening balance equity is explained in plain words where it is shown.

do $$
declare
  def text;
begin
  select pg_get_functiondef('classroom.acct_post_stock_movement(uuid)'::regprocedure) into def;
  if position('Stock received: %s × %s' in def) > 0 then
    return; -- already applied
  end if;
  if position('Restock: %s × %s' in def) = 0 then
    raise exception 'acct_post_stock_movement: anchor not found, nothing changed';
  end if;
  execute replace(def, 'Restock: %s × %s', 'Stock received: %s × %s');
end;
$$;

update classroom.chart_of_accounts
set description = 'The balancing figure from the opening balances. Ask your accountant to move it to capital or retained earnings.'
where system_key = 'opening_equity'
  and description = 'Balances the opening entry; move it to capital or retained earnings once settled.';

do $$
declare
  def text;
begin
  select pg_get_functiondef('classroom.acct_seed_chart(uuid)'::regprocedure) into def;
  if position('Balances the opening entry; move it to capital or retained earnings once settled.' in def) = 0 then
    return;
  end if;
  execute replace(def,
    'Balances the opening entry; move it to capital or retained earnings once settled.',
    'The balancing figure from the opening balances. Ask your accountant to move it to capital or retained earnings.');
end;
$$;
