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

-- A2 로그인: 가입하면 profiles 행이 자동으로 생긴다 (닉네임·사진은 구글/카카오 정보 → 없으면 이메일 앞부분)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null default '',
  avatar_url text not null default ''
);
alter table public.profiles enable row level security;
drop policy if exists profile_self_read on public.profiles;
create policy profile_self_read on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists profile_self_update on public.profiles;
create policy profile_self_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nickname, avatar_url) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1), ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', '')
  ) on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
