create schema if not exists app_private;

create table if not exists public.account_profiles (
  user_id uuid primary key,
  email text,
  display_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create table if not exists public.user_settings (
  user_id uuid primary key,
  chat_provider text not null default 'openai' check (chat_provider in ('openai', 'ollama')),
  pane_layout text not null default '50-50' check (pane_layout in ('70-30', '50-50', '30-70')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

comment on table public.account_profiles is 'Current and historical profile snapshots for Sidekick accounts.';
comment on table public.user_settings is 'Per-account Sidekick settings persisted behind RLS.';

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function app_private.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  incoming_display_name text;
begin
  incoming_display_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');

  insert into public.account_profiles (
    user_id,
    email,
    display_name
  )
  values (
    new.id,
    new.email,
    incoming_display_name
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, public.account_profiles.display_name),
    deleted_at = null,
    updated_at = timezone('utc', now());

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do update
  set
    deleted_at = null,
    updated_at = timezone('utc', now());

  return new;
end;
$$;

create or replace function app_private.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  incoming_display_name text;
begin
  incoming_display_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');

  update public.account_profiles
  set
    email = new.email,
    display_name = coalesce(incoming_display_name, display_name),
    updated_at = timezone('utc', now())
  where user_id = new.id;

  return new;
end;
$$;

create or replace function public.soft_delete_sidekick_account(
  target_user_id uuid,
  target_deleted_at timestamptz default timezone('utc', now())
)
returns void
language plpgsql
set search_path = public, storage, pg_temp
as $$
begin
  update public.account_profiles
  set
    deleted_at = coalesce(deleted_at, target_deleted_at),
    updated_at = timezone('utc', now())
  where user_id = target_user_id;

  update public.user_settings
  set
    deleted_at = coalesce(deleted_at, target_deleted_at),
    updated_at = timezone('utc', now())
  where user_id = target_user_id;

  update storage.objects
  set owner_id = null
  where bucket_id = 'user-private'
    and owner_id::text = target_user_id::text;
end;
$$;

drop trigger if exists set_account_profiles_updated_at on public.account_profiles;
create trigger set_account_profiles_updated_at
before update on public.account_profiles
for each row
execute function app_private.set_updated_at();

drop trigger if exists set_user_settings_updated_at on public.user_settings;
create trigger set_user_settings_updated_at
before update on public.user_settings
for each row
execute function app_private.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function app_private.handle_auth_user_created();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email, raw_user_meta_data on auth.users
for each row
execute function app_private.handle_auth_user_updated();

alter table public.account_profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.account_profiles force row level security;
alter table public.user_settings force row level security;

revoke all on function public.soft_delete_sidekick_account(uuid, timestamptz) from public;
revoke all on function public.soft_delete_sidekick_account(uuid, timestamptz) from anon;
revoke all on function public.soft_delete_sidekick_account(uuid, timestamptz) from authenticated;
grant execute on function public.soft_delete_sidekick_account(uuid, timestamptz) to service_role;

create policy "account_profiles_select_own_active"
on public.account_profiles
for select
to authenticated
using (
  auth.uid() = user_id
  and deleted_at is null
);

create policy "account_profiles_update_own_active"
on public.account_profiles
for update
to authenticated
using (
  auth.uid() = user_id
  and deleted_at is null
)
with check (
  auth.uid() = user_id
  and deleted_at is null
);

create policy "user_settings_select_own_active"
on public.user_settings
for select
to authenticated
using (
  auth.uid() = user_id
  and deleted_at is null
);

create policy "user_settings_update_own_active"
on public.user_settings
for update
to authenticated
using (
  auth.uid() = user_id
  and deleted_at is null
)
with check (
  auth.uid() = user_id
  and deleted_at is null
);

insert into storage.buckets (id, name, public)
values ('user-private', 'user-private', false)
on conflict (id) do update
set public = excluded.public;

create policy "user_private_objects_select_own_active"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'user-private'
  and owner_id::text = auth.uid()::text
  and exists (
    select 1
    from public.account_profiles
    where user_id = auth.uid()
      and deleted_at is null
  )
);

create policy "user_private_objects_insert_own_active"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'user-private'
  and owner_id::text = auth.uid()::text
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1
    from public.account_profiles
    where user_id = auth.uid()
      and deleted_at is null
  )
);

create policy "user_private_objects_update_own_active"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'user-private'
  and owner_id::text = auth.uid()::text
  and exists (
    select 1
    from public.account_profiles
    where user_id = auth.uid()
      and deleted_at is null
  )
)
with check (
  bucket_id = 'user-private'
  and owner_id::text = auth.uid()::text
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1
    from public.account_profiles
    where user_id = auth.uid()
      and deleted_at is null
  )
);

create policy "user_private_objects_delete_own_active"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'user-private'
  and owner_id::text = auth.uid()::text
  and exists (
    select 1
    from public.account_profiles
    where user_id = auth.uid()
      and deleted_at is null
  )
);
