begin;
update public.workflows set is_active=false,updated_at=now()
where organization_id='36971ff5-fd73-4f30-a733-04bf8c90e5b6' and id='9dd137e9-e6cb-4ca2-8351-975a0982ecaf';
commit;
