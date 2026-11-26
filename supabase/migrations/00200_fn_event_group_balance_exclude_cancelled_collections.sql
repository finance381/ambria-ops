-- fn_event_group_balance's own agg CTE summed every direction='out'
-- event_ledger row straight into spent_paise, with no entry_type filter --
-- but entry_type='adjustment' is used for exactly one thing across this
-- whole codebase (confirmed by migration 00192's own comment, and a grep
-- here finds the same): the reversal fn_wallet_collect_cancel (00051) or
-- fn_extra_plate_cancel (00088) writes when a collection is cancelled.
-- That reversal was landing in spent_paise as if the event had spent the
-- money, while the cancelled collection's own original 'in' row stayed
-- counted in collected_cash_paise/collected_bank_paise forever -- confirmed
-- live on a real contract whose Balance box showed a large, genuine-looking
-- cash surplus that was actually just a cancelled-then-recollected entry
-- never being excluded.
--
-- Nets the adjustment reversal against the SAME payment_mode's collected
-- total instead (a cash cancel reverses cash, a bank cancel reverses bank --
-- confirmed in both 00051 and 00088, which always carry the original
-- collection's own payment_mode forward onto the reversal row), and keeps
-- it out of spent_paise, which should only ever reflect real spend on the
-- event.
CREATE OR REPLACE FUNCTION public.fn_event_group_balance(p_event_ids bigint[])
 RETURNS TABLE(event_id bigint, agreed_cash_paise bigint, agreed_bank_paise bigint, tax_amount_paise bigint, collected_cash_paise bigint, collected_bank_paise bigint, pending_cash_paise bigint, pending_bank_paise bigint, pending_tax_paise bigint, spent_paise bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with agg as (
    select
      event_id,
      coalesce(sum(case
        when direction='in' and payment_mode='cash' then amount_paise
        when direction='out' and entry_type='adjustment' and payment_mode='cash' then -amount_paise
      end), 0) as cc,
      coalesce(sum(case
        when direction='in' and payment_mode='bank' then amount_paise
        when direction='out' and entry_type='adjustment' and payment_mode='bank' then -amount_paise
      end), 0) as cb,
      coalesce(sum(case when direction='out' and entry_type <> 'adjustment' then amount_paise end), 0) as sp
    from public.event_ledger
    where event_id = ANY(p_event_ids)
    group by event_id
  )
  select
    e.id,
    coalesce(e.agreed_cash_paise, 0),
    coalesce(e.agreed_bank_paise, 0),
    coalesce(e.tax_amount_paise, 0),
    coalesce(agg.cc, 0),
    coalesce(agg.cb, 0),
    coalesce(e.agreed_cash_paise, 0) - coalesce(agg.cc, 0),
    greatest(0, coalesce(e.agreed_bank_paise, 0) - coalesce(agg.cb, 0)),
    greatest(0, coalesce(e.tax_amount_paise, 0) - greatest(0, coalesce(agg.cb, 0) - coalesce(e.agreed_bank_paise, 0))),
    coalesce(agg.sp, 0)
  from public.events e
  left join agg on agg.event_id = e.id
  where e.id = ANY(p_event_ids);
$function$;

NOTIFY pgrst, 'reload schema';
