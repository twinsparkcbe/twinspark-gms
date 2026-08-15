-- Adds the PURCHASE_RETURN stock movement reason ahead of the Purchase
-- module schema (0009_purchase_schema.sql). Split into its own migration
-- because a newly added enum value cannot safely be used by DDL/DML in the
-- same transaction it was added in — keeping this as a standalone file (its
-- own transaction) avoids that entirely, rather than relying on
-- version-specific Postgres behavior.
alter type public.stock_movement_reason add value 'PURCHASE_RETURN';
