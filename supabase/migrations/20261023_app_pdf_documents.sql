-- Linge Stock : historique privé des PDF (bons de vente et documents d'étiquettes)
create table if not exists public.app_pdf_documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in ('invoice', 'labels')),
  title text not null,
  customer_name text,
  document_date date not null default current_date,
  items jsonb not null default '[]'::jsonb,
  total numeric(14,2) not null default 0,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists app_pdf_documents_created_by_created_at_idx
  on public.app_pdf_documents (created_by, created_at desc);
create index if not exists app_pdf_documents_type_created_at_idx
  on public.app_pdf_documents (doc_type, created_at desc);

alter table public.app_pdf_documents enable row level security;

drop policy if exists "Users can view own PDF documents or admin can view all" on public.app_pdf_documents;
create policy "Users can view own PDF documents or admin can view all"
on public.app_pdf_documents for select
to authenticated
using (created_by = auth.uid() or public.is_admin());

drop policy if exists "Users can insert own PDF documents" on public.app_pdf_documents;
create policy "Users can insert own PDF documents"
on public.app_pdf_documents for insert
to authenticated
with check (created_by = auth.uid());

grant select, insert on public.app_pdf_documents to authenticated;
