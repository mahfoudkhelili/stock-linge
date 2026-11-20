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
function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  a.forEach(x => { if (b.has(x)) common++; });
  return 200 * common / (a.size + b.size);
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
  const [section, setSection] = useState('forecast');
  const [historyByModule, setHistoryByModule] = useState({ LINGE: [], TAPIS: [] });
  const [productsByModule, setProductsByModule] = useState({ LINGE: [], TAPIS: [] });
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
        const [lingeHistory, tapisHistory, lingeProducts, tapisProducts] = await Promise.all([
          readAll('monthly_stock_history', 'product_ref,month_no,initial_quantity,entry_quantity,outgoing_quantity,final_quantity', 'product_ref'),
          readAll('tapis_monthly_stock_history', 'product_ref,month_no,initial_quantity,entry_quantity,outgoing_quantity,final_quantity', 'product_ref'),
          readAll('products', 'product_ref,name,current_quantity,retail_price,wholesale_price,is_active,is_hidden', 'product_ref'),
          readAll('tapis_products', 'product_ref,name,current_quantity,retail_price,wholesale_price,is_active,is_hidden', 'product_ref')
        ]);
        if (!alive) return;
        setHistoryByModule({ LINGE: lingeHistory || [], TAPIS: tapisHistory || [] });
        setProductsByModule({
          LINGE: (lingeProducts || []).filter(p => p.is_active !== false && p.is_hidden !== true),
          TAPIS: (tapisProducts || []).filter(p => p.is_active !== false && p.is_hidden !== true)
        });
      } catch (e) {
        if (alive) setError(e?.message || 'Erreur lors du chargement des données.');
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, []);

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

  const forecasts = useMemo(() => {
    return catalog.map(p => {
      const history = historyByProduct.get(p.product_ref) || [];
      const byMonth = new Map(history.filter(h => FULL_MONTHS.includes(Number(h.month_no))).map(h => [Number(h.month_no), Number(h.outgoing_quantity) || 0]));
      const values = [5,6,7,8,9,10].map(m => byMonth.get(m) || 0);
      const net = values.reduce((sum, n) => sum + n, 0);
      const forecast = Math.max(0, net / values.length);
      const activeMonths = values.filter(v => v > 0).length;
      const availableMonths = history.filter(h => FULL_MONTHS.includes(Number(h.month_no))).length;
      const confidence = availableMonths < 4 ? 'بيانات قليلة' : activeMonths >= 4 ? 'أفضل نسبياً' : activeMonths >= 2 ? 'متوسط' : 'ضعيف';
      return { ...p, forecast, net, activeMonths, availableMonths, current: Number(p.current_quantity) || 0, confidence };
    }).filter(p => p.availableMonths > 0).sort((a,b) => b.forecast-a.forecast);
  }, [catalog, historyByProduct]);

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
        const nameScore = dice(targetTri, p.triSet);
        const a = Number(item.retail_price), b = Number(p.retail_price);
        const priceScore = Number.isFinite(a) && Number.isFinite(b) && Math.max(Math.abs(a),Math.abs(b)) > 0
          ? 100 * Math.max(0, 1 - Math.abs(a-b) / Math.max(Math.abs(a),Math.abs(b))) : 0;
        const monthSales = salesLookup.get(String(p.product_ref) + '|' + String(item.month_no)) ?? 0;
        const score = family * 0.50 + nameScore * 0.25 + priceScore * 0.15 + (monthSales > 0 ? 100 : 0) * 0.10 - (monthSales < 0 ? 8 : 0);
        return { ...p, familyScore: family, nameScore, priceScore, monthSales, score };
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
      return { ...p, lastSaleMonth, gap, priorAvg, recentAvg, stock, status: stock > 0 ? 'توقف مع توفر المخزون' : 'توقف مع نفاد المخزون', decline };
    }).filter(Boolean).sort((a,b) => b.gap-a.gap || a.recentAvg-b.recentAvg);
  }, [catalog, historyByProduct]);

  const filteredForecasts = forecasts.filter(p => cleanText(p.name + ' ' + p.product_ref).includes(cleanText(search)));
  const filteredNegatives = matches.filter(p => cleanText(p.name + ' ' + p.product_ref).includes(cleanText(search)));
  const filteredStopped = stopped.filter(p => cleanText(p.name + ' ' + p.product_ref).includes(cleanText(search)));

  const panel = { background: 'var(--ls-card, #fff)', border: '1px solid var(--ls-border, #e2e8f0)', borderRadius: 14, padding: 16, minWidth: 0 };
  const button = { border: '1px solid #d5dfeb', borderRadius: 9, padding: '8px 12px', background: '#fff', color: '#102b46', cursor: 'pointer', fontWeight: 700 };
  const activeButton = { ...button, background: '#102b46', color: '#fff', borderColor: '#102b46' };
  const th = { textAlign: 'left', padding: '10px 9px', background: '#f1f5f9', color: '#526477', fontSize: 12, whiteSpace: 'nowrap' };
  const td = { padding: '10px 9px', borderTop: '1px solid #edf1f5', verticalAlign: 'top', fontSize: 13 };
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
          <h2 style={{marginTop:0,marginBottom:6}}>التحليل الذكي</h2>
          <p className="ls-muted" style={{margin:0}}>قراءة وتحليل فقط. لا توجد أي عملية كتابة أو تعديل في قاعدة البيانات.</p>
        </div>
        <span style={{background:'#ecfdf3',color:'#027a48',padding:'6px 10px',borderRadius:20,fontSize:12,fontWeight:800}}>READ ONLY · قراءة فقط</span>
      </div>

      <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'16px 0'}}>
        <button style={module==='LINGE'?activeButton:button} onClick={()=>{setModule('LINGE');setSearch('');}}>Linge</button>
        <button style={module==='TAPIS'?activeButton:button} onClick={()=>{setModule('TAPIS');setSearch('');}}>Tapis</button>
      </div>

      {loading ? <p>جاري قراءة البيانات التاريخية…</p> : error ? <p role="alert" style={{color:'#b42318'}}>تعذر تحميل التحليل: {error}</p> : <>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:10,marginBottom:16}}>
          <div style={panel}><div className="ls-muted">المنتجات المحللة</div><strong style={{fontSize:26}}>{catalog.length.toLocaleString('fr-FR')}</strong></div>
          <div style={panel}><div className="ls-muted">حالات المبيعات السالبة</div><strong style={{fontSize:26}}>{negativeCases.length.toLocaleString('fr-FR')}</strong></div>
          <div style={panel}><div className="ls-muted">توقف / تراجع المبيعات</div><strong style={{fontSize:26}}>{stopped.length.toLocaleString('fr-FR')}</strong></div>
          <div style={panel}><div className="ls-muted">فترة التوقع</div><strong style={{fontSize:18}}>6 أشهر مكتملة</strong><small className="ls-muted" style={{display:'block'}}>جانفي إلى أكتوبر 2026؛ نوفمبر غير مكتمل</small></div>
        </div>

        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
          <button style={section==='forecast'?activeButton:button} onClick={()=>setSection('forecast')}>التنبؤ بالطلب</button>
          <button style={section==='negative'?activeButton:button} onClick={()=>setSection('negative')}>المبيعات السالبة والمطابقة</button>
          <button style={section==='stopped'?activeButton:button} onClick={()=>setSection('stopped')}>توقف / تراجع المبيعات</button>
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث بالمرجع أو اسم المنتج…" style={{width:'100%',maxWidth:420,boxSizing:'border-box',padding:'10px 12px',border:'1px solid #d5dfeb',borderRadius:9,marginBottom:12}} />

        {section==='forecast' && <>
          <p className="ls-muted">تقدير تجريبي للطلب الشهري اعتماداً على صافي الخروج خلال آخر 6 أشهر مكتملة. هذا عرض تحليلي وليس أمراً بالشراء أو تعديلاً للمخزون.</p>
          <div style={{overflowX:'auto'}}><table className="ls-table" style={{width:'100%'}}><thead><tr>{['المنتج','المرجع','المخزون الحالي','متوسط الطلب الشهري','أشهر بها مبيعات','جودة البيانات'].map(x=><th key={x} style={th}>{x}</th>)}</tr></thead><tbody>
            {filteredForecasts.slice(0,300).map(p=><tr key={p.product_ref}><td style={td}>{p.name}</td><td style={td}>{p.product_ref}</td><td style={td}>{p.current}</td><td style={td}><strong>{p.forecast.toFixed(1)}</strong></td><td style={td}>{p.activeMonths}/6</td><td style={td}>{p.confidence}</td></tr>)}
          </tbody></table></div>
          <p className="ls-muted">عرض {Math.min(filteredForecasts.length,300)} من {filteredForecasts.length} منتجاً.</p>
        </>}

        {section==='negative' && <>
          <p className="ls-muted">كل حالة تعرض أفضل 5 مرشحين داخل نفس قاعدة البيانات. الترتيب تجريبي، ولا يعني أن المرشح صحيح تلقائياً.</p>
          <div style={{display:'grid',gap:12}}>
            {filteredNegatives.slice(0,100).map((item,idx)=><article key={item.product_ref+'-'+item.month_no+'-'+idx} style={panel}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}>
                <strong>{item.name} <span className="ls-muted">({item.product_ref})</span></strong>
                <span style={{color:'#b42318',fontWeight:800}}>{item.negative_quantity} · {MONTH_NAMES[Number(item.month_no)-1] || ('شهر '+item.month_no)}</span>
              </div>
              <div style={{overflowX:'auto',marginTop:8}}><table className="ls-table" style={{width:'100%'}}><thead><tr>{['المرشح','المرجع','التشابه','سعر التجزئة','مبيعاته في نفس الشهر','تقييمك'].map(x=><th key={x} style={th}>{x}</th>)}</tr></thead><tbody>
                {item.candidates.map(c=>{const key=module+':'+item.product_ref+':'+item.month_no+':'+c.product_ref;return <tr key={c.product_ref}><td style={td}>{c.name}</td><td style={td}>{c.product_ref}</td><td style={td}>{c.score.toFixed(1)}/100</td><td style={td}>{c.retail_price ?? '—'}</td><td style={td}>{c.monthSales}</td><td style={td}><div style={{display:'flex',gap:5,flexWrap:'wrap'}}><button style={{...button,padding:'5px 8px',fontSize:11}} onClick={()=>setFeedback(v=>({...v,[key]:'مرشح صحيح'}))}>صحيح</button><button style={{...button,padding:'5px 8px',fontSize:11}} onClick={()=>setFeedback(v=>({...v,[key]:'غير صحيح'}))}>خطأ</button>{feedback[key]&&<small>{feedback[key]}</small>}</div></td></tr>;})}
              </tbody></table></div>
            </article>)}
          </div>
          <p className="ls-muted">عرض {Math.min(filteredNegatives.length,100)} من {filteredNegatives.length} حالة.</p>
        </>}

        {section==='stopped' && <>
          <p className="ls-muted">يعتمد الكشف على آخر شهر كامل (أكتوبر 2026)، ويقارن آخر شهرين بالأشهر الأربعة السابقة. المخزون الحالي مؤشر فقط، وليس دليلاً نهائياً على سبب التوقف.</p>
          <div style={{overflowX:'auto'}}><table className="ls-table" style={{width:'100%'}}><thead><tr>{['المنتج','المرجع','آخر شهر بيع','مدة التوقف','المخزون الحالي','متوسط سابق','متوسط حديث','الحالة'].map(x=><th key={x} style={th}>{x}</th>)}</tr></thead><tbody>
            {filteredStopped.slice(0,300).map(p=><tr key={p.product_ref}><td style={td}>{p.name}</td><td style={td}>{p.product_ref}</td><td style={td}>{MONTH_NAMES[p.lastSaleMonth-1]}</td><td style={td}>{p.gap} شهر</td><td style={td}>{p.stock}</td><td style={td}>{p.priorAvg.toFixed(1)}</td><td style={td}>{p.recentAvg.toFixed(1)}</td><td style={td}>{p.status}{p.decline?' · تراجع واضح':''}</td></tr>)}
          </tbody></table></div>
          <p className="ls-muted">عرض {Math.min(filteredStopped.length,300)} من {filteredStopped.length} منتجاً.</p>
        </>}
        <div style={{...panel,marginTop:18}}>
          <strong>تقييم النتائج — لا يُحفظ في قاعدة البيانات</strong>
          <p className="ls-muted" style={{margin:'5px 0 10px'}}>اختياراتك تبقى مؤقتة أثناء فتح الصفحة. انسخها وأرسلها لي لاحقاً حتى نراجع الدقة.</p>
          <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="ملاحظاتك على النتائج…" rows={3} style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #d5dfeb',borderRadius:9,marginBottom:8}} />
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><button style={activeButton} onClick={copyFeedback}>نسخ التقييمات والملاحظات</button><span className="ls-muted">{visibleFeedback.length} تقييم مؤقت</span></div>
        </div>
      </>}
    </section>
  );
}
