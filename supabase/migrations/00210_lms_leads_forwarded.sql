-- Forwarded leads. LMS passes a lead on from one department to another --
-- most Decor leads (161 of 248, Nov 2026) arrive "Forwarded from Venue
-- (00848) by Sahaj": the lead row carries <h>forward_dept and
-- <h>forward_contractno (the Venue contract it came from), and the
-- forwarder is that contract's creator. lms-leads-sync fills these.
alter table public.lms_leads add column if not exists forwarded_from text;         -- department it came from
alter table public.lms_leads add column if not exists forwarded_contract_no text;  -- that department's contract no
alter table public.lms_leads add column if not exists forwarded_date date;
alter table public.lms_leads add column if not exists forwarded_by_lms_id text;    -- creator of that contract

NOTIFY pgrst, 'reload schema';
