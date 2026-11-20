import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';

const FULL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre'];

function cleanText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function tokensFor(value) {
  const ignored = new Set(['bouti','chora','couverture','couvre','lit','tapis','drap','draps','plaid','plaide','pcs','piece','pieces','plc','uni','imp','avec','sans','pour','par','sur','les','des','ens']);
  return new Set(cleanText(value).split(/\s+/).filter(t => t.length >= 3 && !ignored.has(t) && !/^\d+$/.test(t)));
}
function trigrams(value) {
  const s = '  ' + cleanText(value) + '  ';
  const result = new Set();
  for (let i = 0; i < s.length - 2; i++) result.add(s.slice(i, i + 3));
  return result;
}
function readAll(table, select, orderColumn) {
  return (async () => {
    const rows = [];
    const size = 1000;
    for (let start = 0; ; start += size) {
      let query = supabase.from(table).select(select).range(start, start + size - 1);
      if (orderColumn) query = query.order(orderColumn);
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < size) break;
    }
    return rows;
  })();
}

export default function AIAnalysis() {
  const [module, setModule] = useState('LINGE');
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [showReference, setShowReference] = useState(true);
  const [sortState, setSortState] = useState({ key: '', direction: 'asc' });
  const [selectedRows, setSelectedRows] = useState([]);
  const [section, setSection] = useState('forecast');
  const [historyByModule, setHistoryByModule] = useState({ LINGE: [], TAPIS: [] });
  const [productsByModule, setProductsByModule] = useState({ LINGE: [], TAPIS: [] });
  const [suggestionsByModule, setSuggestionsByModule] = useState({ LINGE: [], TAPIS: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState({});
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [lingeHistory, tapisHistory, lingeProducts, tapisProducts, lingeSuggestions, tapisSuggestions] = await Promise.all([
          readAll('monthly_stock_history', 'product_ref,month_no,initial_quantity,entry_quantity,outgoing_quantity,final_quantity', 'product_ref'),
          readAll('tapis_monthly_stock_history', 'product_ref,month_no,initial_quantity,entry_quantity,outgoing_quantity,final_quantity', 'product_ref'),
          readAll('products', 'product_ref,name,current_quantity,retail_price,wholesale_price,is_active,is_hidden', 'product_ref'),
          readAll('tapis_products', 'product_ref,name,current_quantity,retail_price,wholesale_price,is_active,is_hidden', 'product_ref'),
          supabase.rpc('get_reorder_suggestions'),
          supabase.rpc('get_tapis_reorder_suggestions')
        ]);
        if (lingeSuggestions.error) throw lingeSuggestions.error;
        if (tapisSuggestions.error) throw tapisSuggestions.error;
        if (!alive) return;
        setHistoryByModule({ LINGE: lingeHistory || [], TAPIS: tapisHistory || [] });
        setProductsByModule({
          LINGE: (lingeProducts || []).filter(p => p.is_active !== false && p.is_hidden !== true),
          TAPIS: (tapisProducts || []).filter(p => p.is_active !== false && p.is_hidden !== true)
        });
        setSuggestionsByModule({ LINGE: lingeSuggestions.data || [], TAPIS: tapisSuggestions.data || [] });
      } catch (e) {
        if (alive) setError(e?.message || 'Erreur lors du chargement des données.');
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [reloadKey]);

  const rows = historyByModule[module] || [];
  const catalog = productsByModule[module] || [];
  const productMap = useMemo(() => new Map(catalog.map(p => [p.product_ref, p])), [catalog]);
  const historyByProduct = useMemo(() => {
    const map = new Map();
    rows.forEach(row => {
      if (!map.has(row.product_ref)) map.set(row.product_ref, []);
      map.get(row.product_ref).push(row);
    });
    map.forEach(items => items.sort((a,b) => Number(a.month_no)-Number(b.month_no)));
    return map;
  }, [rows]);

  const forecasts = suggestionsByModule[module] || [];

  const negativeCases = useMemo(() => {
    const cases = [];
    rows.forEach(h => {
      const qty = Number(h.outgoing_quantity) || 0;
      if (qty < 0) {
        const product = productMap.get(h.product_ref) || {};
        cases.push({ ...h, negative_quantity: qty, name: product.name || h.product_ref, retail_price: product.retail_price, wholesale_price: product.wholesale_price, current_quantity: product.current_quantity });
      }
    });
    return cases.sort((a,b) => Number(a.month_no)-Number(b.month_no));
  }, [rows, productMap]);

  const matches = useMemo(() => {
    const prepared = catalog.map(p => ({
      ...p,
      tokenSet: tokensFor(p.name),
      triSet: trigrams(p.name)
    }));
    const salesLookup = new Map(rows.map(h => [String(h.product_ref) + '|' + String(h.month_no), Number(h.outgoing_quantity) || 0]));
    const result = [];
    negativeCases.forEach(item => {
      const targetTokens = tokensFor(item.name);
      const targetTri = trigrams(item.name);
      const candidates = prepared.filter(p => p.product_ref !== item.product_ref).map(p => {
        let shared = 0;
        targetTokens.forEach(t => { if (p.tokenSet.has(t)) shared++; });
        const family = targetTokens.size + p.tokenSet.size - shared > 0
          ? 100 * shared / (targetTokens.size + p.tokenSet.size - shared) : 0;
        const nameScore = (() => { let common = 0; targetTri.forEach(t => { if (p.triSet.has(t)) common++; }); const union = targetTri.size + p.triSet.size - common; return union ? 100 * common / union : 0; })();
        const typeScore = cleanText(item.name).split(' ')[0] === cleanText(p.name).split(' ')[0] ? 100 : 0;
        const a = Number(item.retail_price), b = Number(p.retail_price);
        const priceScore = Number.isFinite(a) && Number.isFinite(b) && Math.max(Math.abs(a),Math.abs(b)) > 0
          ? 100 * Math.max(0, 1 - Math.abs(a-b) / Math.max(Math.abs(a),Math.abs(b))) : 0;
        const wa = Number(item.wholesale_price), wb = Number(p.wholesale_price);
        const wholesaleScore = Number.isFinite(wa) && Number.isFinite(wb) && Math.max(Math.abs(wa),Math.abs(wb)) > 0
          ? 100 * Math.max(0, 1 - Math.abs(wa-wb) / Math.max(Math.abs(wa),Math.abs(wb))) : 0;
        const monthSales = salesLookup.get(String(p.product_ref) + '|' + String(item.month_no)) ?? 0;
        const salesScore = monthSales > 0 ? 100 : 0;
        const score = typeScore * 0.10 + family * 0.45 + nameScore * 0.20 + priceScore * 0.15 + wholesaleScore * 0.05 + salesScore * 0.05;
        return { ...p, typeScore, familyScore: family, nameScore, priceScore, wholesaleScore, monthSales, score };
      }).sort((a,b) => b.score-a.score).slice(0,5);
      result.push({ ...item, candidates });
    });
    return result;
  }, [catalog, rows, negativeCases]);

  const stopped = useMemo(() => {
    return catalog.map(p => {
      const history = historyByProduct.get(p.product_ref) || [];
      const monthly = new Map(history.filter(h => FULL_MONTHS.includes(Number(h.month_no))).map(h => [Number(h.month_no), Number(h.outgoing_quantity) || 0]));
      const lastSaleMonth = FULL_MONTHS.filter(m => (monthly.get(m) || 0) > 0).slice(-1)[0] || 0;
      if (!lastSaleMonth) return null;
      const gap = 10 - lastSaleMonth;
      const prior = [5,6,7,8].map(m => monthly.get(m) || 0);
      const recent = [9,10].map(m => monthly.get(m) || 0);
      const priorAvg = prior.reduce((s,v)=>s+v,0)/prior.length;
      const recentAvg = recent.reduce((s,v)=>s+v,0)/recent.length;
      const stock = Number(p.current_quantity) || 0;
      const decline = priorAvg > 0 && recentAvg < priorAvg * 0.5;
      if (gap < 2 && !decline) return null;
      return { ...p, lastSaleMonth, gap, priorAvg, recentAvg, stock, status: stock > 0 ? 'Arrêt avec stock disponible' : 'Arrêt avec rupture de stock', decline };
    }).filter(Boolean).sort((a,b) => b.gap-a.gap || a.recentAvg-b.recentAvg);
  }, [catalog, historyByProduct]);

  const filteredForecasts = forecasts.filter(p => cleanText(p.name + ' ' + p.product_ref).includes(cleanText(search)));
  const filteredNegatives = matches.filter(p => cleanText(p.name + ' ' + p.product_ref).includes(cleanText(search)));
  const filteredStopped = stopped.filter(p => cleanText(p.name + ' ' + p.product_ref).includes(cleanText(search)));

  const panel = { background: 'var(--ls-card, #fff)', color: 'var(--ls-text, #102b46)', border: '1px solid var(--ls-border, #e2e8f0)', borderRadius: 14, padding: 16, minWidth: 0 };
  const button = { border: '1px solid var(--ls-border, #d5dfeb)', borderRadius: 9, padding: '8px 12px', background: 'var(--ls-card-soft, #fff)', color: 'var(--ls-text, #102b46)', cursor: 'pointer', fontWeight: 700 };
  const activeButton = { ...button, background: 'var(--ls-primary, #0E5E6F)', color: '#fff', borderColor: 'var(--ls-primary, #0E5E6F)' };
  const th = { textAlign: 'left', padding: '10px 9px', background: 'var(--ls-table-head, #f1f5f9)', color: 'var(--ls-text-muted, #526477)', fontSize: 12, whiteSpace: 'nowrap' };
  const td = { padding: '10px 9px', borderTop: '1px solid var(--ls-table-line, #edf1f5)', verticalAlign: 'top', fontSize: 13, color: 'var(--ls-text, #102b46)' };
  const visibleFeedback = Object.entries(feedback);
  async function copyFeedback() {
    const text = visibleFeedback.map(([key,value]) => key + ': ' + value).join('\n') + (note ? '\nملاحظات: ' + note : '');
    if (!text.trim()) return;
    try { await navigator.clipboard.writeText(text); window.alert('تم نسخ تقييماتك. أرسلها هنا للمراجعة؛ لم يتم حفظها في قاعدة البيانات.'); }
    catch { window.prompt('انسخ التقييمات:', text); }
  }

  return (
    <section className="ls-panel">
      <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',alignItems:'flex-start'}}>
        <div>
          <h2 style={{marginTop:0,marginBottom:6}}>Analyse intelligente</h2>
          <p className="ls-muted" style={{margin:0}}>Lecture et analyse uniquement. Aucune écriture ni modification de la base de données.</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><span style={{background:'var(--ls-card-soft, #F5F1E7)',color:'var(--ls-text, #027a48)',padding:'6px 10px',borderRadius:20,fontSize:12,fontWeight:800}}>LECTURE SEULE · READ ONLY</span><button style={button} onClick={()=>setReloadKey(v=>v+1)} disabled={loading}>Actualiser</button></div>
      </div>

      <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'16px 0'}}>
        <button style={module==='LINGE'?activeButton:button} onClick={()=>{setModule('LINGE');setSearch('');}}>Linge</button>
        <button style={module==='TAPIS'?activeButton:button} onClick={()=>{setModule('TAPIS');setSearch('');}}>Tapis</button>
      </div>

      {loading ? <p>Chargement des données historiques…</p> : error ? <p role="alert" style={{color:'#b42318'}}>Impossible de charger l’analyse : {error}</p> : <>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:10,marginBottom:16}}>
          <div style={panel}><div className="ls-muted">Produits analysés</div><strong style={{fontSize:26}}>{catalog.length.toLocaleString('fr-FR')}</strong></div>
          <div style={panel}><div className="ls-muted">Ventes négatives</div><strong style={{fontSize:26}}>{negativeCases.length.toLocaleString('fr-FR')}</strong></div>
          <div style={panel}><div className="ls-muted">Arrêt / baisse des ventes</div><strong style={{fontSize:26}}>{stopped.length.toLocaleString('fr-FR')}</strong></div>
          <div style={panel}><div className="ls-muted">Période de prévision</div><strong style={{fontSize:18}}>6 mois complets</strong><small className="ls-muted" style={{display:'block'}}>Janvier à octobre 2026 ; novembre incomplet</small></div>
        </div>

        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
          <button style={section==='forecast'?activeButton:button} onClick={()=>setSection('forecast')}>Prévision de la demande</button>
          <button style={section==='negative'?activeButton:button} onClick={()=>setSection('negative')}>Ventes négatives et rapprochement</button>
          <button style={section==='stopped'?activeButton:button} onClick={()=>setSection('stopped')}>Arrêt / baisse des ventes</button>
        </div>
        <div className="ls-toolbar" style={{flexWrap:'wrap',marginBottom:10}}>
          <label className="ls-muted">Lignes par page <select value={rowsPerPage} onChange={e=>setRowsPerPage(Number(e.target.value))} style={{width:'auto'}}>{[10,20,100].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
          <label className="ls-muted"><input type="checkbox" checked={showReference} onChange={e=>setShowReference(e.target.checked)}/> Afficher référence</label>
          <button type="button" onClick={()=>setSelectedRows([])}>Désélectionner</button>
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher par référence ou désignation…" style={{width:'100%',maxWidth:420,boxSizing:'border-box',padding:'10px 12px',border:'1px solid var(--ls-border, #d5dfeb)',borderRadius:9,marginBottom:12}} />

        {section==='forecast' && <>
          <p className="ls-muted">Suggestions de réapprovisionnement actuelles de l’application, calculées par les fonctions existantes sans modification. Consultation uniquement : aucune commande ni modification du stock.</p>
          <div style={{overflowX:'auto'}}><table className="ls-table" style={{width:'100%'}}><thead><tr>{['Désignation','Référence','Stock actuel','Baisse moyenne / jour','Jours restants','Quantité suggérée','Date de dernière lecture'].map(x=><th key={x} style={th}>{x}</th>)}</tr></thead><tbody>
            {filteredForecasts.slice(0,300).map((p,i)=><tr key={p.id || p.product_ref || i}><td style={td}>{p.name || '—'}</td><td style={td}>{p.product_ref || '—'}</td><td style={td}>{p.current_quantity ?? '—'}</td><td style={td}>{p.average_daily_decrease == null ? '—' : Number(p.average_daily_decrease).toFixed(2)}</td><td style={td}>{p.days_remaining == null ? '—' : Number(p.days_remaining).toFixed(1)}</td><td style={td}><strong>{p.suggested_order_quantity ?? '—'}</strong></td><td style={td}>{p.last_snapshot_date || '—'}</td></tr>)}
          </tbody></table></div>
          <p className="ls-muted">Affichage {Math.min(filteredForecasts.length,300)} sur {filteredForecasts.length} suggestions.</p>
        </>}

        {section==='negative' && <>
          <p className="ls-muted">Chaque cas présente les 5 meilleurs candidats de la même base. Le classement est expérimental et ne confirme pas automatiquement une correspondance.</p>
          <div style={{display:'grid',gap:12}}>
            {filteredNegatives.slice(0,100).map((item,idx)=><article key={item.product_ref+'-'+item.month_no+'-'+idx} style={panel}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}>
                <strong>{item.name} <span className="ls-muted">({item.product_ref})</span></strong>
                <span style={{color:'var(--ls-accent, #D9622B)',fontWeight:800}}>{item.negative_quantity} · {MONTH_NAMES[Number(item.month_no)-1] || ('Mois '+item.month_no)}</span>
              </div>
              <div style={{overflowX:'auto',marginTop:8}}><table className="ls-table" style={{width:'100%'}}><thead><tr>{['Candidat','Référence','Score /100','Prix de détail','Ventes du même mois','Stock actuel','Votre évaluation'].map(x=><th key={x} style={th}>{x}</th>)}</tr></thead><tbody>
                {item.candidates.map(c=>{const key=module+':'+item.product_ref+':'+item.month_no+':'+c.product_ref;return <tr key={c.product_ref}><td style={td}>{c.name}</td><td style={td}>{c.product_ref}</td><td style={td}>{c.score.toFixed(1)}/100</td><td style={td}>{c.retail_price ?? '—'}</td><td style={td}>{c.monthSales}</td><td style={td}>{c.current_quantity ?? '—'}</td><td style={td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{...button,padding:'5px 8px',fontSize:11}} onClick={()=>setFeedback(v=>({...v,[key]:'مرشح Correct'}))}>Correct</button><button style={{...button,padding:'5px 8px',fontSize:11}} onClick={()=>setFeedback(v=>({...v,[key]:'غير Correct'}))}>Incorrect</button>{feedback[key]&&<small>{feedback[key]}</small>}</div></td></tr>;})}
              </tbody></table></div>
            </article>)}
          </div>
          <p className="ls-muted">Affichage {Math.min(filteredNegatives.length,100)} sur {filteredNegatives.length} cas.</p>
        </>}

        {section==='stopped' && <>
          <p className="ls-muted">La détection utilise le dernier mois complet (octobre 2026) et compare les deux derniers mois aux quatre mois précédents. Le stock actuel est un indicateur, pas une preuve de la cause de l’arrêt.</p>
          <div style={{overflowX:'auto'}}><table className="ls-table" style={{width:'100%'}}><thead><tr>{['Désignation','Référence','Dernier mois de vente','Durée d’arrêt','Stock actuel','Moyenne précédente','Moyenne récente','Statut'].map(x=><th key={x} style={th}>{x}</th>)}</tr></thead><tbody>
            {filteredStopped.slice(0,300).map(p=><tr key={p.product_ref}><td style={td}>{p.name}</td><td style={td}>{p.product_ref}</td><td style={td}>{MONTH_NAMES[p.lastSaleMonth-1]}</td><td style={td}>{p.gap} Mois</td><td style={td}>{p.stock}</td><td style={td}>{p.priorAvg.toFixed(1)}</td><td style={td}>{p.recentAvg.toFixed(1)}</td><td style={td}>{p.status}{p.decline?' · Baisse notable':''}</td></tr>)}
          </tbody></table></div>
          <p className="ls-muted">Affichage {Math.min(filteredStopped.length,300)} sur {filteredStopped.length} produits.</p>
        </>}
        <div style={{...panel,marginTop:18}}>
          <strong>Évaluation des résultats — non enregistrée dans la base</strong>
          <p className="ls-muted" style={{margin:'5px 0 10px'}}>Vos choix restent temporaires pendant l’ouverture de la page. Copiez-les et envoyez-les pour examiner la précision.</p>
          <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Vos remarques sur les résultats…" rows={3} style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid var(--ls-border, #d5dfeb)',borderRadius:9,marginBottom:8}} />
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><button style={activeButton} onClick={copyFeedback}>Copier les évaluations et remarques</button><span className="ls-muted">{visibleFeedback.length} évaluation(s) temporaire(s)</span></div>
        </div>
      </>}
    </section>
  );
}
