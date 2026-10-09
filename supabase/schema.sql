-- 공유 일정: 링크(plan id)를 아는 사람만 읽고 쓸 수 있다.
-- 클라이언트가 x-plan-id 헤더로 id를 보내고, RLS가 그 id의 행만 허용한다 (전체 목록 조회 불가).
create table if not exists plans (
  id text primary key check (length(id) >= 16),
  prov text not null default '',
  place text not null,
  title text not null default '',
  tip text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null references plans(id) on delete cascade,
  day int not null,
  time text not null default '',
  what text not null default ''
);
create index if not exists items_plan_id on items(plan_id);

alter table plans enable row level security;
alter table items enable row level security;

create or replace function req_plan_id() returns text language sql stable as $$
  select current_setting('request.headers', true)::json->>'x-plan-id'
$$;

drop policy if exists plan_by_link on plans;
create policy plan_by_link on plans for all to anon using (id = req_plan_id()) with check (id = req_plan_id());
drop policy if exists items_by_link on items;
create policy items_by_link on items for all to anon using (plan_id = req_plan_id()) with check (plan_id = req_plan_id());
