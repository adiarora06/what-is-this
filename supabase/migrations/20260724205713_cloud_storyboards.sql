create table if not exists public.storyboards (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.saved_objects (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  storyboard_id text not null,
  object_name text not null,
  category text not null default 'Object',
  confidence double precision not null default 0 check (confidence between 0 and 1),
  source text,
  image_path text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint saved_objects_storyboard_owner_fkey
    foreign key (user_id, storyboard_id)
    references public.storyboards (user_id, id)
    on delete cascade
);

create table if not exists public.scan_feedback (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  predicted_name text not null,
  corrected_name text,
  category text not null default 'Object',
  confidence double precision not null default 0 check (confidence between 0 and 1),
  source text not null default 'unknown',
  was_correct boolean not null,
  image_path text,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists storyboards_user_created_idx on public.storyboards (user_id, created_at desc);
create index if not exists saved_objects_board_created_idx on public.saved_objects (user_id, storyboard_id, created_at desc);
create index if not exists scan_feedback_user_created_idx on public.scan_feedback (user_id, created_at desc);

alter table public.storyboards enable row level security;
alter table public.saved_objects enable row level security;
alter table public.scan_feedback enable row level security;

create policy "Users read their storyboards"
on public.storyboards for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users create their storyboards"
on public.storyboards for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users update their storyboards"
on public.storyboards for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users delete their storyboards"
on public.storyboards for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Users read their saved objects"
on public.saved_objects for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users create their saved objects"
on public.saved_objects for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users update their saved objects"
on public.saved_objects for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users delete their saved objects"
on public.saved_objects for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Users read their scan feedback"
on public.scan_feedback for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users create their scan feedback"
on public.scan_feedback for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users update their scan feedback"
on public.scan_feedback for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users delete their scan feedback"
on public.scan_feedback for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.storyboards to authenticated;
grant select, insert, update, delete on public.saved_objects to authenticated;
grant select, insert, update, delete on public.scan_feedback to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scan-images', 'scan-images', false, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users upload their scan images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'scan-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users read their scan images"
on storage.objects for select to authenticated
using (
  bucket_id = 'scan-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users update their scan images"
on storage.objects for update to authenticated
using (
  bucket_id = 'scan-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'scan-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users delete their scan images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'scan-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
