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

-- C1 다녀옴 + 기록: trip에 상태·날짜, 기록(posts)은 사진 경로 배열 + 한 줄 + 공개 여부
-- 사진은 비공개 버킷 photos/{user_id}/{post_id}/{n}.webp (Safari는 webp 인코딩이 안 돼서 .jpg) — 읽기는 "그 사진이 든 기록을 볼 수 있으면" (posts RLS를 그대로 탄다)
-- ponytail: trip을 지워도 Storage 사진은 남는다. D3(계정 삭제)에서 같이 정리
alter table public.trips add column if not exists status text not null default 'planned' check (status in ('planned', 'done'));
alter table public.trips add column if not exists done_on date;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  trip_id text not null references public.trips(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  prov text not null,
  place text not null,
  body text not null default '' check (length(body) <= 500),
  place_name text not null default '', -- 제휴 대비: 장소 이름 (선택)
  photos text[] not null default '{}' check (cardinality(photos) <= 10),
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists posts_trip on public.posts(trip_id);
create index if not exists posts_region on public.posts(prov, place);
alter table public.posts enable row level security;
drop policy if exists post_read on public.posts;
create policy post_read on public.posts for select to authenticated
  using (is_public or user_id = (select auth.uid()) or public.is_member(trip_id));
drop policy if exists post_create on public.posts;
create policy post_create on public.posts for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member(trip_id));
drop policy if exists post_edit on public.posts;
create policy post_edit on public.posts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.is_member(trip_id));
drop policy if exists post_delete on public.posts;
create policy post_delete on public.posts for delete to authenticated using (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('photos', 'photos', false, 1048576, array['image/webp', 'image/jpeg'])
  on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/webp', 'image/jpeg'];
drop policy if exists photo_upload on storage.objects;
create policy photo_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists photo_read on storage.objects;
create policy photo_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and ((storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.posts p where objects.name = any(p.photos))));
drop policy if exists photo_delete on storage.objects;
create policy photo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- D1 모두의 후기 + 신고: 신고는 한 사람이 한 기록에 한 번, 남의 공개 기록만. 3건이 모이면 hidden → 작성자·같은 trip 멤버 말고는 안 보임 (사진도 photo_read가 posts RLS를 타서 같이 막힘)
alter table public.posts add column if not exists hidden boolean not null default false;
drop policy if exists post_read on public.posts;
create policy post_read on public.posts for select to authenticated
  using ((is_public and not hidden) or user_id = (select auth.uid()) or public.is_member(trip_id));
-- 작성자가 hidden을 직접 풀지 못하게: 수정은 한 줄·공개·장소 이름만
revoke update on public.posts from authenticated, anon;
grant update (body, is_public, place_name) on public.posts to authenticated;

create table if not exists public.reports (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'abuse', 'privacy', 'etc')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.reports enable row level security;
drop policy if exists report_create on public.reports;
create policy report_create on public.reports for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.posts p where p.id = post_id and p.is_public and not p.hidden and p.user_id <> (select auth.uid())));
drop policy if exists report_self on public.reports;
create policy report_self on public.reports for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.hide_reported() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.reports where post_id = new.post_id) >= 3 then
    update public.posts set hidden = true where id = new.post_id;
  end if;
  return null;
end $$;
revoke execute on function public.hide_reported() from public, anon, authenticated;
drop trigger if exists on_report on public.reports;
create trigger on_report after insert on public.reports for each row execute function public.hide_reported();

-- D3 계정 삭제: 사진은 클라이언트가 먼저 Storage API로 photos/{내 id}/ 를 다 지운다 (storage.objects는 SQL로 못 지움) → delete_me()
-- 내가 주인인데 다른 멤버가 있는 trip은 그 멤버에게 넘긴다 (안 그러면 cascade로 남의 일정·기록까지 사라짐). 나머지는 auth.users cascade
create or replace function public.delete_me() returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  with heir as (
    select distinct on (trip_id) trip_id, user_id from public.trip_members m
    where user_id <> me and exists (select 1 from public.trips t where t.id = m.trip_id and t.owner_id = me)
    order by trip_id, role = 'owner' desc, user_id
  ), moved as (
    update public.trips t set owner_id = heir.user_id from heir where t.id = heir.trip_id returning t.id, t.owner_id
  )
  update public.trip_members m set role = 'owner' from moved where m.trip_id = moved.id and m.user_id = moved.owner_id;
  delete from auth.users where id = me;
end $$;
revoke execute on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;

-- D4 사진 지도: 지도엔 썸네일 photos/{uid}/{post}/t{n}.webp(긴 변 400px)만 받는다. 썸네일은 posts.photos에 없으므로
-- 읽기를 "그 기록 폴더(post id) 안 파일이면 그 기록을 볼 수 있을 때"로 넓힌다 (여전히 posts RLS를 탄다)
-- ponytail: p.id::text 비교라 pk 인덱스를 못 탐 (uuid 캐스트는 이상한 폴더 이름에서 에러). 기록이 수만 개 되면 posts에 thumbs 컬럼으로
drop policy if exists photo_read on storage.objects;
create policy photo_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and ((storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.posts p where p.id::text = (storage.foldername(objects.name))[2])));
-- 대표사진: 여행 멤버가 고른 사진 경로 (그 여행 기록의 사진). 내 지도에서 그 지역을 이 사진으로 채움
alter table public.trips add column if not exists cover text;

-- D5 남의 일정 보기: trip을 공개하면(is_public, 기본 false) 로그인 사용자 누구나 읽기만 한다 (D6에서 테이블 공개 읽기 → public_trips() RPC로 바꿈)
-- 그래서 "내 여행" 목록들은 이제 RLS만 믿지 않고 trip_members!inner로 내가 멤버인 것만 고른다 (Me·Home·Region)
-- 신고는 D1 reports를 같이 쓴다 (post_id 또는 trip_id 하나). 3건이면 trips.hidden → 공개 목록에서 빠짐. 작성자 이름은 어디에도 안 내보냄
alter table public.trips add column if not exists is_public boolean not null default false;
alter table public.trips add column if not exists hidden boolean not null default false;
drop policy if exists trip_public_read on public.trips;
create policy trip_public_read on public.trips for select to authenticated using (is_public and not hidden);
drop policy if exists items_public_read on public.items;
create policy items_public_read on public.items for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.is_public and not t.hidden));
-- 멤버가 hidden·owner를 직접 못 바꾸게: 고칠 수 있는 칸만
revoke update on public.trips from authenticated, anon;
grant update (title, tip, shared, status, done_on, cover, is_public) on public.trips to authenticated;

alter table public.reports drop constraint if exists reports_pkey;
alter table public.reports alter column post_id drop not null;
alter table public.reports add column if not exists trip_id text references public.trips(id) on delete cascade;
alter table public.reports drop constraint if exists report_target;
alter table public.reports add constraint report_target check (num_nonnulls(post_id, trip_id) = 1);
create unique index if not exists reports_post_user on public.reports(post_id, user_id);
create unique index if not exists reports_trip_user on public.reports(trip_id, user_id);
drop policy if exists report_create on public.reports;
create policy report_create on public.reports for insert to authenticated
  with check (user_id = (select auth.uid()) and (
    exists (select 1 from public.posts p where p.id = post_id and p.is_public and not p.hidden and p.user_id <> (select auth.uid()))
    or exists (select 1 from public.trips t where t.id = trip_id and t.is_public and not t.hidden and not public.is_member(t.id))));

create or replace function public.hide_reported() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.post_id is not null and (select count(*) from public.reports where post_id = new.post_id) >= 3 then
    update public.posts set hidden = true where id = new.post_id;
  elsif new.trip_id is not null and (select count(*) from public.reports where trip_id = new.trip_id) >= 3 then
    update public.trips set hidden = true where id = new.trip_id;
  end if;
  return null;
end $$;

-- D6 다듬기 묶음
-- (1) 공개 일정은 public_trips() RPC로만 읽는다 → owner_id 등 작성자를 알 수 있는 값이 API로 안 나감. D5의 테이블 공개 읽기 정책은 걷어낸다
drop policy if exists trip_public_read on public.trips;
drop policy if exists items_public_read on public.items;
create or replace function public.is_public_trip(tid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trips where id = tid and is_public and not hidden)
$$;
revoke execute on function public.is_public_trip(text) from public, anon;
grant execute on function public.is_public_trip(text) to authenticated;

-- 따라 짜기(copied_from)·좋아요·가는 날
alter table public.trips add column if not exists copied_from text references public.trips(id) on delete set null;
alter table public.trips add column if not exists start_on date;
grant update (title, tip, shared, status, done_on, cover, is_public, start_on) on public.trips to authenticated;
drop policy if exists trip_create on public.trips;
create policy trip_create on public.trips for insert to authenticated
  with check (owner_id = (select auth.uid()) and (copied_from is null or public.is_public_trip(copied_from))); -- 아무 trip에나 "따라 짬" 숫자를 못 올리게
create table if not exists public.trip_likes (
  trip_id text not null references public.trips(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (trip_id, user_id)
);
alter table public.trip_likes enable row level security;
drop policy if exists like_self on public.trip_likes;
create policy like_self on public.trip_likes for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists like_create on public.trip_likes;
create policy like_create on public.trip_likes for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_public_trip(trip_id) and not public.is_member(trip_id));
drop policy if exists like_delete on public.trip_likes;
create policy like_delete on public.trip_likes for delete to authenticated using (user_id = (select auth.uid()));

-- 지역의 공개 일정 (내가 멤버인 건 빼고) 또는 p_id 하나. sort = 'hot'(좋아요 + 따라 짬×2) | 'new'
drop function if exists public.public_trips(text, text, text, int, text);
create or replace function public.public_trips(p_prov text, p_place text, sort text default 'hot', lim int default 30, p_id text default null)
returns table (id text, prov text, place text, title text, tip text, done_on date, items jsonb, likes int, copies int, liked boolean)
language sql stable security definer set search_path = '' as $$
  select id, prov, place, title, tip, done_on, items, likes, copies, liked from (
    select t.id, t.prov, t.place, t.title, t.tip, t.done_on, t.created_at,
      coalesce((select jsonb_agg(jsonb_build_object('day', i.day, 'time', i.time, 'what', i.what)) from public.items i where i.trip_id = t.id), '[]') items,
      (select count(*) from public.trip_likes l where l.trip_id = t.id)::int likes,
      (select count(*) from public.trips c where c.copied_from = t.id)::int copies,
      exists (select 1 from public.trip_likes l where l.trip_id = t.id and l.user_id = (select auth.uid())) liked
    from public.trips t
    where (select auth.uid()) is not null and t.is_public and not t.hidden
      and (case when p_id is null then t.prov = p_prov and t.place = p_place and not public.is_member(t.id) else t.id = p_id end)
  ) x
  order by case when sort = 'hot' then likes + 2 * copies end desc nulls last, done_on desc nulls last, created_at desc
  limit least(lim, 200)
$$;
revoke execute on function public.public_trips(text, text, text, int, text) from public, anon;
grant execute on function public.public_trips(text, text, text, int, text) to authenticated;

-- 신고: 공개 여부는 definer 함수로 (테이블 공개 읽기를 걷어냈으므로)
drop policy if exists report_create on public.reports;
create policy report_create on public.reports for insert to authenticated
  with check (user_id = (select auth.uid()) and (
    exists (select 1 from public.posts p where p.id = post_id and p.is_public and not p.hidden and p.user_id <> (select auth.uid()))
    or (trip_id is not null and public.is_public_trip(trip_id) and not public.is_member(trip_id))));

-- (3) 신고 관리: admins에 든 사람만. 넣는 건 SQL로만 (insert into public.admins select id from auth.users where email = '...')
create table if not exists public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.admins enable row level security; -- 정책 없음 = API로 못 읽고 못 씀
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()))
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.admin_reports()
returns table (kind text, id text, hidden boolean, n int, reasons text[], title text, body text, prov text, place text, photos text[], last timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select * from (
      select 'post'::text, p.id::text, p.hidden, count(*)::int, array_agg(r.reason), ''::text, p.body, p.prov, p.place, p.photos, max(r.created_at)
        from public.reports r join public.posts p on p.id = r.post_id group by p.id
      union all
      select 'trip', t.id, t.hidden, count(*)::int, array_agg(r.reason), t.title, ''::text, t.prov, t.place, '{}'::text[], max(r.created_at)
        from public.reports r join public.trips t on t.id = r.trip_id group by t.id
    ) x order by 11 desc limit 200;
end $$;
revoke execute on function public.admin_reports() from public, anon;
grant execute on function public.admin_reports() to authenticated;

-- restore = 숨김 풀고 신고 지움, delete = 지움 (기록 사진은 관리 화면이 Storage에서 먼저 지움)
create or replace function public.admin_resolve(kind text, tid text, action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if kind = 'post' and action = 'restore' then
    update public.posts set hidden = false where id = tid::uuid; delete from public.reports where post_id = tid::uuid;
  elsif kind = 'post' and action = 'delete' then delete from public.posts where id = tid::uuid;
  elsif kind = 'trip' and action = 'restore' then
    update public.trips set hidden = false where id = tid; delete from public.reports where trip_id = tid;
  elsif kind = 'trip' and action = 'delete' then update public.trips set is_public = false, hidden = false where id = tid; delete from public.reports where trip_id = tid; -- 남의 일정 자체는 안 지우고 공개만 내림
  else raise exception 'bad action'; end if;
end $$;
revoke execute on function public.admin_resolve(text, text, text) from public, anon;
grant execute on function public.admin_resolve(text, text, text) to authenticated;

-- 관리자는 숨겨진 기록·사진도 봄 (검토용), 지운 기록의 사진을 지움
drop policy if exists post_read on public.posts;
create policy post_read on public.posts for select to authenticated
  using ((is_public and not hidden) or user_id = (select auth.uid()) or public.is_member(trip_id) or public.is_admin());

-- (성능) 사진 읽기: 폴더 이름(post id)을 uuid로 바꿔 posts pk 인덱스를 탄다. uuid 모양이 아니면 null → 캐스트 에러 없음
drop policy if exists photo_read on storage.objects;
create policy photo_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and ((storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.posts p where p.id = case when (storage.foldername(objects.name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then ((storage.foldername(objects.name))[2])::uuid end)
    or public.is_admin()));
drop policy if exists photo_delete on storage.objects;
create policy photo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin()));
