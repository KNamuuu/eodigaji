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

-- A3 내 여행 저장: plans(링크=권한) → trips + trip_members (로그인 = 권한)
-- 멤버만 읽고 쓴다. 저장만 한 여행은 나 혼자, [친구 초대]를 누르면 shared=true → 링크로 들어온 로그인 사용자가 join_trip()으로 멤버가 된다.
-- ponytail: 초대 = trip id를 아는 것. A4에서 만료되는 invites 토큰으로 바꾼다.
create table if not exists public.trips (
  id text primary key check (length(id) >= 16),
  owner_id uuid references auth.users(id) on delete cascade, -- 옛 plans에서 옮긴 건 null
  prov text not null default '',
  place text not null,
  title text not null default '',
  tip text not null default '',
  shared boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.trip_members (
  trip_id text not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  primary key (trip_id, user_id)
);
create index if not exists trip_members_user on public.trip_members(user_id);

-- 옛 공유 일정 옮기기 (링크로 쓰던 거라 shared=true → 로그인하고 링크 열면 멤버가 됨). plans는 백업으로 남기고 잠근다
insert into public.trips (id, prov, place, title, tip, shared, created_at)
  select id, prov, place, title, tip, true, created_at from public.plans on conflict (id) do nothing;
alter table public.items drop constraint if exists items_plan_id_fkey;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name = 'plan_id') then
    alter table public.items rename column plan_id to trip_id;
  end if;
end $$;
alter table public.items drop constraint if exists items_trip_id_fkey;
alter table public.items add constraint items_trip_id_fkey foreign key (trip_id) references public.trips(id) on delete cascade;
drop policy if exists plan_by_link on public.plans;
drop policy if exists items_by_link on public.items;
drop function if exists public.req_plan_id();

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;

create or replace function public.is_member(tid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trip_members where trip_id = tid and user_id = (select auth.uid()))
$$;
revoke execute on function public.is_member(text) from public, anon;

drop policy if exists trip_read on public.trips;
create policy trip_read on public.trips for select to authenticated using (public.is_member(id));
drop policy if exists trip_create on public.trips;
create policy trip_create on public.trips for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists trip_edit on public.trips;
create policy trip_edit on public.trips for update to authenticated using (public.is_member(id)) with check (public.is_member(id));
drop policy if exists trip_delete on public.trips;
create policy trip_delete on public.trips for delete to authenticated using (owner_id = (select auth.uid()));
drop policy if exists member_self on public.trip_members;
create policy member_self on public.trip_members for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists items_member on public.items;
create policy items_member on public.items for all to authenticated using (public.is_member(trip_id)) with check (public.is_member(trip_id));

-- 여행을 만들면 만든 사람이 owner 멤버로
create or replace function public.add_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trip_members (trip_id, user_id, role) values (new.id, new.owner_id, 'owner') on conflict do nothing;
  return new;
end $$;
revoke execute on function public.add_owner() from public, anon, authenticated;
drop trigger if exists on_trip_created on public.trips;
create trigger on_trip_created after insert on public.trips for each row when (new.owner_id is not null) execute function public.add_owner();

-- 초대 링크로 들어오기: 공유된 여행만 멤버가 될 수 있다
create or replace function public.join_trip(tid text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.trips where id = tid and shared) then return false; end if;
  insert into public.trip_members (trip_id, user_id) values (tid, auth.uid()) on conflict do nothing;
  return true;
end $$;
revoke execute on function public.join_trip(text) from public, anon;
grant execute on function public.join_trip(text) to authenticated;

-- A4 친구 초대 v2: 초대 토큰(7일) → 로그인 → accept_invite()로 멤버. trip id만 알아서는 못 들어온다
create table if not exists public.invites (
  token text primary key check (length(token) >= 16),
  trip_id text not null references public.trips(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days'
);
alter table public.invites enable row level security;
drop policy if exists invite_create on public.invites;
create policy invite_create on public.invites for insert to authenticated
  with check (public.is_member(trip_id) and created_by = (select auth.uid()) and expires_at <= now() + interval '7 days');

create or replace function public.accept_invite(tok text) returns text
language plpgsql security definer set search_path = '' as $$
declare tid text;
begin
  select trip_id into tid from public.invites where token = tok and expires_at > now();
  if auth.uid() is null or tid is null then return null; end if;
  insert into public.trip_members (trip_id, user_id) values (tid, auth.uid()) on conflict do nothing;
  return tid;
end $$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- 옛 링크(A3 이전 plans에서 옮겨온, 주인 없는 trip)만 id로 들어올 수 있다
-- ponytail: 옛 링크 7건 호환용. 다 정리되면 join_trip을 지운다
create or replace function public.join_trip(tid text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.trips where id = tid and owner_id is null) then return false; end if;
  insert into public.trip_members (trip_id, user_id) values (tid, auth.uid()) on conflict do nothing;
  return true;
end $$;

-- 일정 위 멤버 아바타: 같은 trip 멤버의 이름·사진 (내가 멤버일 때만)
create or replace function public.trip_people(tid text) returns table (user_id uuid, nickname text, avatar_url text, role text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.nickname, p.avatar_url, m.role from public.trip_members m left join public.profiles p on p.id = m.user_id
  where m.trip_id = tid and public.is_member(tid) order by m.role = 'owner' desc, p.nickname
$$;
revoke execute on function public.trip_people(text) from public, anon;
grant execute on function public.trip_people(text) to authenticated;
