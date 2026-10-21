import { useState } from 'react';
import Papa from 'papaparse';
import { supabase } from './supabase';

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [hiddenProducts, setHiddenProducts] = useState([]);
  const [suggestedProducts, setSuggestedProducts] = useState([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState([]);
  const [stockHistory, setStockHistory] = useState([]);
  const [replenishmentRequests, setReplenishmentRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [csvPreview, setCsvPreview] = useState([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortKey, setSortKey] = useState('product_ref');
  const [sortDirection, setSortDirection] = useState('asc');
  const [showCodeColumn, setShowCodeColumn] = useState(true);
  const [activePage, setActivePage] = useState('dashboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [productPhotos, setProductPhotos] = useState([]);
  const [photoProductId, setPhotoProductId] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [showTraderQuantities, setShowTraderQuantities] = useState(true);
  const [lastImportBatch, setLastImportBatch] = useState(null);
  const [productNotes, setProductNotes] = useState([]);
  const [noteProductId, setNoteProductId] = useState('');
  const [noteText, setNoteText] = useState('');
  const [notesLoading, setNotesLoading] = useState(false);
  const [language, setLanguage] = useState('fr');
  const [arinaQuantities, setArinaQuantities] = useState({});
  const [theme, setTheme] = useState('light');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionTitle, setSuggestionTitle] = useState('');
  const [suggestionBody, setSuggestionBody] = useState('');
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [accountPermissions, setAccountPermissions] = useState([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionsMessage, setPermissionsMessage] = useState('');
  const [permissionSavingId, setPermissionSavingId] = useState('');

  async function loadProducts() {
    let allProducts = [];
    const pageSize = 500;
    let start = 0;

    while (true) {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, product_ref, name, current_quantity, wholesale_price, retail_price, min_stock_level, is_hidden'
        )
        .eq('is_active', true)
        .eq('is_hidden', false)
        .order('name')
        .range(start, start + pageSize - 1);

      if (error) {
        setMessage('Erreur produits : ' + error.message);
        return;
      }

      allProducts = allProducts.concat(data || []);

      if (!data || data.length < pageSize) {
        break;
      }

      start += pageSize;
    }

    setProducts(allProducts);
    setCurrentPage(1);
    setMessage('');
  }
  async function hideProduct(product) {
    const confirmed = window.confirm(
      `Voulez-vous masquer le produit "${product.name}" ?`
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from('products')
      .update({ is_hidden: true })
      .eq('id', product.id);

    if (error) {
      window.alert('Erreur : ' + error.message);
      return;
    }

    setProducts((current) => current.filter((item) => item.id !== product.id));

    window.alert('Produit masqué avec succès.');
  }

  async function hideSelectedSuggestions() {
    if (selectedSuggestions.length === 0) {
      window.alert('Veuillez sélectionner au moins un produit.');
      return;
    }

    const confirmed = window.confirm(
      `Voulez-vous masquer les ${selectedSuggestions.length} produit(s) sélectionné(s) ?`
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from('products')
      .update({ is_hidden: true })
      .in('id', selectedSuggestions);

    if (error) {
      window.alert('Erreur : ' + error.message);
      return;
    }

    setProducts((current) =>
      current.filter((p) => !selectedSuggestions.includes(p.id))
    );

    setSuggestedProducts((current) =>
      current.filter((p) => !selectedSuggestions.includes(p.id))
    );

    setSelectedSuggestions([]);

    await loadHiddenProducts();

    window.alert('Produits sélectionnés masqués avec succès.');
  }

  async function loadHiddenProducts() {
    const { data, error } = await supabase
      .from('products')
      .select(
        'id, product_ref, name, current_quantity, wholesale_price, retail_price, is_hidden'
      )
      .eq('is_active', true)
      .eq('is_hidden', true)
      .order('name');

    if (error) {
      window.alert('Erreur produits masqués : ' + error.message);
      return;
    }

    setHiddenProducts(data || []);
  }

  async function loadSuggestedProducts() {
    const { data, error } = await supabase.rpc('get_reorder_suggestions');

    if (error) {
      console.error('[Reorder suggestions]', error);
      window.alert('Erreur suggestions : ' + error.message);
      return;
    }

    console.log(
      '[Suggestions reçues]',
      (data || []).map((p) => ({
        ref: p.product_ref,
        nom: p.name,
        quantite: p.current_quantity,
        jours: p.days_remaining,
      }))
    );

    setSuggestedProducts(data || []);
    setSelectedSuggestions([]);
    setSelectedSuggestions([]);
  }
  async function unhideProduct(product) {
    const { error } = await supabase
      .from('products')
      .update({ is_hidden: false })
      .eq('id', product.id);

    if (error) {
      window.alert('Erreur : ' + error.message);
      return;
    }

    setHiddenProducts((current) =>
      current.filter((item) => item.id !== product.id)
    );

    await loadProducts();

    window.alert('Produit réaffiché avec succès.');
  }

  async function loadStockHistory() {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      setMessage('Erreur historique : session utilisateur introuvable.');
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', userData.user.id)
      .single();

    if (
      profileError ||
      !profile ||
      profile.role !== 'admin' ||
      !profile.is_active
    ) {
      setMessage('Erreur historique : accès réservé à l’administrateur actif.');
      return;
    }

    const { data, error } = await supabase
      .from('audit_log')
      .select(
        'id, action, entity_type, entity_id, details, created_at, actor_id'
      )
      .eq('action', 'stock_adjustment')
      .order('created_at', { ascending: false });

    if (error) {
      setMessage('Erreur historique : ' + error.message);
      return;
    }

    setStockHistory(data || []);
  }

  async function loadReplenishmentRequests() {
    setRequestsLoading(true);

    try {
      const { data, error } = await supabase
        .from('replenishment_requests')
        .select(
          `
          id,
          trader_id,
          product_id,
          requested_quantity,
          request_type,
          status,
          created_at,
          is_urgent,
          archived_at,
          products (
            name,
            product_ref
          )
        `
        )
        .order('created_at', { ascending: false });

      if (error) throw error;

      let requests = data || [];

      if (user?.profile?.role === 'admin' || user === null) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name');

        if (profilesError) throw profilesError;

        const names = Object.fromEntries(
          (profiles || []).map((profile) => [
            profile.id,
            profile.full_name || 'Sans nom',
          ])
        );

        requests = requests.map((request) => ({
          ...request,
          trader_name: names[request.trader_id] || 'Trader',
        }));
      }

      setReplenishmentRequests(requests);
    } catch (error) {
      setMessage('Erreur demandes : ' + error.message);
    } finally {
      setRequestsLoading(false);
    }
  }

  async function requestReplenishment(product, requestType) {
    let quantity = null;

    if (requestType === 'quantity') {
      const answer = window.prompt(
        `Quelle quantité souhaitez-vous pour ${product.name} ?`
      );

      if (answer === null) return;

      quantity = Number(answer.replace(',', '.'));

      if (!Number.isFinite(quantity) || quantity <= 0) {
        window.alert('Veuillez saisir une quantité supérieure à zéro.');
        return;
      }
    }

    try {
      setMessage('Envoi de la demande en cours...');

      const { error } = await supabase.from('replenishment_requests').insert({
        trader_id: user.id,
        product_id: product.id,
        requested_quantity: quantity,
        request_type: requestType,
        is_urgent: false,
      });

      if (error) throw error;

      window.alert('Demande envoyée avec succès.');
      setMessage('Demande envoyée avec succès.');

      await loadReplenishmentRequests();
    } catch (error) {
      window.alert('Erreur demande : ' + error.message);
      setMessage('Erreur demande : ' + error.message);
    }
  }

  async function requestUrgentArina(product) {
    const quantity = Number(arinaQuantities[product.id] || 0);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      window.alert('Choisissez une quantité entière supérieure à zéro.');
      return;
    }
    try {
      setMessage('Envoi de la demande urgente en cours…');
      const { error } = await supabase.from('replenishment_requests').insert({
        trader_id: user.id,
        product_id: product.id,
        requested_quantity: quantity,
        request_type: 'quantity',
        is_urgent: true,
      });
      if (error) throw error;
      setMessage('Demande urgente de matelas envoyée avec succès.');
      setArinaQuantities((current) => ({ ...current, [product.id]: '' }));
      await loadReplenishmentRequests();
    } catch (error) {
      setMessage('Erreur demande urgente : ' + error.message);
    }
  }

  async function archiveRequest(requestId) {
    const confirmed = window.confirm(
      'Archiver cette demande ? Elle restera consultable dans les archives.'
    );
    if (!confirmed) return;
    const { error } = await supabase
      .from('replenishment_requests')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', requestId);
    if (error) {
      setMessage('Erreur archivage : ' + error.message);
      return;
    }
    setMessage('Demande archivée.');
    await loadReplenishmentRequests();
  }

  async function unarchiveRequest(requestId) {
    const { error } = await supabase
      .from('replenishment_requests')
      .update({ archived_at: null })
      .eq('id', requestId);
    if (error) {
      setMessage('Erreur restauration : ' + error.message);
      return;
    }
    setMessage('Demande restaurée dans la liste active.');
    await loadReplenishmentRequests();
  }

  async function saveLanguageSetting(nextLanguage) {
    const previousLanguage = language;
    setLanguage(nextLanguage);
    const { data: authData } = await supabase.auth.getUser();
    const currentUser = authData?.user;
    if (!currentUser) {
      setLanguage(previousLanguage);
      setMessage('Session utilisateur introuvable.');
      return;
    }
    const { error } = await supabase.rpc('set_my_preferred_language', {
      p_language: nextLanguage,
    });
    if (error) {
      setLanguage(previousLanguage);
      setMessage('Erreur sauvegarde de la langue : ' + error.message);
      return;
    }
    setUser((current) =>
      current
        ? {
            ...current,
            profile: { ...current.profile, preferred_language: nextLanguage },
          }
        : current
    );
    setMessage(
      nextLanguage === 'ar'
        ? 'تم حفظ اللغة المفضلة. بعض الأقسام ما زالت بالفرنسية.'
        : 'Langue préférée enregistrée.'
    );
  }

  async function copyNewRequests() {
    const newRequests = replenishmentRequests.filter(
      (request) => request.status === 'new' && !request.archived_at
    );

    if (newRequests.length === 0) {
      window.alert('Aucune nouvelle demande à copier.');
      return;
    }

    const grouped = new Map();

    newRequests.forEach((request) => {
      const key =
        request.product_id || request.products?.id || request.products?.name;

      if (!grouped.has(key)) {
        grouped.set(key, {
          name: request.products?.name || 'Produit inconnu',
          total: 0,
          hasQuantity: false,
          needsConfirmation: false,
        });
      }

      const item = grouped.get(key);

      if (
        request.request_type === 'need_item' ||
        request.requested_quantity == null
      ) {
        item.needsConfirmation = true;
      } else {
        item.total += Number(request.requested_quantity);
        item.hasQuantity = true;
      }
    });

    const items = Array.from(grouped.values()).map((item, index) => {
      let quantity = item.hasQuantity ? `${item.total}` : '';

      if (item.needsConfirmation) {
        quantity = quantity
          ? `${quantity} + quantité supplémentaire à confirmer`
          : 'Quantité à confirmer';
      }

      return `${index + 1}. ${item.name} — Quantité : ${quantity}`;
    });

    const message = [
      'Bonjour,',
      '',
      'Veuillez préparer les articles suivants :',
      '',
      ...items,
      '',
      'Merci de confirmer la disponibilité et le délai de livraison.',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(message);
      window.alert(`${grouped.size} article(s) unique(s) copié(s).`);
    } catch (error) {
      window.prompt('Copiez le texte ci-dessous :', message);
    }
  }

  async function updateRequestStatus(requestId, status) {
    const { error } = await supabase
      .from('replenishment_requests')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId);

    if (error) {
      setMessage('Erreur statut demande : ' + error.message);
      return;
    }

    setMessage('Statut de la demande mis à jour.');
    await loadReplenishmentRequests();
  }

  function handleCsvFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setCsvFileName(file.name);
    setCsvPreview([]);

    Papa.parse(file, {
      delimiter: ';',
      header: true,

      skipEmptyLines: true,
      transformHeader: (header) => header.trim().replace(/�/g, 'é'),
      complete: (results) => {
        if (results.errors.length > 0) {
          setMessage('Erreur CSV : ' + results.errors[0].message);
          return;
        }

        if (!results.data || results.data.length === 0) {
          setMessage('Le fichier CSV est vide.');
          return;
        }

        setMessage(
          'Colonnes CSV : ' + Object.keys(results.data[0]).join(' | ')
        );
        setCsvPreview(results.data);
        const negativeStock = results.data.filter((row) => {
          const quantity = Number(
            String(row['Quantité'] ?? '')
              .trim()
              .replace(',', '.')
          );

          return String(row['Quantité'] ?? '').trim() !== '' && quantity < 0;
        });

        if (negativeStock.length > 0) {
          setMessage(
            `Attention : ${negativeStock.length} produits ont une quantité négative. Ils seront importés avec leur quantité réelle.`
          );
        } else {
          setMessage(
            `Fichier lu : ${results.data.length} lignes. Aucune quantité négative détectée.`
          );
        }
      },
      error: (error) => {
        setMessage('Erreur lecture CSV : ' + error.message);
      },
    });
  }

  async function importCsvToSupabase() {
    if (!csvPreview.length) {
      window.alert('Veuillez sélectionner un fichier CSV.');
      return;
    }

    const today = new Date();
    const defaultDate = `${today.getFullYear()}-${String(
      today.getMonth() + 1
    ).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const snapshotDate = window.prompt(
      'Date historique du stock (AAAA-MM-JJ) :',
      defaultDate
    );

    if (snapshotDate === null) return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate.trim())) {
      window.alert('Date invalide. Utilisez le format AAAA-MM-JJ.');
      return;
    }

    const confirmed = window.confirm(
      `Enregistrer ${csvPreview.length} lignes comme historique uniquement ?\n\nLe stock actuel ne sera pas modifié.\nFichier : ${csvFileName}\nDate : ${snapshotDate}`
    );

    if (!confirmed) return;

    const rows = csvPreview.map((row) => ({
      product_ref: String(row['Code'] ?? '').trim(),
      name: String(row['Désignation'] ?? '').trim(),
      quantity: String(row['Quantité'] ?? '').trim(),
      wholesale_price: String(row['Gros'] ?? '')
        .trim()
        .replace(',', '.'),
      retail_price: String(row['Détail'] ?? '')
        .trim()
        .replace(',', '.'),
    }));
    const invalidRows = rows
      .map((row, index) => ({
        ligne: index + 2,
        reference: row.product_ref,
        designation: row.name,
        quantite: row.quantity,
      }))
      .filter(
        (row) =>
          !row.reference ||
          !row.designation ||
          row.quantite === '' ||
          !/^-?\d+(?:[.,]\d+)?$/.test(String(row.quantite ?? '').trim())
      );

    if (invalidRows.length > 0) {
      const details = invalidRows
        .slice(0, 5)
        .map(
          (row) =>
            `Ligne ${row.ligne}: Code="${row.reference}", Désignation="${row.designation}", Quantité="${row.quantite}"`
        )
        .join('\n');

      window.alert(
        `Lignes CSV invalides : ${invalidRows.length}\n\n${details}`
      );
      return;
    }
    setMessage('Enregistrement de l’historique en cours...');

    try {
      const { data, error } = await supabase.rpc(
        'admin_import_historical_stock',
        {
          p_file_name: csvFileName,
          p_snapshot_date: snapshotDate.trim(),
          p_rows: rows,
        }
      );

      if (error) {
        setMessage('Erreur historique : ' + error.message);
        return;
      }

      await loadLastImport();
      setMessage(
        `Historique enregistré. Lignes : ${
          data?.rows_saved ?? 0
        }. Produits inactifs créés : ${
          data?.inactive_products_created ?? 0
        }. Le stock actuel n’a pas été modifié.`
      );
    } catch (error) {
      setMessage('Erreur historique : ' + error.message);
    }
  }
  async function login(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select(
          'full_name, role, is_active, preferred_language, can_view_negative_stock, can_view_zero_negative_products, can_view_requests, can_view_other_notes, preferred_theme'
        )
        .eq('id', data.user.id)
        .single();

      if (profileError || !profile || !profile.is_active) {
        console.error('Profile diagnostic:', {
          code: profileError?.code,
          message: profileError?.message,
          details: profileError?.details,
          hint: profileError?.hint,
          profile,
        });

        setMessage(
          profileError
            ? `Erreur profil: ${profileError.message}`
            : !profile
            ? 'Profil introuvable.'
            : 'Compte inactif.'
        );

        await supabase.auth.signOut();
        return;
      }

      setUser({ ...data.user, profile });
      setLanguage(profile.preferred_language === 'ar' ? 'ar' : 'fr');
      setTheme(
        ['dark', 'system'].includes(profile.preferred_theme)
          ? profile.preferred_theme
          : 'light'
      );
      setActivePage(profile.role === 'admin' ? 'dashboard' : 'products');
      await loadProducts();
      await loadProductPhotos();
      await loadQuantitySetting();
      await loadProductNotes();
      if (profile.role === 'admin') {
        await loadSuggestions();
        await loadAccountPermissions();
      }

      if (profile.role === 'admin') {
        await loadStockHistory();
        await loadLastImport();
      }

      if (profile.role === 'admin') await loadReplenishmentRequests();
    } catch (error) {
      setMessage('Erreur connexion : ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
    setProducts([]);
    setEmail('');
    setPassword('');
    setMessage('');
  }

  async function adjustStock(product) {
    const quantityInput = window.prompt(
      `الكمية الجديدة للمنتج ${product.name}:`,
      String(product.current_quantity)
    );

    if (quantityInput === null) return;

    const newQuantity = Number(quantityInput);

    if (
      quantityInput.trim() === '' ||
      !Number.isInteger(newQuantity) ||
      newQuantity < 0
    ) {
      window.alert('أدخل كمية صحيحة أكبر من أو تساوي صفر.');
      return;
    }

    const reason = window.prompt('سبب تعديل الكمية:');

    if (!reason || !reason.trim()) {
      window.alert('سبب التعديل إجباري.');
      return;
    }

    const { error } = await supabase.rpc('admin_adjust_stock', {
      p_product_ref: product.product_ref,
      p_new_quantity: newQuantity,
      p_reason: reason.trim(),
    });

    if (error) {
      setMessage('Erreur modification stock : ' + error.message);
      return;
    }

    setMessage('Quantité modifiée avec succès.');
    await loadProducts();
  }

  async function loadProductNotes() {
    setNotesLoading(true);
    try {
      const { data, error } = await supabase
        .from('product_notes')
        .select(
          'id, author_id, product_id, note, status, created_at, products(name, product_ref)'
        )
        .order('created_at', { ascending: false });
      if (error) throw error;
      let notes = data || [];
      if (user?.profile?.role === 'admin') {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name');
        if (profilesError) throw profilesError;
        const names = Object.fromEntries(
          (profiles || []).map((profile) => [
            profile.id,
            profile.full_name || 'Sans nom',
          ])
        );
        notes = notes.map((note) => ({
          ...note,
          author_name: names[note.author_id] || 'Utilisateur',
        }));
      }
      setProductNotes(notes);
    } catch (error) {
      setMessage('Erreur notes clients : ' + error.message);
    } finally {
      setNotesLoading(false);
    }
  }

  async function submitProductNote(event) {
    event.preventDefault();
    if (!noteProductId || !noteText.trim()) {
      setMessage('Choisissez un produit et saisissez une note.');
      return;
    }
    const { error } = await supabase.from('product_notes').insert({
      author_id: user.id,
      product_id: noteProductId,
      note: noteText.trim(),
      status: 'new',
    });
    if (error) {
      setMessage('Erreur envoi de la note : ' + error.message);
      return;
    }
    setNoteText('');
    setMessage('Note envoyée à l’administrateur.');
    await loadProductNotes();
  }

  async function updateProductNoteStatus(noteId, status) {
    const { error } = await supabase
      .from('product_notes')
      .update({ status })
      .eq('id', noteId);
    if (error) {
      setMessage('Erreur statut note : ' + error.message);
      return;
    }
    setMessage('Statut de la note mis à jour.');
    await loadProductNotes();
  }

  async function loadLastImport() {
    const { data, error } = await supabase
      .from('import_batches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error) setLastImportBatch(data || null);
  }

  async function loadQuantitySetting() {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'show_trader_quantities')
      .maybeSingle();
    if (error) {
      setMessage('Erreur paramètres : ' + error.message);
      return;
    }
    if (data?.value !== undefined && data?.value !== null)
      setShowTraderQuantities(Boolean(data.value));
  }

  async function saveQuantitySetting(value) {
    setShowTraderQuantities(value);
    const { error } = await supabase.from('app_settings').upsert(
      {
        key: 'show_trader_quantities',
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
    if (error) {
      setShowTraderQuantities(!value);
      setMessage('Erreur sauvegarde du paramètre : ' + error.message);
      return;
    }
    setMessage(
      value
        ? 'Les quantités exactes sont visibles pour les traders.'
        : 'Les quantités exactes sont masquées pour les traders.'
    );
  }

  async function loadAccountPermissions() {
    setPermissionsLoading(true);
    setPermissionsMessage('Chargement des comptes...');

    try {
      const { data: authData, error: authError } =
        await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error('Aucune session utilisateur active.');

      const { data, error } = await supabase
        .from('profiles')
        .select(
          'id, full_name, role, is_active, can_view_negative_stock, can_view_zero_negative_products'
        )
        .order('full_name', { ascending: true });

      if (error) throw error;

      const accounts = Array.isArray(data) ? data : [];
      setAccountPermissions(accounts);
      const traders = accounts.filter((account) => account.role !== 'admin');
      console.info('[Linge Stock] Permissions comptes chargées', {
        userId: authData.user.id,
        total: accounts.length,
        nonAdmin: traders.length,
        roles: accounts.map((account) => account.role),
      });

      setPermissionsMessage(
        `Résultat Supabase : ${accounts.length} profil(s), ${traders.length} compte(s) non administrateur.`
      );
      if (traders.length === 0) {
        setPermissionsMessage(
          `Supabase a renvoyé ${accounts.length} profil(s), mais aucun rôle différent de « admin ». Vérifiez le rôle exact du compte trader.`
        );
      }
    } catch (error) {
      console.error('[Linge Stock] Erreur chargement permissions', error);
      setAccountPermissions([]);
      setPermissionsMessage(
        `Erreur chargement des permissions : ${error?.message || String(error)}`
      );
    } finally {
      setPermissionsLoading(false);
    }
  }

  async function updateAccountPermission(profileId, field, value) {
    const allowedFields = [
      'can_view_negative_stock',
      'can_view_zero_negative_products',
    ];
    if (!allowedFields.includes(field)) return;
    setPermissionSavingId(profileId + ':' + field);
    const previous = accountPermissions.find((item) => item.id === profileId)?.[
      field
    ];
    setAccountPermissions((current) =>
      current.map((item) =>
        item.id === profileId ? { ...item, [field]: value } : item
      )
    );
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ [field]: value })
        .eq('id', profileId);
      if (error) throw error;

      const { data: saved, error: verifyError } = await supabase
        .from('profiles')
        .select('id, can_view_negative_stock, can_view_zero_negative_products')
        .eq('id', profileId)
        .single();

      if (verifyError) throw verifyError;

      setAccountPermissions((current) =>
        current.map((item) =>
          item.id === profileId ? { ...item, ...saved } : item
        )
      );

      setPermissionsMessage(
        `Enregistré. Stocks négatifs : ${
          saved.can_view_negative_stock ? 'Oui' : 'Non'
        } | Europ Arina : ${
          saved.can_view_zero_negative_products ? 'Oui' : 'Non'
        }`
      );
    } catch (error) {
      setPermissionsMessage('Erreur sauvegarde : ' + error.message);
      setAccountPermissions((current) =>
        current.map((item) =>
          item.id === profileId ? { ...item, [field]: previous } : item
        )
      );
      setMessage('Erreur sauvegarde permission : ' + error.message);
    } finally {
      setPermissionSavingId('');
    }
  }

  async function loadSuggestions() {
    setSuggestionsLoading(true);
    const { data, error } = await supabase
      .from('user_suggestions')
      .select('id, author_id, title, body, created_at')
      .order('created_at', { ascending: false });
    if (error) setMessage('Erreur suggestions : ' + error.message);
    else {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name');
      const names = Object.fromEntries(
        (profiles || []).map((p) => [p.id, p.full_name || 'Utilisateur'])
      );
      setSuggestions(
        (data || []).map((item) => ({
          ...item,
          author_name: names[item.author_id] || 'Utilisateur',
        }))
      );
    }
    setSuggestionsLoading(false);
  }

  async function submitSuggestion(event) {
    event.preventDefault();
    if (!suggestionTitle.trim() || !suggestionBody.trim()) {
      setMessage('Saisissez un titre et le contenu de votre suggestion.');
      return;
    }
    const { error } = await supabase.from('user_suggestions').insert({
      author_id: user.id,
      title: suggestionTitle.trim(),
      body: suggestionBody.trim(),
    });
    if (error) {
      setMessage('Erreur suggestion : ' + error.message);
      return;
    }
    setSuggestionTitle('');
    setSuggestionBody('');
    setMessage('Suggestion envoyée à l’administrateur. Elle reste privée.');
  }

  async function deleteSuggestion(id) {
    if (!window.confirm('Supprimer définitivement cette suggestion ?')) return;
    const { error } = await supabase
      .from('user_suggestions')
      .delete()
      .eq('id', id);
    if (error) {
      setMessage('Erreur suppression : ' + error.message);
      return;
    }
    setSuggestions((current) => current.filter((item) => item.id !== id));
    setMessage('Suggestion supprimée.');
  }

  async function saveThemeSetting(nextTheme) {
    const previous = theme;
    setTheme(nextTheme);
    const { error } = await supabase.rpc('set_my_preferred_theme', {
      p_theme: nextTheme,
    });
    if (error) {
      setTheme(previous);
      setMessage('Erreur sauvegarde du thème : ' + error.message);
      return;
    }
    setUser((current) =>
      current
        ? {
            ...current,
            profile: { ...current.profile, preferred_theme: nextTheme },
          }
        : current
    );
    setMessage('Thème enregistré dans votre compte.');
  }

  async function loadProductPhotos() {
    const { data, error } = await supabase
      .from('product_photos')
      .select(
        'id, product_id, storage_path, photo_url, created_at, updated_at'
      );
    if (error) {
      setMessage(
        'Erreur photos : ' +
          error.message +
          '. Vérifiez la configuration des photos.'
      );
      return;
    }
    setProductPhotos(data || []);
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Impossible de lire la photo.'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('Format image non reconnu.'));
        image.onload = async () => {
          try {
            let width = image.width;
            let height = image.height;
            const maxDimension = 1600;
            if (width > maxDimension || height > maxDimension) {
              const ratio = Math.min(
                maxDimension / width,
                maxDimension / height
              );
              width = Math.round(width * ratio);
              height = Math.round(height * ratio);
            }
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx)
              throw new Error(
                'Compression image non disponible dans ce navigateur.'
              );
            let quality = 0.84;
            let blob = null;
            for (let attempt = 0; attempt < 9; attempt += 1) {
              canvas.width = width;
              canvas.height = height;
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, width, height);
              ctx.drawImage(image, 0, 0, width, height);
              blob = await new Promise((res) =>
                canvas.toBlob(res, 'image/jpeg', quality)
              );
              if (blob && blob.size <= 1024 * 1024) break;
              if (quality > 0.55) quality -= 0.08;
              else {
                width = Math.max(500, Math.round(width * 0.85));
                height = Math.max(500, Math.round(height * 0.85));
                quality = 0.78;
              }
            }
            if (!blob) throw new Error('Échec de compression de la photo.');
            if (blob.size > 1024 * 1024)
              throw new Error(
                'La photo reste supérieure à 1 Mo après compression. Essayez une autre photo.'
              );
            resolve(blob);
          } catch (error) {
            reject(error);
          }
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function saveProductPhoto() {
    if (!photoProductId || !photoFile) {
      window.alert('Choisissez un produit et une photo.');
      return;
    }
    if (user?.profile?.role !== 'admin') {
      window.alert('Seul l’administrateur peut ajouter une photo.');
      return;
    }
    setPhotoUploading(true);
    setMessage('Compression et enregistrement de la photo…');
    try {
      const blob = await compressImage(photoFile);
      const product =
        products.find((item) => item.id === photoProductId) ||
        hiddenProducts.find((item) => item.id === photoProductId);
      const safeRef = String(product?.product_ref || photoProductId).replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );
      const path = `${safeRef}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('product-photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage
        .from('product-photos')
        .getPublicUrl(path);
      const photoUrl = `${urlData.publicUrl}${
        urlData.publicUrl.includes('?') ? '&' : '?'
      }v=${Date.now()}`;
      const { error: saveError } = await supabase.from('product_photos').upsert(
        {
          product_id: photoProductId,
          storage_path: path,
          photo_url: photoUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'product_id' }
      );
      if (saveError) throw saveError;
      setMessage(`Photo enregistrée (${(blob.size / 1024).toFixed(0)} Ko).`);
      setPhotoFile(null);
      const input = document.getElementById('product-photo-input');
      if (input) input.value = '';
      await loadProductPhotos();
    } catch (error) {
      setMessage('Erreur photo : ' + (error?.message || String(error)));
    } finally {
      setPhotoUploading(false);
    }
  }

  function photoFor(productId) {
    return (
      productPhotos.find((photo) => photo.product_id === productId)
        ?.photo_url || ''
    );
  }

  function navigateTo(page) {
    setActivePage(page);
    setCurrentPage(1);
    setSearchTerm('');
    if (page === 'hidden') loadHiddenProducts();
    if (page === 'analysis') loadSuggestedProducts();
    if (page === 'history' && user?.profile?.role === 'admin')
      loadStockHistory();
    if (page === 'requests') loadReplenishmentRequests();
    if (page === 'notes') loadProductNotes();
    if (page === 'settings' && user?.profile?.role === 'admin') {
      loadSuggestions();
      loadAccountPermissions();
    }
    if (page === 'photos') loadProductPhotos();
  }

  const navItems = [
    {
      id: 'dashboard',
      label: language === 'ar' ? 'لوحة التحكم' : 'Tableau de bord',
      icon: '⌂',
      adminOnly: true,
    },
    {
      id: 'products',
      label: language === 'ar' ? 'جميع المنتجات' : 'Tous les produits',
      icon: '▦',
    },
    {
      id: 'arina',
      label: language === 'ar' ? 'مراتب Europ Arina' : 'Matelas Europ Arina',
      icon: '▣',
    },
    { id: 'textiles', label: 'CHORA / VOILAGE / RIDEAU', icon: '▤' },
    {
      id: 'photos',
      label: language === 'ar' ? 'صور المنتجات' : 'Photos des produits',
      icon: '▧',
    },
    {
      id: 'requests',
      label: language === 'ar' ? 'طلبات الزبائن' : 'Demandes clients',
      icon: '☷',
      adminOnly: true,
    },
    {
      id: 'notes',
      label: language === 'ar' ? 'ملاحظات الزبائن' : 'Notes clients',
      icon: '✎',
      adminOnly: false,
    },
    {
      id: 'history',
      label: language === 'ar' ? 'سجل المخزون' : 'Historique du stock',
      icon: '◷',
      admin: true,
    },
    {
      id: 'analysis',
      label: language === 'ar' ? 'تحليل المنتجات' : 'Analyse des produits',
      icon: '⌁',
      admin: true,
    },
    {
      id: 'hidden',
      label: language === 'ar' ? 'المنتجات المخفية' : 'Produits masqués',
      icon: '◉',
      admin: true,
    },
    {
      id: 'settings',
      label: language === 'ar' ? 'الإعدادات' : 'Paramètres',
      icon: '⚙',
    },
  ];

  const isAdmin = user?.profile?.role === 'admin';
  const normalizeName = (value) =>
    String(value || '')
      .toLocaleUpperCase('fr')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]/g, '');
  const pageProducts = products.filter((product) => {
    const designation = String(product.name || '').toLocaleLowerCase('fr');
    const searchMatch = designation.includes(
      searchTerm.trim().toLocaleLowerCase('fr')
    );
    const normalizedName = normalizeName(product.name);
    const pageMatch =
      activePage === 'arina'
        ? normalizedName.includes('ARINA') ||
          (normalizedName.includes('EUROP') &&
            normalizedName.includes('MATELAS'))
        : activePage === 'textiles'
        ? ['CHORA', 'VOILAGE', 'RIDEAU'].some((keyword) =>
            normalizedName.includes(normalizeName(keyword))
          )
        : true;
    const canSeeZeroNegativeOnArina =
      activePage === 'arina' &&
      (isAdmin || Boolean(user?.profile?.can_view_zero_negative_products));
    const stockAllowed =
      isAdmin ||
      Number(product.current_quantity) > 0 ||
      canSeeZeroNegativeOnArina;
    return searchMatch && pageMatch && stockAllowed;
  });

  const sortedProducts = [...pageProducts].sort((a, b) => {
    const aValue = a[sortKey];
    const bValue = b[sortKey];
    let comparison = 0;

    if (
      ['current_quantity', 'wholesale_price', 'retail_price'].includes(sortKey)
    ) {
      const aNumber = aValue == null ? 0 : Number(aValue);
      const bNumber = bValue == null ? 0 : Number(bValue);
      comparison = aNumber - bNumber;
    } else {
      comparison = String(aValue ?? '').localeCompare(
        String(bValue ?? ''),
        'fr',
        { numeric: true, sensitivity: 'base' }
      );
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  });
  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedProducts = sortedProducts.slice(
    (safeCurrentPage - 1) * pageSize,
    safeCurrentPage * pageSize
  );

  function changeSort(key) {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  }

  function sortLabel(key, label) {
    return `${label}${
      sortKey === key ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''
    }`;
  }

  function getLastStockAdjustment(productRef) {
    return stockHistory.find(
      (item) => (item.details?.product_ref || item.entity_id) === productRef
    );
  }

  const negativeProducts = products
    .filter((product) => Number(product.current_quantity) < 0)
    .sort((a, b) => {
      const aChange = getLastStockAdjustment(a.product_ref)?.created_at;
      const bChange = getLastStockAdjustment(b.product_ref)?.created_at;
      if (aChange && bChange) return new Date(bChange) - new Date(aChange);
      if (aChange) return -1;
      if (bChange) return 1;
      return String(a.product_ref ?? '').localeCompare(
        String(b.product_ref ?? ''),
        'fr',
        { numeric: true }
      );
    });

  const activeRequests = replenishmentRequests.filter(
    (request) => !request.archived_at
  );
  const archivedRequests = replenishmentRequests.filter((request) =>
    Boolean(request.archived_at)
  );
  const newRequestsCount = activeRequests.filter(
    (request) => request.status === 'new'
  ).length;

  const visibleNavItems = navItems.filter(
    (item) => (!item.admin || isAdmin) && (!item.adminOnly || isAdmin)
  );
  const activePageTitle =
    navItems.find((item) => item.id === activePage)?.label || 'Linge Stock';
  const lastStockUpdate = stockHistory[0]?.created_at;
  const newRequests = activeRequests.filter(
    (request) => request.status === 'new'
  );
  const urgentNewRequests = newRequests.filter((request) => request.is_urgent);
  const styles = {
    button: {
      border: 0,
      borderRadius: 9,
      padding: '10px 14px',
      cursor: 'pointer',
      fontWeight: 700,
      background: '#102b46',
      color: '#fff',
    },
    secondary: {
      border: '1px solid #d5dfeb',
      borderRadius: 9,
      padding: '9px 12px',
      cursor: 'pointer',
      fontWeight: 600,
      background: '#fff',
      color: '#102b46',
    },
    card: {
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 14,
      padding: 18,
      boxShadow: '0 3px 12px rgba(16,43,70,.04)',
      minWidth: 0,
    },
    field: {
      boxSizing: 'border-box',
      width: '100%',
      border: '1px solid #d5dfeb',
      borderRadius: 9,
      padding: '11px 12px',
      font: 'inherit',
      background: '#fff',
      color: '#102b46',
    },
    th: {
      textAlign: 'left',
      padding: '12px 10px',
      background: '#f1f5f9',
      color: '#526477',
      fontSize: 12,
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    },
    td: {
      padding: '12px 10px',
      borderTop: '1px solid #edf1f5',
      verticalAlign: 'middle',
    },
  };

  function productActions(product) {
    return (
      <div className="ls-actions">
        {isAdmin ? (
          <>
            <button
              style={styles.secondary}
              onClick={() => adjustStock(product)}
            >
              {language === 'ar' ? 'تعديل المخزون' : 'Modifier stock'}
            </button>
            <button
              style={styles.secondary}
              onClick={() => hideProduct(product)}
            >
              {language === 'ar' ? 'إخفاء' : 'Masquer'}
            </button>
          </>
        ) : user?.profile?.role === 'trader' && activePage === 'arina' ? (
          <>
            <label
              className="ls-muted"
              style={{ display: 'block', marginBottom: 5 }}
            >
              {language === 'ar' ? 'الكمية المطلوبة' : 'Quantité souhaitée'}
            </label>
            <input
              type="number"
              min="1"
              step="1"
              style={{ ...styles.field, width: 110, marginBottom: 8 }}
              value={arinaQuantities[product.id] ?? ''}
              onChange={(event) =>
                setArinaQuantities((current) => ({
                  ...current,
                  [product.id]: event.target.value,
                }))
              }
              placeholder={language === 'ar' ? 'الكمية' : 'Qté'}
            />
            <button
              style={styles.button}
              onClick={() => requestUrgentArina(product)}
            >
              {language === 'ar'
                ? 'طلب مرتبة مستعجل'
                : 'Demande matelas urgente'}
            </button>
          </>
        ) : user?.profile?.role === 'trader' ? (
          <>
            <button
              style={styles.button}
              onClick={() => requestReplenishment(product, 'quantity')}
            >
              {language === 'ar' ? 'طلب كمية' : 'Demander une quantité'}
            </button>
            <button
              style={styles.secondary}
              onClick={() => requestReplenishment(product, 'need_item')}
            >
              {language === 'ar'
                ? 'أحتاج هذا المنتج'
                : 'J’ai besoin de cet article'}
            </button>
          </>
        ) : (
          <span className="ls-muted">Consultation uniquement</span>
        )}
      </div>
    );
  }

  function productTableRows() {
    if (!paginatedProducts.length)
      return (
        <tr>
          <td
            colSpan={6}
            style={{ ...styles.td, textAlign: 'center', color: '#64748b' }}
          >
            Aucun produit trouvé.
          </td>
        </tr>
      );
    return paginatedProducts.map((product) => (
      <tr key={product.id || product.product_ref}>
        <td style={styles.td}>
          <strong>{product.product_ref}</strong>
        </td>
        <td style={styles.td}>
          <span>{product.name}</span>
        </td>
        <td
          style={{
            ...styles.td,
            color: Number(product.current_quantity) < 0 ? '#b42318' : '#102b46',
            fontWeight: 800,
          }}
        >
          {isAdmin || showTraderQuantities
            ? product.current_quantity
            : Number(product.current_quantity) <= 0
            ? 'Rupture'
            : Number(product.current_quantity) <=
              Number(product.min_stock_level ?? 5)
            ? 'Proche rupture'
            : 'Disponible'}
          {Number(product.current_quantity) < 0 && ' ⚠️'}
        </td>
        <td style={styles.td}>{product.wholesale_price ?? '—'} DA</td>
        <td style={styles.td}>{product.retail_price ?? '—'} DA</td>
        <td style={styles.td}>{productActions(product)}</td>
      </tr>
    ));
  }

  function productCards() {
    if (!paginatedProducts.length)
      return (
        <div style={{ ...styles.card, textAlign: 'center', color: '#64748b' }}>
          Aucun produit trouvé.
        </div>
      );
    return (
      <div className="ls-product-cards">
        {paginatedProducts.map((product) => (
          <article key={product.id || product.product_ref} style={styles.card}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#64748b', fontSize: 12 }}>
                Réf. {product.product_ref}
              </div>
              <strong>{product.name}</strong>
            </div>
            <div className="ls-card-metrics">
              <div>
                <small>Quantité</small>
                <strong
                  style={{
                    color:
                      Number(product.current_quantity) < 0
                        ? '#b42318'
                        : '#102b46',
                  }}
                >
                  {isAdmin || showTraderQuantities
                    ? product.current_quantity
                    : Number(product.current_quantity) <= 0
                    ? 'Rupture'
                    : Number(product.current_quantity) <=
                      Number(product.min_stock_level ?? 5)
                    ? 'Proche rupture'
                    : 'Disponible'}
                </strong>
              </div>
              <div>
                <small>Prix de gros</small>
                <strong>{product.wholesale_price ?? '—'} DA</strong>
              </div>
              <div>
                <small>Prix de détail</small>
                <strong>{product.retail_price ?? '—'} DA</strong>
              </div>
            </div>
            {productActions(product)}
          </article>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`ls-app ${theme === 'dark' ? 'ls-dark' : ''}`}
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      <style>{`
        *{box-sizing:border-box} body{margin:0;background:#f3f6fa;font-family:Inter,Arial,sans-serif;color:#102b46}
        .ls-app{min-height:100vh;background:#f3f6fa;color:#102b46}.ls-login{max-width:440px;margin:7vh auto;padding:30px;background:#fff;border:1px solid #e2e8f0;border-radius:20px;box-shadow:0 15px 45px rgba(16,43,70,.09)}
        .ls-brand{display:flex;align-items:center;gap:12px}.ls-brand-mark{display:grid;place-items:center;background:#fff;color:#102b46;border-radius:12px;width:42px;height:42px;font-weight:900;font-size:19px}.ls-layout{display:grid;grid-template-columns:250px minmax(0,1fr);min-height:100vh}.ls-sidebar{background:#102b46;color:#fff;padding:22px 14px;display:flex;flex-direction:column;gap:20px}.ls-nav{display:flex;flex-direction:column;gap:5px}.ls-nav button{display:flex;gap:11px;align-items:center;width:100%;border:0;border-radius:10px;padding:12px;color:#d8e4f1;background:transparent;text-align:left;cursor:pointer;font-weight:600}.ls-nav button.active,.ls-nav button:hover{background:#214361;color:#fff}.ls-nav .ls-count{margin-left:auto;background:#e5484d;color:white;border-radius:20px;padding:2px 7px;font-size:11px}.ls-main{min-width:0;padding:26px clamp(14px,3vw,34px) 50px}.ls-topbar{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:24px}.ls-panel{background:white;border:1px solid #e2e8f0;border-radius:14px;padding:18px;margin-bottom:18px;min-width:0}.ls-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}.ls-stat{padding:18px;background:white;border:1px solid #e2e8f0;border-radius:14px}.ls-stat small{display:block;color:#64748b;margin-bottom:8px}.ls-stat strong{font-size:25px}.ls-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0 16px}.ls-search{flex:1;min-width:200px}.ls-table-wrap{width:100%;overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px}.ls-table{width:100%;border-collapse:collapse;min-width:850px;background:white}.ls-table th button{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:0}.ls-actions{display:flex;gap:7px;flex-wrap:wrap}.ls-actions button{font-size:12px;padding:8px 9px}.ls-pagination{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px}.ls-product-cards{display:none}.ls-photo-placeholder{width:78px;height:78px;display:grid;place-items:center;border-radius:10px;background:#edf2f7;color:#9aaabd;font-weight:900}.ls-card-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:16px 0}.ls-card-metrics>div{background:#f5f8fb;border-radius:9px;padding:10px;min-width:0}.ls-card-metrics small{display:block;color:#64748b;font-size:11px;margin-bottom:5px}.ls-card-metrics strong{font-size:13px;overflow-wrap:anywhere}.ls-alert{padding:12px 14px;border-radius:10px;background:#fff2e0;color:#9a4b00;border:1px solid #ffddb0;margin:12px 0}.ls-message{padding:12px 14px;background:#eaf2ff;border:1px solid #cbdcf5;border-radius:10px;margin-bottom:16px;overflow-wrap:anywhere}.ls-request{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:14px 0;border-top:1px solid #edf1f5}.ls-muted{color:#64748b;font-size:13px}.ls-photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}.ls-photo-grid img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;background:#f1f5f9}.ls-input-row{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end}.ls-footer-note{color:#8ba0b5;font-size:12px;line-height:1.5;margin-top:auto;padding:8px}
        .ls-dark{background:#101820!important;color:#e7edf4!important}.ls-dark .ls-main,.ls-dark .ls-panel,.ls-dark .ls-stat,.ls-dark .ls-table,.ls-dark .ls-login{background:#182431!important;color:#e7edf4!important;border-color:#334456!important}.ls-dark .ls-table-wrap{border-color:#334456!important}.ls-dark .ls-table td,.ls-dark .ls-table th,.ls-dark article{border-color:#334456!important;color:#e7edf4}.ls-dark input,.ls-dark select,.ls-dark textarea{background:#111b25!important;color:#e7edf4!important;border-color:#405266!important}.ls-dark .ls-card-metrics>div,.ls-dark [style*="background: rgb(245, 248, 251)"],.ls-dark [style*="background: rgb(245, 248, 251)"]{background:#223242!important;color:#e7edf4!important}.ls-dark .ls-muted{color:#a9b8c8!important}.ls-dark .ls-message{background:#20344a!important;color:#e7edf4!important;border-color:#405266!important}
        @media(max-width:1050px){.ls-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ls-layout{grid-template-columns:215px minmax(0,1fr)}}
        @media(max-width:760px){.ls-layout{display:block}.ls-sidebar{position:sticky;top:0;z-index:10;padding:10px 12px;gap:10px}.ls-sidebar-head{display:flex;justify-content:space-between;align-items:center}.ls-nav{flex-direction:row;overflow-x:auto;gap:6px;padding-bottom:2px;scrollbar-width:thin}.ls-nav button{white-space:nowrap;width:auto;flex-shrink:0;padding:10px 12px;font-size:12px}.ls-nav button .ls-nav-text{display:inline}.ls-footer-note{display:none}.ls-main{padding:16px 12px 38px}.ls-topbar{align-items:flex-start;flex-direction:column;margin-bottom:16px}.ls-topbar-actions{width:100%;display:flex;gap:8px;flex-wrap:wrap}.ls-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.ls-stat{padding:13px}.ls-stat strong{font-size:21px}.ls-table-wrap:not(.ls-force-table){display:none}.ls-product-cards{display:grid;grid-template-columns:1fr;gap:12px}.ls-panel{padding:13px}.ls-input-row{grid-template-columns:1fr}.ls-request{grid-template-columns:1fr}.ls-actions button{flex:1}.ls-login{margin:5vh 14px;padding:22px}.ls-card-metrics{gap:6px}.ls-card-metrics>div{padding:8px}.ls-card-metrics strong{font-size:12px}}
      `}</style>

      {!user ? (
        <div className="ls-login">
          <div className="ls-brand" style={{ marginBottom: 24 }}>
            <div
              className="ls-brand-mark"
              style={{ background: '#102b46', color: '#fff' }}
            >
              LS
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 25 }}>Linge Stock</h1>
              <div className="ls-muted">Gestion intelligente du stock</div>
            </div>
          </div>
          {message && (
            <div className="ls-message" role="status">
              {message}
            </div>
          )}
          <form onSubmit={login}>
            <label
              style={{ display: 'block', fontWeight: 700, marginBottom: 7 }}
            >
              Adresse e-mail
            </label>
            <input
              style={{ ...styles.field, marginBottom: 16 }}
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
            />
            <label
              style={{ display: 'block', fontWeight: 700, marginBottom: 7 }}
            >
              Mot de passe
            </label>
            <input
              style={{ ...styles.field, marginBottom: 18 }}
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
            <button
              style={{ ...styles.button, width: '100%', padding: 13 }}
              type="submit"
              disabled={loading}
            >
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </div>
      ) : (
        <div
          className="ls-layout"
          onTouchStart={(event) => {
            setTouchStart(event.changedTouches[0].clientX);
            setTouchEnd(null);
          }}
          onTouchEnd={(event) => {
            const end = event.changedTouches[0].clientX;
            setTouchEnd(end);
            if (touchStart == null || Math.abs(end - touchStart) < 100) return;
            const target = event.target;
            if (
              target?.closest?.(
                'input, textarea, select, button, a, .ls-table-wrap, .ls-nav'
              )
            )
              return;
            const index = visibleNavItems.findIndex(
              (item) => item.id === activePage
            );
            const nextIndex =
              end < touchStart
                ? Math.min(visibleNavItems.length - 1, index + 1)
                : Math.max(0, index - 1);
            if (visibleNavItems[nextIndex])
              navigateTo(visibleNavItems[nextIndex].id);
          }}
        >
          <aside className="ls-sidebar">
            <div className="ls-sidebar-head">
              <div className="ls-brand">
                <div className="ls-brand-mark">LS</div>
                <div>
                  <strong style={{ fontSize: 19 }}>Linge Stock</strong>
                  <div style={{ color: '#a9bdd1', fontSize: 11 }}>
                    Gestion du stock
                  </div>
                </div>
              </div>
            </div>
            <nav className="ls-nav" aria-label="Navigation principale">
              {visibleNavItems.map((item) => (
                <button
                  key={item.id}
                  className={activePage === item.id ? 'active' : ''}
                  onClick={() => navigateTo(item.id)}
                >
                  <span style={{ width: 17, textAlign: 'center' }}>
                    {item.icon}
                  </span>
                  <span className="ls-nav-text">{item.label}</span>
                  {item.id === 'requests' && newRequestsCount > 0 && (
                    <span className="ls-count">{newRequestsCount}</span>
                  )}
                </button>
              ))}
            </nav>
            <div className="ls-footer-note">
              Connecté en tant que
              <br />
              <strong>{user.profile.full_name || user.email}</strong>
              <br />
              {isAdmin
                ? 'Administrateur'
                : user.profile.role === 'sous_admin'
                ? 'Sous-administrateur'
                : user.profile.role === 'viewer'
                ? 'Consultation'
                : 'Compte trader'}
            </div>
          </aside>
          <main className="ls-main">
            <div className="ls-topbar">
              <div>
                <div className="ls-muted">
                  LINGE STOCK / {activePageTitle.toLocaleUpperCase('fr')}
                </div>
                <h1
                  style={{
                    margin: '5px 0 0',
                    fontSize: 'clamp(23px,3vw,30px)',
                  }}
                >
                  {activePageTitle}
                </h1>
                <div className="ls-muted" style={{ marginTop: 5 }}>
                  Bonjour, {user.profile.full_name || user.email}
                </div>
              </div>
              <div className="ls-topbar-actions">
                <button
                  style={styles.secondary}
                  onClick={() => {
                    loadProducts();
                    loadReplenishmentRequests();
                    if (isAdmin) loadStockHistory();
                    if (activePage === 'photos') loadProductPhotos();
                  }}
                >
                  ↻ Actualiser
                </button>
                <button style={styles.secondary} onClick={logout}>
                  Déconnexion
                </button>
              </div>
            </div>
            {message && (
              <div className="ls-message" role="status">
                {message}
              </div>
            )}

            {activePage === 'dashboard' && isAdmin && (
              <>
                <div className="ls-grid">
                  <div className="ls-stat">
                    <small>Produits visibles</small>
                    <strong>{products.length.toLocaleString('fr-FR')}</strong>
                  </div>
                  <div className="ls-stat">
                    <small>Quantités négatives</small>
                    <strong
                      style={{
                        color: negativeProducts.length ? '#b42318' : '#102b46',
                      }}
                    >
                      {negativeProducts.length}
                    </strong>
                  </div>
                  <div className="ls-stat">
                    <small>Nouvelles demandes</small>
                    <strong>{newRequestsCount}</strong>
                  </div>
                  <div className="ls-stat">
                    <small>Photos enregistrées</small>
                    <strong>{productPhotos.length}</strong>
                  </div>
                </div>
                {isAdmin && (
                  <section className="ls-panel">
                    <h2 style={{ marginTop: 0 }}>Dernier import historique</h2>
                    <div className="ls-muted">
                      Fichier :{' '}
                      <strong>
                        {lastImportBatch?.file_name ||
                          lastImportBatch?.filename ||
                          lastImportBatch?.source_file_name ||
                          'Information non disponible'}
                      </strong>
                    </div>
                    <div className="ls-muted" style={{ marginTop: 5 }}>
                      Date :{' '}
                      <strong>
                        {lastImportBatch?.snapshot_date ||
                          lastImportBatch?.import_date ||
                          (lastImportBatch?.created_at
                            ? new Date(
                                lastImportBatch.created_at
                              ).toLocaleString('fr-FR')
                            : 'Aucun import trouvé')}
                      </strong>
                    </div>
                    <div className="ls-muted" style={{ marginTop: 5 }}>
                      Dernière correction manuelle :{' '}
                      <strong>
                        {lastStockUpdate
                          ? new Date(lastStockUpdate).toLocaleString('fr-FR')
                          : 'Aucune correction enregistrée'}
                      </strong>
                    </div>
                  </section>
                )}
                {isAdmin && (
                  <section
                    className="ls-panel"
                    style={{
                      borderColor: urgentNewRequests.length
                        ? '#f2b84b'
                        : '#e2e8f0',
                      borderWidth: urgentNewRequests.length ? 2 : 1,
                    }}
                  >
                    <h2
                      style={{
                        marginTop: 0,
                        color: urgentNewRequests.length ? '#9a4b00' : '#102b46',
                      }}
                    >
                      🚨 Demandes urgentes — Matelas Europ Arina (
                      {urgentNewRequests.length})
                    </h2>
                    {urgentNewRequests.length === 0 ? (
                      <p className="ls-muted">
                        Aucune demande urgente pour le moment.
                      </p>
                    ) : (
                      urgentNewRequests.map((request) => (
                        <div
                          key={request.id}
                          style={{
                            padding: '10px 0',
                            borderTop: '1px solid #f3d5a0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 10,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div>
                            <strong>
                              {request.products?.name || 'Matelas Europ Arina'}
                            </strong>
                            <div className="ls-muted">
                              {request.trader_name || 'Client'} ·{' '}
                              {new Date(request.created_at).toLocaleString(
                                'fr-FR'
                              )}
                            </div>
                          </div>
                          <strong>
                            Quantité :{' '}
                            {request.requested_quantity ?? 'À confirmer'}
                          </strong>
                          <button
                            style={styles.secondary}
                            onClick={() => navigateTo('requests')}
                          >
                            Ouvrir
                          </button>
                        </div>
                      ))
                    )}
                  </section>
                )}
                {isAdmin && (
                  <section className="ls-panel">
                    <h2 style={{ marginTop: 0 }}>
                      🔔 Demandes de réapprovisionnement
                    </h2>
                    <p className="ls-muted">
                      Les nouvelles demandes sont affichées en premier.
                    </p>
                    {newRequests.length === 0 ? (
                      <p>Aucune nouvelle demande.</p>
                    ) : (
                      <>
                        <p>
                          <strong>
                            {newRequests.length} nouvelle(s) demande(s)
                          </strong>
                        </p>
                        {newRequests.slice(0, 3).map((request) => (
                          <div
                            key={request.id}
                            style={{
                              padding: '9px 0',
                              borderTop: '1px solid #edf1f5',
                              display: 'flex',
                              justifyContent: 'space-between',
                              gap: 10,
                              flexWrap: 'wrap',
                            }}
                          >
                            <span>
                              {request.products?.name || 'Produit'}{' '}
                              <span className="ls-muted">
                                — {request.trader_name || 'Trader'}
                              </span>
                            </span>
                            <strong>
                              {request.request_type === 'need_item' ||
                              request.requested_quantity == null
                                ? 'Quantité à confirmer'
                                : `Qté : ${request.requested_quantity}`}
                            </strong>
                          </div>
                        ))}
                        <button
                          style={styles.button}
                          onClick={() => navigateTo('requests')}
                        >
                          Ouvrir les demandes
                        </button>
                        <button
                          style={{ ...styles.secondary, marginLeft: 8 }}
                          onClick={copyNewRequests}
                        >
                          Copier toutes les nouvelles demandes
                        </button>
                      </>
                    )}
                  </section>
                )}
                {isAdmin && (
                  <section className="ls-panel">
                    <h2 style={{ marginTop: 0 }}>
                      Importer un fichier CSV — Historique
                    </h2>
                    <p className="ls-muted">
                      L’import ajoute un instantané historique. Il ne modifie
                      pas le stock actuel.
                    </p>
                    <input
                      style={styles.field}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleCsvFile}
                    />
                    {csvFileName && (
                      <p>
                        <strong>Fichier :</strong> {csvFileName}
                      </p>
                    )}
                    {csvPreview.length > 0 && (
                      <>
                        <p>{csvPreview.length} lignes détectées.</p>
                        <div className="ls-table-wrap">
                          <table className="ls-table">
                            <thead>
                              <tr>
                                {Object.keys(csvPreview[0]).map((header) => (
                                  <th style={styles.th} key={header}>
                                    {header}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {csvPreview.slice(0, 5).map((row, index) => (
                                <tr key={index}>
                                  {Object.keys(csvPreview[0]).map((header) => (
                                    <td style={styles.td} key={header}>
                                      {String(row[header] ?? '')}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="ls-toolbar">
                          <button
                            style={styles.button}
                            onClick={importCsvToSupabase}
                          >
                            Confirmer l’import historique
                          </button>
                          <button
                            style={styles.secondary}
                            onClick={() => {
                              setCsvPreview([]);
                              setCsvFileName('');
                              setMessage('Aperçu annulé.');
                            }}
                          >
                            Annuler
                          </button>
                        </div>
                      </>
                    )}
                  </section>
                )}
                {negativeProducts.length > 0 && (
                  <section className="ls-panel">
                    <div className="ls-alert">
                      ⚠️ {negativeProducts.length} produit(s) ont une quantité
                      négative. Les quantités sont conservées telles
                      qu’importées et doivent être vérifiées.
                    </div>
                    <div className="ls-table-wrap ls-force-table">
                      <table className="ls-table">
                        <thead>
                          <tr>
                            <th style={styles.th}>Référence</th>
                            <th style={styles.th}>Désignation</th>
                            <th style={styles.th}>Quantité</th>
                            <th style={styles.th}>Prix de gros</th>
                            <th style={styles.th}>Prix de détail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {negativeProducts.map((product) => (
                            <tr key={product.id}>
                              <td style={styles.td}>{product.product_ref}</td>
                              <td style={styles.td}>{product.name}</td>
                              <td
                                style={{
                                  ...styles.td,
                                  color: '#b42318',
                                  fontWeight: 800,
                                }}
                              >
                                {product.current_quantity}
                              </td>
                              <td style={styles.td}>
                                {product.wholesale_price ?? '—'} DA
                              </td>
                              <td style={styles.td}>
                                {product.retail_price ?? '—'} DA
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      style={{ ...styles.secondary, marginTop: 12 }}
                      onClick={() => navigateTo('products')}
                    >
                      Afficher tous les produits
                    </button>
                  </section>
                )}
                <section className="ls-panel">
                  <h2 style={{ marginTop: 0 }}>Accès rapide</h2>
                  <div className="ls-toolbar">
                    {[
                      { id: 'products', label: 'Tous les produits' },
                      { id: 'arina', label: 'Matelas Europ Arina' },
                      { id: 'textiles', label: 'CHORA / VOILAGE / RIDEAU' },
                      { id: 'photos', label: 'Photos des produits' },
                      { id: 'requests', label: 'Demandes clients' },
                      { id: 'notes', label: 'Notes clients' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        style={styles.secondary}
                        onClick={() => navigateTo(item.id)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}

            {['products', 'arina', 'textiles'].includes(activePage) && (
              <section className="ls-panel">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0 }}>
                      {language === 'ar'
                        ? activePage === 'products'
                          ? 'المنتجات المتوفرة'
                          : activePage === 'arina'
                          ? 'مراتب Europ Arina'
                          : 'CHORA / VOILAGE / RIDEAU'
                        : activePage === 'products'
                        ? 'Produits en stock'
                        : activePage === 'arina'
                        ? 'Matelas Europ Arina'
                        : 'CHORA / VOILAGE / RIDEAU'}
                    </h2>
                    <div className="ls-muted" style={{ marginTop: 5 }}>
                      {sortedProducts.length.toLocaleString('fr-FR')} produit(s)
                    </div>
                  </div>
                  {!isAdmin && (
                    <span className="ls-muted">
                      {showTraderQuantities
                        ? 'Quantités exactes affichées'
                        : 'Disponibilité affichée par indicateur'}
                    </span>
                  )}
                </div>
                <div className="ls-toolbar">
                  <input
                    className="ls-search"
                    style={styles.field}
                    value={searchTerm}
                    onChange={(event) => {
                      setSearchTerm(event.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder={
                      language === 'ar'
                        ? 'ابحث باسم المنتج (Désignation)…'
                        : 'Rechercher par désignation…'
                    }
                  />
                  <label className="ls-muted">
                    {language === 'ar' ? 'ترتيب حسب' : 'Trier par'}{' '}
                    <select
                      style={{ ...styles.field, width: 'auto', marginLeft: 6 }}
                      value={sortKey}
                      onChange={(event) => changeSort(event.target.value)}
                      aria-label={
                        language === 'ar'
                          ? 'ترتيب المنتجات حسب'
                          : 'Trier les produits par'
                      }
                    >
                      <option value="current_quantity">
                        {language === 'ar' ? 'الكمية' : 'Quantité'}
                      </option>
                      <option value="wholesale_price">
                        {language === 'ar' ? 'سعر الجملة' : 'Prix de gros'}
                      </option>
                      <option value="retail_price">
                        {language === 'ar' ? 'سعر التجزئة' : 'Prix de détail'}
                      </option>
                      <option value="name">
                        {language === 'ar' ? 'اسم المنتج' : 'Désignation'}
                      </option>
                      <option value="product_ref">
                        {language === 'ar' ? 'المرجع' : 'Référence'}
                      </option>
                    </select>
                  </label>
                  <button
                    type="button"
                    style={styles.secondary}
                    onClick={() => {
                      setSortDirection((direction) =>
                        direction === 'asc' ? 'desc' : 'asc'
                      );
                      setCurrentPage(1);
                    }}
                    aria-label={
                      language === 'ar'
                        ? 'تغيير اتجاه الترتيب'
                        : 'Inverser le sens du tri'
                    }
                  >
                    {sortDirection === 'asc'
                      ? language === 'ar'
                        ? 'تصاعدي ▲'
                        : 'Croissant ▲'
                      : language === 'ar'
                      ? 'تنازلي ▼'
                      : 'Décroissant ▼'}
                  </button>
                  <label className="ls-muted">
                    {language === 'ar' ? 'عدد الأسطر' : 'Lignes par page'}{' '}
                    <select
                      style={{ ...styles.field, width: 'auto', marginLeft: 6 }}
                      value={pageSize}
                      onChange={(event) => {
                        setPageSize(Number(event.target.value));
                        setCurrentPage(1);
                      }}
                    >
                      {[10, 20, 50, 100].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="ls-table-wrap">
                  <table className="ls-table">
                    <thead>
                      <tr>
                        <th style={styles.th}>
                          <button onClick={() => changeSort('product_ref')}>
                            {sortLabel(
                              'product_ref',
                              language === 'ar' ? 'المرجع' : 'Référence'
                            )}
                          </button>
                        </th>
                        <th style={styles.th}>
                          <button onClick={() => changeSort('name')}>
                            {sortLabel(
                              'name',
                              language === 'ar' ? 'اسم المنتج' : 'Désignation'
                            )}
                          </button>
                        </th>
                        <th style={styles.th}>
                          <button
                            onClick={() => changeSort('current_quantity')}
                          >
                            {sortLabel(
                              'current_quantity',
                              language === 'ar' ? 'الكمية' : 'Quantité'
                            )}
                          </button>
                        </th>
                        <th style={styles.th}>
                          <button onClick={() => changeSort('wholesale_price')}>
                            {sortLabel(
                              'wholesale_price',
                              language === 'ar' ? 'سعر الجملة' : 'Prix de gros'
                            )}
                          </button>
                        </th>
                        <th style={styles.th}>
                          <button onClick={() => changeSort('retail_price')}>
                            {sortLabel(
                              'retail_price',
                              language === 'ar'
                                ? 'سعر التجزئة'
                                : 'Prix de détail'
                            )}
                          </button>
                        </th>
                        <th style={styles.th}>
                          {language === 'ar' ? 'إجراء' : 'Action'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>{productTableRows()}</tbody>
                  </table>
                </div>
                {productCards()}
                <div className="ls-pagination">
                  <span className="ls-muted">
                    Page {safeCurrentPage} sur {totalPages}
                  </span>
                  <div className="ls-toolbar" style={{ margin: 0 }}>
                    <button
                      style={styles.secondary}
                      disabled={safeCurrentPage <= 1}
                      onClick={() =>
                        setCurrentPage((page) => Math.max(1, page - 1))
                      }
                    >
                      {language === 'ar' ? 'السابق ←' : '← Précédent'}
                    </button>
                    <button
                      style={styles.secondary}
                      disabled={safeCurrentPage >= totalPages}
                      onClick={() =>
                        setCurrentPage((page) => Math.min(totalPages, page + 1))
                      }
                    >
                      {language === 'ar' ? '→ التالي' : 'Suivant →'}
                    </button>
                  </div>
                </div>
                {activePage === 'products' &&
                  (isAdmin || user?.profile?.can_view_negative_stock) &&
                  negativeProducts.length > 0 && (
                    <section style={{ marginTop: 22 }}>
                      <h3>
                        ⚠️ Produits à quantité négative (
                        {negativeProducts.length})
                      </h3>
                      <div className="ls-alert">
                        Les quantités négatives sont conservées telles
                        qu’importées. Vérifiez ces produits.
                      </div>
                      <div className="ls-table-wrap ls-force-table">
                        <table className="ls-table">
                          <thead>
                            <tr>
                              <th style={styles.th}>Référence</th>
                              <th style={styles.th}>Désignation</th>
                              <th style={styles.th}>Quantité</th>
                              <th style={styles.th}>Prix de gros</th>
                              <th style={styles.th}>Prix de détail</th>
                            </tr>
                          </thead>
                          <tbody>
                            {negativeProducts.map((product) => (
                              <tr key={product.id}>
                                <td style={styles.td}>{product.product_ref}</td>
                                <td style={styles.td}>{product.name}</td>
                                <td
                                  style={{
                                    ...styles.td,
                                    color: '#b42318',
                                    fontWeight: 800,
                                  }}
                                >
                                  {product.current_quantity}
                                </td>
                                <td style={styles.td}>
                                  {product.wholesale_price ?? '—'} DA
                                </td>
                                <td style={styles.td}>
                                  {product.retail_price ?? '—'} DA
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
              </section>
            )}

            {activePage === 'photos' && (
              <section className="ls-panel">
                <h2 style={{ marginTop: 0 }}>Photos des produits</h2>
                <p className="ls-muted">
                  Les photos sont compressées en JPEG, avec un objectif
                  inférieur à 1 Mo. Elles restent liées au produit même après un
                  nouvel import CSV.
                </p>
                {isAdmin ? (
                  <div className="ls-input-row" style={{ margin: '18px 0' }}>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontWeight: 700,
                          marginBottom: 6,
                        }}
                      >
                        Choisir un produit
                      </label>
                      <select
                        style={styles.field}
                        value={photoProductId}
                        onChange={(event) =>
                          setPhotoProductId(event.target.value)
                        }
                      >
                        <option value="">Sélectionner…</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.product_ref} — {product.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontWeight: 700,
                          marginBottom: 6,
                        }}
                      >
                        Photo (JPEG, PNG ou WebP)
                      </label>
                      <input
                        id="product-photo-input"
                        style={styles.field}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) =>
                          setPhotoFile(event.target.files?.[0] || null)
                        }
                      />
                    </div>
                    <button
                      style={styles.button}
                      disabled={photoUploading}
                      onClick={saveProductPhoto}
                    >
                      {photoUploading
                        ? 'Compression…'
                        : 'Ajouter / remplacer la photo'}
                    </button>
                  </div>
                ) : (
                  <p className="ls-muted">
                    Seul l’administrateur peut ajouter ou remplacer les photos.
                  </p>
                )}
                <div className="ls-photo-grid">
                  {productPhotos.map((photo) => {
                    const product =
                      products.find((item) => item.id === photo.product_id) ||
                      hiddenProducts.find(
                        (item) => item.id === photo.product_id
                      );
                    return (
                      <article
                        style={styles.card}
                        key={photo.id || photo.product_id}
                      >
                        <img
                          src={photo.photo_url}
                          alt={product?.name || 'Photo produit'}
                        />
                        <strong>{product?.name || 'Produit'}</strong>
                        <div className="ls-muted">
                          Réf. {product?.product_ref || '—'}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 8,
                            marginTop: 10,
                          }}
                        >
                          <span>
                            Gros : {product?.wholesale_price ?? '—'} DA
                          </span>
                          <span>
                            Détail : {product?.retail_price ?? '—'} DA
                          </span>
                        </div>
                        <div style={{ marginTop: 7 }}>
                          Quantité :{' '}
                          <strong>{product?.current_quantity ?? '—'}</strong>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {productPhotos.length === 0 && (
                  <p className="ls-muted">
                    Aucune photo enregistrée pour le moment.
                  </p>
                )}
              </section>
            )}

            {activePage === 'requests' && isAdmin && (
              <section className="ls-panel">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0 }}>Demandes clients</h2>
                    <p className="ls-muted">
                      Délai indicatif de livraison : 1 à 3 jours. Les demandes
                      urgentes apparaissent en premier.
                    </p>
                  </div>
                  <div className="ls-toolbar">
                    <button
                      style={styles.secondary}
                      onClick={loadReplenishmentRequests}
                    >
                      Actualiser
                    </button>
                    <button style={styles.button} onClick={copyNewRequests}>
                      Copier toutes les nouvelles demandes
                    </button>
                  </div>
                </div>
                {requestsLoading ? (
                  <p>Chargement des demandes…</p>
                ) : activeRequests.length === 0 ? (
                  <p>Aucune demande active.</p>
                ) : (
                  <div className="ls-table-wrap ls-force-table">
                    <table className="ls-table">
                      <thead>
                        <tr>
                          <th style={styles.th}>Priorité</th>
                          <th style={styles.th}>Désignation</th>
                          <th style={styles.th}>Client</th>
                          <th style={styles.th}>Date</th>
                          <th style={styles.th}>Quantité</th>
                          <th style={styles.th}>Statut</th>
                          <th style={styles.th}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...activeRequests]
                          .sort(
                            (a, b) =>
                              Number(Boolean(b.is_urgent)) -
                                Number(Boolean(a.is_urgent)) ||
                              new Date(b.created_at) - new Date(a.created_at)
                          )
                          .map((request) => (
                            <tr key={request.id}>
                              <td style={styles.td}>
                                {request.is_urgent ? (
                                  <strong style={{ color: '#9a4b00' }}>
                                    🚨 URGENT
                                  </strong>
                                ) : (
                                  'Normale'
                                )}
                              </td>
                              <td style={styles.td}>
                                <strong>
                                  {request.products?.name || 'Produit inconnu'}
                                </strong>
                                <div className="ls-muted">
                                  Réf. {request.products?.product_ref || '—'}
                                </div>
                              </td>
                              <td style={styles.td}>
                                {request.trader_name || 'Trader'}
                              </td>
                              <td style={styles.td}>
                                {new Date(request.created_at).toLocaleString(
                                  'fr-FR'
                                )}
                              </td>
                              <td style={styles.td}>
                                {request.request_type === 'need_item' ||
                                request.requested_quantity == null
                                  ? 'À confirmer'
                                  : request.requested_quantity}
                              </td>
                              <td style={styles.td}>
                                <select
                                  style={{ ...styles.field, minWidth: 120 }}
                                  value={request.status}
                                  onChange={(event) =>
                                    updateRequestStatus(
                                      request.id,
                                      event.target.value
                                    )
                                  }
                                >
                                  <option value="new">Nouvelle</option>
                                  <option value="in_progress">En cours</option>
                                  <option value="treated">Traitée</option>
                                </select>
                              </td>
                              <td style={styles.td}>
                                <button
                                  style={styles.secondary}
                                  onClick={() => archiveRequest(request.id)}
                                >
                                  Archiver
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <details
                  style={{
                    marginTop: 20,
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <summary style={{ cursor: 'pointer', fontWeight: 800 }}>
                    Archives des demandes ({archivedRequests.length})
                  </summary>
                  {archivedRequests.length === 0 ? (
                    <p className="ls-muted">Aucune demande archivée.</p>
                  ) : (
                    <div
                      className="ls-table-wrap ls-force-table"
                      style={{ marginTop: 12 }}
                    >
                      <table className="ls-table">
                        <thead>
                          <tr>
                            <th style={styles.th}>Priorité</th>
                            <th style={styles.th}>Désignation</th>
                            <th style={styles.th}>Client</th>
                            <th style={styles.th}>Date</th>
                            <th style={styles.th}>Quantité</th>
                            <th style={styles.th}>Statut</th>
                            <th style={styles.th}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {archivedRequests.map((request) => (
                            <tr key={request.id}>
                              <td style={styles.td}>
                                {request.is_urgent ? (
                                  <strong style={{ color: '#9a4b00' }}>
                                    🚨 URGENT
                                  </strong>
                                ) : (
                                  'Normale'
                                )}
                              </td>
                              <td style={styles.td}>
                                <strong>
                                  {request.products?.name || 'Produit inconnu'}
                                </strong>
                                <div className="ls-muted">
                                  Réf. {request.products?.product_ref || '—'}
                                </div>
                              </td>
                              <td style={styles.td}>
                                {request.trader_name || 'Trader'}
                              </td>
                              <td style={styles.td}>
                                {new Date(request.created_at).toLocaleString(
                                  'fr-FR'
                                )}
                              </td>
                              <td style={styles.td}>
                                {request.request_type === 'need_item' ||
                                request.requested_quantity == null
                                  ? 'À confirmer'
                                  : request.requested_quantity}
                              </td>
                              <td style={styles.td}>
                                {request.status === 'new'
                                  ? 'Nouvelle'
                                  : request.status === 'in_progress'
                                  ? 'En cours'
                                  : 'Traitée'}
                              </td>
                              <td style={styles.td}>
                                <button
                                  style={styles.secondary}
                                  onClick={() => unarchiveRequest(request.id)}
                                >
                                  Restaurer
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </details>
              </section>
            )}

            {activePage === 'notes' && (
              <section className="ls-panel">
                <h2 style={{ marginTop: 0 }}>
                  {isAdmin
                    ? 'Notes reçues des clients'
                    : 'Envoyer une note à l’administrateur'}
                </h2>
                <p className="ls-muted">
                  Vous pouvez envoyer plusieurs notes sur différents produits.
                  L’administrateur les traite depuis cette page.
                </p>
                {true && (
                  <form
                    onSubmit={submitProductNote}
                    style={{
                      background: '#f5f8fb',
                      padding: 14,
                      borderRadius: 12,
                      margin: '16px 0',
                    }}
                  >
                    <div style={{ marginBottom: 12 }}>
                      <label
                        style={{
                          display: 'block',
                          fontWeight: 700,
                          marginBottom: 6,
                        }}
                      >
                        Produit concerné
                      </label>
                      <select
                        style={styles.field}
                        value={noteProductId}
                        onChange={(event) =>
                          setNoteProductId(event.target.value)
                        }
                        required
                      >
                        <option value="">Sélectionner un produit…</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.product_ref} — {product.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label
                        style={{
                          display: 'block',
                          fontWeight: 700,
                          marginBottom: 6,
                        }}
                      >
                        Votre note
                      </label>
                      <textarea
                        style={{
                          ...styles.field,
                          minHeight: 100,
                          resize: 'vertical',
                        }}
                        value={noteText}
                        onChange={(event) => setNoteText(event.target.value)}
                        placeholder="Écrivez votre remarque sur ce produit…"
                        required
                        maxLength={2000}
                      />
                    </div>
                    <button style={styles.button} type="submit">
                      {isAdmin ? 'Ajouter une note' : 'Envoyer la note'}
                    </button>
                  </form>
                )}
                {notesLoading ? (
                  <p>Chargement des notes…</p>
                ) : productNotes.length === 0 ? (
                  <p>Aucune note pour le moment.</p>
                ) : (
                  productNotes.map((note) => (
                    <article
                      key={note.id}
                      style={{
                        padding: 14,
                        border: '1px solid #e2e8f0',
                        borderRadius: 12,
                        marginTop: 10,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 12,
                          flexWrap: 'wrap',
                        }}
                      >
                        <strong>
                          {note.products?.name || 'Produit inconnu'}
                        </strong>
                        <span className="ls-muted">
                          {new Date(note.created_at).toLocaleString('fr-FR')}
                        </span>
                      </div>
                      <div className="ls-muted" style={{ marginTop: 4 }}>
                        Réf. {note.products?.product_ref || '—'}
                        {isAdmin
                          ? ` · Auteur : ${note.author_name || 'Utilisateur'}`
                          : ''}
                      </div>
                      <p
                        style={{
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {note.note}
                      </p>
                      <div
                        style={{
                          display: 'flex',
                          gap: 10,
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span className="ls-muted">
                          Statut :{' '}
                          <strong>
                            {note.status === 'new'
                              ? 'Nouvelle'
                              : note.status === 'in_progress'
                              ? 'En cours'
                              : 'Traitée'}
                          </strong>
                        </span>
                        {isAdmin && (
                          <select
                            style={{ ...styles.field, width: 170 }}
                            value={note.status}
                            onChange={(event) =>
                              updateProductNoteStatus(
                                note.id,
                                event.target.value
                              )
                            }
                          >
                            <option value="new">Nouvelle</option>
                            <option value="in_progress">En cours</option>
                            <option value="treated">Traitée</option>
                          </select>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </section>
            )}

            {activePage === 'history' && isAdmin && (
              <section className="ls-panel">
                <h2 style={{ marginTop: 0 }}>
                  Historique des modifications du stock
                </h2>
                <p className="ls-muted">
                  Les corrections manuelles sont enregistrées avec date,
                  ancienne quantité, nouvelle quantité et motif.
                </p>
                <div className="ls-table-wrap">
                  <table className="ls-table">
                    <thead>
                      <tr>
                        {[
                          'Date',
                          'Référence',
                          'Ancienne quantité',
                          'Nouvelle quantité',
                          'Motif',
                          'Administrateur',
                        ].map((label) => (
                          <th style={styles.th} key={label}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stockHistory.map((item) => (
                        <tr key={item.id}>
                          <td style={styles.td}>
                            {new Date(item.created_at).toLocaleString('fr-FR')}
                          </td>
                          <td style={styles.td}>
                            {item.details?.product_ref || item.entity_id}
                          </td>
                          <td style={styles.td}>
                            {item.details?.old_quantity}
                          </td>
                          <td style={styles.td}>
                            {item.details?.new_quantity}
                          </td>
                          <td style={styles.td}>{item.details?.reason}</td>
                          <td style={styles.td}>Linge Stock Admin</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {stockHistory.length === 0 && (
                  <p>Aucune modification enregistrée.</p>
                )}
              </section>
            )}

            {activePage === 'analysis' && isAdmin && (
              <section className="ls-panel">
                <h2 style={{ marginTop: 0 }}>
                  Suggestions de réapprovisionnement urgent
                </h2>
                <p className="ls-muted">
                  Estimation basée sur le dernier CSV et l’historique du stock.
                  Les produits dont le stock estimé dure moins de 7 jours sont
                  affichés en priorité.
                </p>
                <div className="ls-toolbar">
                  <button
                    style={styles.secondary}
                    onClick={loadSuggestedProducts}
                  >
                    Actualiser les suggestions
                  </button>
                  <button
                    style={styles.button}
                    onClick={hideSelectedSuggestions}
                  >
                    Masquer les produits sélectionnés
                  </button>
                  <button
                    style={styles.secondary}
                    onClick={() => setSelectedSuggestions([])}
                  >
                    Désélectionner tout
                  </button>
                </div>
                {suggestedProducts.length === 0 ? (
                  <p>
                    Aucune suggestion à afficher. Cliquez sur Actualiser les
                    suggestions.
                  </p>
                ) : (
                  <div className="ls-table-wrap">
                    <table className="ls-table">
                      <thead>
                        <tr>
                          <th style={styles.th}>Sélection</th>
                          <th style={styles.th}>Référence</th>
                          <th style={styles.th}>Désignation</th>
                          <th style={styles.th}>Dernière quantité CSV</th>
                          <th style={styles.th}>Baisse moyenne / jour</th>
                          <th style={styles.th}>Jours restants estimés</th>
                          <th style={styles.th}>Quantité à commander</th>
                          <th style={styles.th}>Date du dernier relevé</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suggestedProducts.map((product) => (
                          <tr key={product.id || product.product_ref}>
                            <td style={styles.td}>
                              <input
                                type="checkbox"
                                checked={selectedSuggestions.includes(
                                  product.id
                                )}
                                onChange={(event) =>
                                  setSelectedSuggestions((current) =>
                                    event.target.checked
                                      ? [...current, product.id]
                                      : current.filter(
                                          (id) => id !== product.id
                                        )
                                  )
                                }
                              />
                            </td>
                            <td style={styles.td}>
                              {product.product_ref || '—'}
                            </td>
                            <td style={styles.td}>{product.name || '—'}</td>
                            <td style={styles.td}>
                              {product.current_quantity ?? '—'}
                            </td>
                            <td style={styles.td}>
                              {product.average_daily_decrease ?? '—'}
                            </td>
                            <td style={styles.td}>
                              {product.days_remaining == null
                                ? 'Non estimé'
                                : `${product.days_remaining} jours`}
                            </td>
                            <td style={styles.td}>
                              {product.suggested_order_quantity ?? '—'}
                            </td>
                            <td style={styles.td}>
                              {product.last_snapshot_date || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {activePage === 'hidden' && isAdmin && (
              <section className="ls-panel">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0 }}>
                      Produits masqués ({hiddenProducts.length})
                    </h2>
                    <p className="ls-muted">
                      Les produits restent dans la base et leur historique est
                      conservé.
                    </p>
                  </div>
                  <button style={styles.secondary} onClick={loadHiddenProducts}>
                    Actualiser
                  </button>
                </div>
                {hiddenProducts.length === 0 ? (
                  <p>Aucun produit masqué.</p>
                ) : (
                  <div className="ls-table-wrap">
                    <table className="ls-table">
                      <thead>
                        <tr>
                          <th style={styles.th}>Référence</th>
                          <th style={styles.th}>Désignation</th>
                          <th style={styles.th}>Quantité</th>
                          <th style={styles.th}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hiddenProducts.map((product) => (
                          <tr key={product.id}>
                            <td style={styles.td}>{product.product_ref}</td>
                            <td style={styles.td}>{product.name}</td>
                            <td style={styles.td}>
                              {product.current_quantity}
                            </td>
                            <td style={styles.td}>
                              <button
                                style={styles.button}
                                onClick={() => unhideProduct(product)}
                              >
                                Réafficher
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {activePage === 'settings' && (
              <section className="ls-panel">
                <h2 style={{ marginTop: 0 }}>
                  {language === 'ar' ? 'الإعدادات' : 'Paramètres'}
                </h2>
                <div
                  style={{
                    padding: 16,
                    background: '#f5f8fb',
                    borderRadius: 12,
                    marginBottom: 16,
                  }}
                >
                  <label
                    style={{
                      display: 'block',
                      fontWeight: 800,
                      marginBottom: 8,
                    }}
                  >
                    {language === 'ar'
                      ? 'لغة التطبيق'
                      : 'Langue de l’application'}
                  </label>
                  <select
                    style={{ ...styles.field, maxWidth: 320 }}
                    value={language}
                    onChange={(event) =>
                      saveLanguageSetting(event.target.value)
                    }
                  >
                    <option value="fr">Français</option>
                    <option value="ar">العربية</option>
                  </select>
                  <p className="ls-muted" style={{ marginBottom: 0 }}>
                    {language === 'ar'
                      ? 'يتم حفظ اختيار اللغة في حسابك. بعض النصوص المتخصصة قد تبقى بالفرنسية في هذه النسخة.'
                      : 'Votre préférence est enregistrée sur votre compte. Certains textes spécialisés peuvent rester en français dans cette version.'}
                  </p>
                </div>
                <div
                  style={{
                    padding: 16,
                    background: '#f5f8fb',
                    borderRadius: 12,
                    marginBottom: 16,
                  }}
                >
                  <label
                    style={{
                      display: 'block',
                      fontWeight: 800,
                      marginBottom: 8,
                    }}
                  >
                    Thème de l’application
                  </label>
                  <select
                    style={{ ...styles.field, maxWidth: 320 }}
                    value={theme}
                    onChange={(event) => saveThemeSetting(event.target.value)}
                  >
                    <option value="light">Clair</option>
                    <option value="dark">Sombre</option>
                    <option value="system">
                      Système (affiché clair pour le moment)
                    </option>
                  </select>
                </div>
                <section
                  style={{
                    padding: 16,
                    background: '#f5f8fb',
                    borderRadius: 12,
                    marginBottom: 16,
                  }}
                >
                  <h3 style={{ marginTop: 0 }}>Suggestions d’amélioration</h3>
                  {!isAdmin && (
                    <form onSubmit={submitSuggestion}>
                      <label
                        style={{
                          display: 'block',
                          fontWeight: 700,
                          marginBottom: 6,
                        }}
                      >
                        Titre
                      </label>
                      <input
                        style={{ ...styles.field, marginBottom: 10 }}
                        value={suggestionTitle}
                        onChange={(event) =>
                          setSuggestionTitle(event.target.value)
                        }
                        maxLength={160}
                        required
                        placeholder="Ex. Ajouter un filtre"
                      />
                      <label
                        style={{
                          display: 'block',
                          fontWeight: 700,
                          marginBottom: 6,
                        }}
                      >
                        Votre suggestion
                      </label>
                      <textarea
                        style={{
                          ...styles.field,
                          minHeight: 100,
                          resize: 'vertical',
                          marginBottom: 10,
                        }}
                        value={suggestionBody}
                        onChange={(event) =>
                          setSuggestionBody(event.target.value)
                        }
                        maxLength={4000}
                        required
                        placeholder="Décrivez votre idée…"
                      />
                      <button style={styles.button} type="submit">
                        Envoyer à l’administrateur
                      </button>
                      <p className="ls-muted">
                        Votre suggestion est privée : seul l’administrateur peut
                        la consulter.
                      </p>
                    </form>
                  )}
                  {isAdmin && (
                    <>
                      <p className="ls-muted">
                        Seul l’administrateur voit ces suggestions. Cette
                        section permet uniquement de consulter et supprimer.
                      </p>
                      {suggestionsLoading ? (
                        <p>Chargement…</p>
                      ) : suggestions.length === 0 ? (
                        <p>Aucune suggestion reçue.</p>
                      ) : (
                        suggestions.map((item) => (
                          <article
                            key={item.id}
                            style={{
                              background: 'white',
                              border: '1px solid #e2e8f0',
                              borderRadius: 10,
                              padding: 12,
                              marginTop: 10,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 10,
                                flexWrap: 'wrap',
                              }}
                            >
                              <strong>{item.title}</strong>
                              <span className="ls-muted">
                                {new Date(item.created_at).toLocaleString(
                                  'fr-FR'
                                )}
                              </span>
                            </div>
                            <p className="ls-muted">
                              Auteur : {item.author_name}
                            </p>
                            <p style={{ whiteSpace: 'pre-wrap' }}>
                              {item.body}
                            </p>
                            <button
                              style={styles.secondary}
                              onClick={() => deleteSuggestion(item.id)}
                            >
                              Supprimer
                            </button>
                          </article>
                        ))
                      )}
                    </>
                  )}
                </section>
                {isAdmin && (
                  <>
                    <h3>Paramètres des comptes traders</h3>
                    <p className="ls-muted">
                      Ce réglage est enregistré dans Supabase et s’applique aux
                      traders sur leurs appareils.
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 16,
                        padding: 16,
                        background: '#f5f8fb',
                        borderRadius: 12,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <strong>
                          Afficher les quantités exactes aux traders
                        </strong>
                        <div className="ls-muted" style={{ marginTop: 5 }}>
                          {showTraderQuantities
                            ? 'Les traders voient le nombre exact en stock.'
                            : 'Les traders voient « Disponible », « Proche rupture » ou « Rupture ».'}
                        </div>
                      </div>
                      <label
                        style={{
                          display: 'flex',
                          gap: 9,
                          alignItems: 'center',
                          fontWeight: 700,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={showTraderQuantities}
                          onChange={(event) =>
                            saveQuantitySetting(event.target.checked)
                          }
                        />{' '}
                        Quantités exactes
                      </label>
                    </div>
                    <section style={{ marginTop: 22 }}>
                      <h3>Permissions individuelles des comptes</h3>
                      <p className="ls-muted">
                        Activez séparément l’accès au tableau des stocks
                        négatifs et l’affichage des produits à quantité zéro ou
                        négative dans Europ Arina. Les changements sont
                        enregistrés dans Supabase.
                      </p>
                      <div className="ls-toolbar">
                        <button
                          style={styles.secondary}
                          onClick={loadAccountPermissions}
                          disabled={permissionsLoading}
                        >
                          {permissionsLoading
                            ? 'Chargement…'
                            : 'Actualiser les comptes'}
                        </button>
                      </div>
                      {permissionsMessage && (
                        <p
                          className="ls-message"
                          role="status"
                          aria-live="polite"
                        >
                          {permissionsMessage}
                        </p>
                      )}
                      {permissionsLoading ? (
                        <p>Chargement des comptes…</p>
                      ) : accountPermissions.filter(
                          (account) =>
                            String(account.role || '')
                              .trim()
                              .toLowerCase() !== 'admin'
                        ).length === 0 ? (
                        <p>Aucun compte trader ou viewer à afficher.</p>
                      ) : (
                        <div
                          className="ls-table-wrap"
                          style={{
                            display: 'block',
                            width: '100%',
                            minWidth: 0,
                            overflowX: 'auto',
                            visibility: 'visible',
                            opacity: 1,
                          }}
                        >
                          {' '}
                          <table className="ls-table">
                            <thead>
                              <tr>
                                <th style={styles.th}>Compte</th>
                                <th style={styles.th}>Rôle</th>
                                <th style={styles.th}>
                                  Tableau des stocks négatifs
                                </th>
                                <th style={styles.th}>
                                  Europ Arina : afficher quantité 0 ou négative
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {accountPermissions
                                .filter(
                                  (account) =>
                                    String(account.role || '')
                                      .trim()
                                      .toLowerCase() !== 'admin'
                                )
                                .map((account) => (
                                  <tr key={account.id}>
                                    <td style={styles.td}>
                                      <strong>
                                        {account.full_name || 'Utilisateur'}
                                      </strong>
                                      <div className="ls-muted">
                                        {account.is_active
                                          ? 'Compte actif'
                                          : 'Compte inactif'}
                                      </div>
                                    </td>
                                    <td style={styles.td}>{account.role}</td>
                                    <td style={styles.td}>
                                      <label
                                        style={{
                                          display: 'flex',
                                          gap: 8,
                                          alignItems: 'center',
                                        }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={Boolean(
                                            account.can_view_negative_stock
                                          )}
                                          disabled={
                                            permissionSavingId ===
                                            account.id +
                                              ':can_view_negative_stock'
                                          }
                                          onChange={(event) =>
                                            updateAccountPermission(
                                              account.id,
                                              'can_view_negative_stock',
                                              event.target.checked
                                            )
                                          }
                                        />
                                        Autoriser
                                      </label>
                                    </td>
                                    <td style={styles.td}>
                                      <label
                                        style={{
                                          display: 'flex',
                                          gap: 8,
                                          alignItems: 'center',
                                        }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={Boolean(
                                            account.can_view_zero_negative_products
                                          )}
                                          disabled={
                                            permissionSavingId ===
                                            account.id +
                                              ':can_view_zero_negative_products'
                                          }
                                          onChange={(event) =>
                                            updateAccountPermission(
                                              account.id,
                                              'can_view_zero_negative_products',
                                              event.target.checked
                                            )
                                          }
                                        />
                                        Autoriser
                                      </label>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </>
                )}
              </section>
            )}

            {!visibleNavItems.some((item) => item.id === activePage) && (
              <section className="ls-panel">
                <p>Cette page n’est pas disponible pour ce compte.</p>
                <button
                  style={styles.button}
                  onClick={() => navigateTo(isAdmin ? 'dashboard' : 'products')}
                >
                  Retour aux produits
                </button>
              </section>
            )}
            <div
              className="ls-muted"
              style={{ textAlign: 'center', marginTop: 24 }}
            >
              Linge Stock · Les données restent synchronisées avec Supabase.
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
