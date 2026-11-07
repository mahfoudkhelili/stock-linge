-- Autoriser la suppression des documents PDF par leur propriétaire ou par un administrateur.
-- Les documents restent privés : aucun utilisateur ne peut supprimer les documents d'un autre utilisateur.
drop policy if exists "Users can delete own PDF documents or admin can delete all" on public.app_pdf_documents;

create policy "Users can delete own PDF documents or admin can delete all"
on public.app_pdf_documents
for delete
to authenticated
using (created_by = auth.uid() or public.is_admin());

grant delete on public.app_pdf_documents to authenticated;
