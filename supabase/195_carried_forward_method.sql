-- A new way a bill can be settled: its unpaid balance moved onto the same
-- child's bill for a later term (196). On its own so the value exists before
-- 196 uses it; Postgres will not use an enum value added in the same
-- transaction.
alter type classroom.payment_method add value if not exists 'carried_forward';
