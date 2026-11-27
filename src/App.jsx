import { useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
import { supabase } from './supabase';
import AIAnalysis from './AIAnalysis';

function normalizeProductSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function productMatchesSearch(product, query) {
  const normalizedQuery = normalizeProductSearch(query);
  if (!normalizedQuery) return true;
  const searchableText = normalizeProductSearch(String(product?.name || '') + ' ' + String(product?.product_ref || '') + ' ' + String(product?.reference_1 || ''));
  const words = searchableText.split(/\s+/).filter(Boolean);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  // Every typed token may match the beginning of any word, in any order.
  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}


function ClearableSearchInput({ value, onChange, style, className, placeholder, 'aria-label': ariaLabel, onKeyDown, type = 'text' }) {
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: style?.width || '100%', minWidth: 0 }}>
      <input
        type={type}
        className={className}
        style={{ ...style, width: '100%', paddingRight: 38, boxSizing: 'border-box' }}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      {String(value || '').length > 0 && (
        <button
          type="button"
          aria-label="Effacer la recherche"
          title="Effacer"
          onClick={() => onChange({ target: { value: '' } })}
          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 26, height: 26, padding: 0, border: 0, borderRadius: '50%', background: 'transparent', color: '#64748b', fontSize: 20, lineHeight: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >×</button>
      )}
    </div>
  );
}


function makeReferenceQrDataUrl(value) {
  const text = String(value || '').trim();
  if (!/^\d{1,41}$/.test(text)) throw new Error('REFERENCE 1 doit contenir uniquement des chiffres (1 à 41).');
  const bits = [], pushBits = (number,length) => { for(let i=length-1;i>=0;i--) bits.push((number>>>i)&1); };
  pushBits(1,4); pushBits(text.length,10); let pos=0;
  while(pos+3<=text.length){pushBits(Number(text.slice(pos,pos+3)),10);pos+=3;}
  if(text.length-pos===2)pushBits(Number(text.slice(pos)),7); else if(text.length-pos===1)pushBits(Number(text.slice(pos)),4);
  for(let i=0;i<Math.min(4,152-bits.length);i++)bits.push(0); while(bits.length%8)bits.push(0);
  const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((n,b)=>(n<<1)|b,0));
  for(let pad=0;data.length<19;pad++)data.push(pad%2===0?0xEC:0x11);
  const mul=(x,y)=>{let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11D);if((y>>>i)&1)z^=x;}return z;};
  const pow=n=>{let v=1;for(let i=0;i<n;i++)v=mul(v,2);return v;};
  let gen=[1];for(let i=0;i<7;i++){const next=Array(gen.length+1).fill(0);gen.forEach((c,j)=>{next[j]^=c;next[j+1]^=mul(c,pow(i));});gen=next;}
  const rem=data.concat(Array(7).fill(0));for(let i=0;i<19;i++){const factor=rem[i];if(factor)for(let j=0;j<gen.length;j++)rem[i+j]^=mul(gen[j],factor);}
  const stream=data.concat(rem.slice(19)).flatMap(byte=>Array.from({length:8},(_,i)=>(byte>>>(7-i))&1));
  const size=21,matrix=Array.from({length:size},()=>Array(size).fill(null)),reserved=Array.from({length:size},()=>Array(size).fill(false));
  const set=(r,c,v)=>{if(r>=0&&r<size&&c>=0&&c<size){matrix[r][c]=v?1:0;reserved[r][c]=true;}};
  const finder=(top,left)=>{for(let dy=-1;dy<=7;dy++)for(let dx=-1;dx<=7;dx++){const r=top+dy,c=left+dx,inside=dy>=0&&dy<=6&&dx>=0&&dx<=6;set(r,c,inside&&(dy===0||dy===6||dx===0||dx===6||(dy>=2&&dy<=4&&dx>=2&&dx<=4)));}};
  finder(0,0);finder(0,14);finder(14,0);for(let i=8;i<=12;i++){set(6,i,i%2===0);set(i,6,i%2===0);}
  const fd=8;let fr=fd<<10;for(let b=14;b>=10;b--)if((fr>>>b)&1)fr^=0x537<<(b-10);
  const format=((fd<<10)|fr)^0x5412,fb=i=>((format>>>i)&1)!==0;
  for(let i=0;i<=5;i++)set(i,8,fb(i));set(7,8,fb(6));set(8,8,fb(7));set(8,7,fb(8));for(let i=9;i<15;i++)set(8,14-i,fb(i));
  for(let i=0;i<8;i++)set(8,size-1-i,fb(i));for(let i=8;i<15;i++)set(size-15+i,8,fb(i));set(size-8,8,true);
  let bit=0,up=true;for(let right=size-1;right>=1;right-=2){if(right===6)right--;for(let step=0;step<size;step++){const row=up?size-1-step:step;for(let off=0;off<2;off++){const col=right-off;if(!reserved[row][col]){const raw=bit<stream.length?stream[bit++]:0;matrix[row][col]=raw^(((row+col)%2===0)?1:0);}}}up=!up;}
  const quiet=4,scale=6,canvas=document.createElement('canvas');canvas.width=canvas.height=(size+quiet*2)*scale;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#000';
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(matrix[r][c])ctx.fillRect((c+quiet)*scale,(r+quiet)*scale,scale,scale);
  return canvas.toDataURL('image/png');
}

function DashboardIcon({ name, className = '' }) {
  const paths = {
    products: <><path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z"/><path d="M4 12l8 4.5 8-4.5M4 16.5 12 21l8-4.5"/></>,
    analysis: <><path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 5-6"/><path d="M16 7h3v3"/></>,
    requests: <><path d="M7 4h10l3 3v13H4V4h3Z"/><path d="M8 10h8M8 14h8M8 18h5"/></>,
    photos: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 17 5-4 3 3 3-3 5 4"/></>,
    arina: <><path d="M4 7h16M4 17h16"/><path d="M6 7v10M18 7v10M4 12h16"/></>,
    textiles: <><path d="M4 4h16M6 4v16M18 4v16M6 8c3 2 3 2 6 0s3-2 6 0M6 13c3 2 3 2 6 0s3-2 6 0"/></>,
    sales: <><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/></>,
    labels: <><path d="m4 11 7-7h8v8l-7 7-8-8Z"/><circle cx="15" cy="8" r="1"/></>
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.products}</svg>;
}


function MosqueSimulation({ tapisProducts = [] }) {
  const [roomLength, setRoomLength] = useState('20');
  const [roomWidth, setRoomWidth] = useState('12');
  const [roomMode,setRoomMode]=useState(null);
  const [irregularStage,setIrregularStage]=useState('draw');
  const [irregularPoints,setIrregularPoints]=useState([]);
  const [irregularClosed,setIrregularClosed]=useState(false);
  const [irregularLengths,setIrregularLengths]=useState([]);
  const [irregularSolved,setIrregularSolved]=useState(null);
  const [irregularSolveError,setIrregularSolveError]=useState('');
  const [irregularAngle,setIrregularAngle]=useState(0);
  const [irregularDragging,setIrregularDragging]=useState(false);
  const [irregularVertexDragging,setIrregularVertexDragging]=useState(null);
  const [costCarpetId,setCostCarpetId]=useState('');
  const [manualPurchaseArea,setManualPurchaseArea]=useState('');
  const [includeFeutre,setIncludeFeutre]=useState(false);
  const [feutreUnitPrice,setFeutreUnitPrice]=useState('');
  const [includePose,setIncludePose]=useState(false);
  const [poseUnitPrice,setPoseUnitPrice]=useState('');
  const irregularAngleSnapRef=useRef({});
  const irregularDrawRef=useRef(null);
  const irregularPlanRef=useRef(null);
  const [angle, setAngle] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [rowChoice, setRowChoice] = useState(null);
  const [dragging, setDragging] = useState(false);
  const planRef = useRef(null);
  const lastSnapRef = useRef(null);
  const rollWidth = 1.33;
  const styles = {
    field:{width:'100%',padding:'11px 12px',border:'1px solid var(--ls-border,#cbd5e1)',borderRadius:9,background:'var(--ls-card,#fff)',color:'var(--ls-text,inherit)',fontSize:16,boxSizing:'border-box'},
    button:{border:0,borderRadius:9,padding:'11px 16px',background:'#607A9B',color:'#fff',fontWeight:700,cursor:'pointer'},
    secondary:{border:'1px solid var(--ls-border,#cbd5e1)',borderRadius:9,padding:'10px 14px',background:'var(--ls-card,#fff)',color:'var(--ls-text,inherit)',cursor:'pointer'}
  };
  const L=Number(roomLength), W=Number(roomWidth);
  const valid=Number.isFinite(L)&&Number.isFinite(W)&&L>0&&W>0&&L<=500&&W<=500;
  const rad=angle*Math.PI/180;
  // Room coordinates remain fixed. Only the Qibla arrow and carpet rows rotate.
  const roomCorners=valid?[[-L/2,-W/2],[L/2,-W/2],[L/2,W/2],[-L/2,W/2]]:[];
  // u is perpendicular to Qibla (along each carpet row); v is along Qibla (row-to-row direction).
  const toLocal=([x,y])=>[-x*Math.sin(rad)+y*Math.cos(rad),x*Math.cos(rad)+y*Math.sin(rad)];
  const toRoom=([u,v])=>[v*Math.cos(rad)-u*Math.sin(rad),v*Math.sin(rad)+u*Math.cos(rad)];
  const localCorners=roomCorners.map(toLocal);
  const minV=localCorners.length?Math.min(...localCorners.map(p=>p[1])):0;
  const maxV=localCorners.length?Math.max(...localCorners.map(p=>p[1])):0;
  const minU=localCorners.length?Math.min(...localCorners.map(p=>p[0])):0;
  const maxU=localCorners.length?Math.max(...localCorners.map(p=>p[0])):0;
  const across=maxV-minV;
  const fullRows=Math.floor((across+1e-8)/rollWidth);
  const remainder=Math.max(0,across-fullRows*rollWidth);
  const ceilRows=Math.ceil((across-1e-8)/rollWidth);
  const clipAt=(poly,boundary,keepGreater)=>{
    const out=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length];
      const ina=keepGreater?a[1]>=boundary-1e-9:a[1]<=boundary+1e-9;
      const inb=keepGreater?b[1]>=boundary-1e-9:b[1]<=boundary+1e-9;
      if(ina)out.push(a);
      if(ina!==inb){const t=(boundary-a[1])/(b[1]-a[1]);out.push([a[0]+t*(b[0]-a[0]),boundary]);}
    }
    return out;
  };
  const bandLength=(lo,hi)=>{
    let p=clipAt(localCorners,lo,true);if(p.length)p=clipAt(p,hi,false);
    if(p.length<2)return 0;
    return Math.max(...p.map(x=>x[0]))-Math.min(...p.map(x=>x[0]));
  };
  const calculate=(rows)=>{
    // Start at the Qibla-facing wall (maximum projection along the Qibla arrow).
    const bands=Array.from({length:rows},(_,i)=>{
      const hi=maxV-i*rollWidth;
      const lo=Math.max(minV,hi-rollWidth);
      return {lo,hi,width:Math.max(0,hi-lo)};
    });
    const widths=bands.map(band=>band.width);
    const lengths=bands.map(band=>bandLength(band.lo,band.hi));
    const total=lengths.reduce((a,b)=>a+b,0);
    const coveredArea=lengths.reduce((sum,length,i)=>sum+length*widths[i],0);
    return {lengths,widths,total,purchasedArea:total*rollWidth,coveredArea,bands};
  };
  const lower=calculate(fullRows),upper=calculate(ceilRows);
  const setAngleFromPointer=(event)=>{
    const rect=planRef.current?.getBoundingClientRect();if(!rect)return;
    const x=(event.clientX-rect.left)/rect.width*320-160;
    const y=95-(event.clientY-rect.top)/rect.height*190;
    if(Math.hypot(x,y)<12)return;
    let deg=Math.atan2(y,x)*180/Math.PI;if(deg<0)deg+=360;
    const snapAngles=[0,90,180,270,360];
    let nearest=0,nearestDiff=Infinity;
    for(const target of snapAngles){const diff=Math.min(Math.abs(deg-target),360-Math.abs(deg-target));if(diff<nearestDiff){nearestDiff=diff;nearest=target;}}
    const snapped=nearestDiff<=5;
    const next=snapped?nearest:Math.round(deg*10)/10;
    if(snapped){const key=nearest===360?0:nearest;if(lastSnapRef.current!==key){lastSnapRef.current=key;if(typeof navigator!=='undefined'&&typeof navigator.vibrate==='function')navigator.vibrate(35);}}
    else lastSnapRef.current=null;
    setAngle(next);setConfirmed(false);setRowChoice(null);
  };
  const fmt=n=>Number(n||0).toLocaleString('fr-FR',{maximumFractionDigits:2});
  const onConfirm=()=>{setConfirmed(true);setRowChoice(null);};
  const selected=rowChoice==='lower'?lower:rowChoice==='upper'?upper:null;
  const selectedRows=rowChoice==='lower'?fullRows:ceilRows;
  const displayRows=selectedRows||ceilRows;
  const displayCalculation=calculate(displayRows);
  const displayStrips=displayCalculation.bands.map((band,i)=>{
    let polygon=clipAt(localCorners,band.lo,true);if(polygon.length)polygon=clipAt(polygon,band.hi,false);
    const points=polygon.map(toRoom);
    // Center the label between the strip's two boundaries, then move it
    // along the row away from u=0 (the Qibla-arrow axis) to keep it readable.
    let twiceArea=0,cx=0,cy=0;
    for(let k=0;k<polygon.length;k++){
      const a=polygon[k],b=polygon[(k+1)%polygon.length];
      const cross=a[0]*b[1]-b[0]*a[1];
      twiceArea+=cross;cx+=(a[0]+b[0])*cross;cy+=(a[1]+b[1])*cross;
    }
    const centerV=Math.abs(twiceArea)>1e-8?cy/(3*twiceArea):(band.lo+band.hi)/2;
    const rowIntersections=[];
    for(let k=0;k<polygon.length;k++){
      const a=polygon[k],b=polygon[(k+1)%polygon.length];
      if((a[1]<=centerV&&b[1]>=centerV)||(b[1]<=centerV&&a[1]>=centerV)){
        if(Math.abs(b[1]-a[1])<1e-9)rowIntersections.push(a[0],b[0]);
        else rowIntersections.push(a[0]+(centerV-a[1])*(b[0]-a[0])/(b[1]-a[1]));
      }
    }
    const rowMin=rowIntersections.length?Math.min(...rowIntersections):Math.min(...polygon.map(p=>p[0]));
    const rowMax=rowIntersections.length?Math.max(...rowIntersections):Math.max(...polygon.map(p=>p[0]));
    const labelMargin=Math.min(0.22,Math.max(0.08,(rowMax-rowMin)*0.12));
    const labelU=Math.abs(rowMax-labelMargin)>=Math.abs(rowMin+labelMargin)?rowMax-labelMargin:rowMin+labelMargin;
    const labelPoint=toRoom([labelU,centerV]);
    return {points,labelPoint,partial:band.width<rollWidth-1e-7,length:displayCalculation.lengths[i]};
  });
  // Keep text parallel to the rows but never upside down as the Qibla arrow rotates.
  // Screen Y is inverted, so the row direction is (-sin(angle), -cos(angle)).
  // Use its true screen-space angle; the previous sign caused text to tilt across rows.
  const labelRotationRaw=((-angle-90)%180+180)%180-90;
  const labelRotation=labelRotationRaw<=-89.9?90:labelRotationRaw;
  const planScale=valid?Math.min(270/Math.max(L,0.01),150/Math.max(W,0.01)):1;
  const screenPoint=([x,y])=>[160+x*planScale,95-y*planScale];
  const roomScreenPoints=roomCorners.map(screenPoint);
  const arrowLength=Math.min(78,Math.max(24,Math.max(L,W)*planScale*.38));
  const finalStripWidth=rowChoice==='upper'&&remainder>0?remainder:rollWidth;
  const normalizedMosqueName=(value)=>String(value||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ');
  // Plusieurs orthographes/abréviations sont utilisées pour les tapis de mosquée.
  const mosqueMatches=(tapisProducts||[]).filter(p=>/(?:TAPIS\s+)?MOSQUEE?/.test(normalizedMosqueName(p.name)));
  const mosqueCarpetOptions=mosqueMatches;
  const chosenCostCarpet=mosqueCarpetOptions.find(p=>String(p.id)===String(costCarpetId));
  const exportMosquePdf=({kind,rows,purchaseArea,coveredArea,roomDetails})=>{
    const area=manualPurchaseArea!==''?Math.max(0,Number(manualPurchaseArea)||0):Math.max(0,Number(purchaseArea)||0);
    const carpet=chosenCostCarpet; const carpetUnit=carpet?Number(carpet.wholesale_price)||0:null;
    const feltUnit=Number(feutreUnitPrice)||0, poseUnit=Number(poseUnitPrice)||0;
    const money=n=>Number(n||0).toLocaleString('fr-FR',{maximumFractionDigits:2});
    const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const svg=document.querySelector(kind==='irregular'?'.mosque-final-plan-irregular':'.mosque-final-plan-regular');
    const regularLength=roomDetails.match(/الطول:\\s*([0-9,.]+)/)?.[1]||'';
    const regularWidth=roomDetails.match(/العرض:\\s*([0-9,.]+)/)?.[1]||'';
    const irregularSides=roomDetails.match(/الأضلاع:\\s*(.*)$/)?.[1]||'';
    const dimensionSvg=kind==='regular'
      ? '<text x="160" y="182" text-anchor="middle" font-size="9" font-weight="700" fill="#172033">Longueur : '+esc(regularLength)+' m</text><text x="12" y="95" text-anchor="start" font-size="9" font-weight="700" fill="#172033">Largeur : '+esc(regularWidth)+' m</text>'
      : '<text x="160" y="198" text-anchor="middle" font-size="8" font-weight="700" fill="#172033">Côtés : '+esc(irregularSides)+'</text>';
    const svgHtml=svg?svg.outerHTML.replace(/max-height\s*:\s*280px\s*;?/gi,'').replace(/max-height\s*:\s*[^;]+;?/gi,'').replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ').replace('</svg>',dimensionSvg+'</svg>'):'<p>المخطط غير متوفر</p>';
    const rowHtml=rows.map((r,i)=>'<tr><td>'+(i+1)+'</td><td>'+money(r.length)+' m</td><td>'+(r.width==null?'—':money(r.width)+' m')+'</td></tr>').join('');
    const costRows='<tr><td>السجاد — '+esc(carpet?.name||'غير محددة')+'</td><td>'+money(area)+' m²</td><td>'+(carpetUnit==null?'غير محدد':money(carpetUnit)+' DA/m²')+'</td><td>'+(carpetUnit==null?'غير محددة':money(area*carpetUnit)+' DA')+'</td></tr>'+(includeFeutre?'<tr><td>Feutre</td><td>'+money(area)+' m²</td><td>'+money(feltUnit)+' DA/m²</td><td>'+money(area*feltUnit)+' DA</td></tr>':'')+(includePose?'<tr><td>Pose</td><td>'+money(area)+' m²</td><td>'+money(poseUnit)+' DA/m²</td><td>'+money(area*poseUnit)+' DA</td></tr>':'');
    const hasAnyCost=Boolean(carpet||includeFeutre||includePose);
    const total=(carpet?area*carpetUnit:0)+(includeFeutre?area*feltUnit:0)+(includePose?area*poseUnit:0);
    const totalText=hasAnyCost?money(total)+' DA':'غير محدد — لم يتم إدخال التكاليف';
    const win=window.open('','_blank'); if(!win){alert('اسمح بفتح النوافذ المنبثقة حتى تتمكن من حفظ PDF.');return;}
    const html='<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Plan moquette mosquée</title><style>@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;font-size:10px;margin:0}h1{font-size:18px;margin:0 0 4px;color:#243b53}h2{font-size:12px;margin:11px 0 6px;color:#334e68}.head{display:flex;justify-content:space-between;border-bottom:2px solid #607A9B;padding-bottom:8px}.muted{color:#64748b}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0}.meta div{border:1px solid #dbe2ea;border-radius:5px;padding:6px}.plan{height:166mm;border:1px solid #e2e8f0;padding:2mm;display:flex;align-items:center;justify-content:center;overflow:hidden}.plan svg{display:block;width:100%;height:100%;max-height:none;flex:1 1 auto}.two{display:grid;grid-template-columns:1fr 1.3fr;gap:8px;margin-top:6px;break-inside:avoid}.tbl{width:100%;border-collapse:collapse;font-size:9px}.tbl th,.tbl td{border:1px solid #cbd5e1;padding:5px;text-align:left}.tbl th{background:#edf2f7}.total{border:2px solid #607A9B;border-radius:5px;padding:9px;margin-top:8px;display:flex;justify-content:space-between;font-size:14px;font-weight:800}.note{font-size:8px;color:#64748b;margin-top:7px}@media print{button{display:none}}</style></head><body>'+
      '<div class="head"><div><h1>Africha Hamiz Assistant</h1><strong>Plan de pose — Moquette mosquée</strong><div class="muted">Document de préparation et estimation</div></div><div style="text-align:right"><b>DATE</b><br>'+new Date().toLocaleDateString('fr-FR')+'</div></div>'+
      '<div class="meta"><div><span class="muted">Configuration</span><br><b>'+esc(roomDetails)+'</b></div><div><span class="muted">Direction Qibla</span><br><b>'+money(kind==='regular'?angle:irregularAngle)+'°</b></div><div><span class="muted">Largeur du rouleau</span><br><b>1,33 m</b></div></div>'+
      '<h2>Schéma final des rangées</h2><div class="plan">'+svgHtml+'</div>'+
      '<div class="two"><section><h2>Dimensions et surfaces</h2><table class="tbl"><tbody><tr><td>'+esc(roomDetails)+'</td></tr><tr><td>Surface achetée après ajustement</td><td><b>'+money(area)+' m²</b></td></tr><tr><td>Surface couverte estimée</td><td>'+money(coveredArea)+' m²</td></tr><tr><td>Nombre de rangées</td><td>'+rows.length+'</td></tr></tbody></table></section><section><h2>Longueur de chaque rangée</h2><table class="tbl"><thead><tr><th>Rangée</th><th>Longueur</th><th>Largeur</th></tr></thead><tbody>'+rowHtml+'</tbody></table></section></div>'+
      '<div style="page-break-before:always"></div><h2>Détail des coûts</h2><table class="tbl"><thead><tr><th>Désignation</th><th>Surface</th><th>Prix unitaire</th><th>Montant</th></tr></thead><tbody>'+costRows+'</tbody></table><div class="total"><span>COÛT TOTAL ESTIMÉ</span><span>'+totalText+'</span></div>'+
      '<p class="note">La surface achetée tient compte de la modification manuelle éventuelle. Les dimensions et découpes doivent être vérifiées sur place avant achat et pose.</p></body></html>';
    win.document.open();win.document.write(html);win.document.close();setTimeout(()=>{win.focus();win.print();},500);
  };
  const renderCostSection=(calculatedArea)=>{
    const suggestedArea=Math.max(0,Number(calculatedArea)||0);
    const purchaseArea=manualPurchaseArea!==''?Math.max(0,Number(manualPurchaseArea)||0):suggestedArea;
    const carpetUnit=Number(chosenCostCarpet?.wholesale_price)||0;
    const carpetCost=purchaseArea*carpetUnit;
    const feutreCost=includeFeutre?purchaseArea*(Number(feutreUnitPrice)||0):0;
    const poseCost=includePose?purchaseArea*(Number(poseUnitPrice)||0):0;
    const totalCost=carpetCost+feutreCost+poseCost;
    const stock=Number(chosenCostCarpet?.current_quantity);
    const overStock=chosenCostCarpet&&Number.isFinite(stock)&&purchaseArea>stock+1e-8;
    return <div style={{marginTop:18,padding:14,border:'1px solid var(--ls-border,#cbd5e1)',borderRadius:12}}>
      <h3 style={{marginTop:0}}>Devis estimatif — تكلفة التفريش</h3>
      <label style={{display:'grid',gap:6,fontWeight:700}}>اختيار نوعية السجاد
        <select value={costCarpetId} onChange={e=>setCostCarpetId(e.target.value)} style={styles.field}>
          <option value="">اختار نوعية TAPIS MOSQUEE</option>
          {mosqueCarpetOptions.map(p=><option key={p.id} value={p.id}>{p.name} — {fmt(p.wholesale_price)} DA/m²</option>)}
        </select>
      </label>
      {chosenCostCarpet&&<p className="ls-muted" style={{margin:'7px 0'}}>سعر الجملة: <strong>{fmt(carpetUnit)} DA/m²</strong> — الكمية المسجلة في المخزون: <strong>{fmt(stock)}</strong></p>}
      <label style={{display:'grid',gap:6,fontWeight:700,marginTop:12}}>المساحة المشتراة (م²) — قابلة للتعديل حسب المخزون
        <input type="number" min="0" step="0.01" value={manualPurchaseArea!==''?manualPurchaseArea:suggestedArea.toFixed(2)} onChange={e=>setManualPurchaseArea(e.target.value)} style={styles.field}/>
      </label>
      <p className="ls-muted" style={{margin:'5px 0 10px'}}>المساحة المقترحة حسب الحساب: {fmt(suggestedArea)} م². تغيير هذه الكمية هنا خاص بالتسعير فقط ولا يغيّر المخزون.</p>
      {overStock&&<p className="ls-message">تنبيه: المساحة المدخلة أكبر من الكمية المسجلة في المخزون ({fmt(stock)}).</p>}
      <div style={{display:'grid',gap:10,marginTop:12}}>
        <label style={{display:'flex',alignItems:'center',gap:8,fontWeight:700}}><input type="checkbox" checked={includeFeutre} onChange={e=>setIncludeFeutre(e.target.checked)}/> Avec feutre</label>
        {includeFeutre&&<label style={{display:'grid',gap:6}}>سعر Feutre (DA/m²)<input type="number" min="0" step="0.01" value={feutreUnitPrice} onChange={e=>setFeutreUnitPrice(e.target.value)} style={styles.field}/></label>}
        <label style={{display:'flex',alignItems:'center',gap:8,fontWeight:700}}><input type="checkbox" checked={includePose} onChange={e=>setIncludePose(e.target.checked)}/> Avec pose</label>
        {includePose&&<label style={{display:'grid',gap:6}}>سعر Pose (DA/m²)<input type="number" min="0" step="0.01" value={poseUnitPrice} onChange={e=>setPoseUnitPrice(e.target.value)} style={styles.field}/></label>}
      </div>
      <div style={{marginTop:14,borderTop:'1px solid var(--ls-border,#e2e8f0)',paddingTop:12}}><strong>تفصيل التكلفة</strong>
        <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8,marginTop:9}}>
          <span>السجاد ({fmt(purchaseArea)} × {fmt(carpetUnit)} DA)</span><strong>{fmt(carpetCost)} DA</strong>
          {includeFeutre&&<><span>Feutre ({fmt(purchaseArea)} × {fmt(Number(feutreUnitPrice)||0)} DA)</span><strong>{fmt(feutreCost)} DA</strong></>}
          {includePose&&<><span>Pose ({fmt(purchaseArea)} × {fmt(Number(poseUnitPrice)||0)} DA)</span><strong>{fmt(poseCost)} DA</strong></>}
        </div>
        <div style={{display:'flex',justifyContent:'space-between',gap:10,marginTop:14,paddingTop:10,borderTop:'2px solid #607A9B',fontSize:18,fontWeight:800}}><span>السعر النهائي</span><span>{fmt(totalCost)} DA</span></div>
        {!chosenCostCarpet&&<p className="ls-muted" style={{marginBottom:0}}>اختار نوعية السجاد لاحتساب سعره. تقدر تحسب Feutre وPose اختيارياً.</p>}
      </div>
    </div>;
  };
  if(roomMode==='irregular'){
    const centroid=irregularPoints.length?irregularPoints.reduce((a,p)=>[a[0]+p[0]/irregularPoints.length,a[1]+p[1]/irregularPoints.length],[0,0]):[160,110];
    const positions=irregularClosed?(()=>{
      const placed=[];
      const boxW=56,boxH=36,gap=5,margin=4;
      const overlaps=(a,b)=>a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;
      for(let i=0;i<irregularPoints.length;i++){
        const p=irregularPoints[i],q=irregularPoints[(i+1)%irregularPoints.length];
        const dx=q[0]-p[0],dy=q[1]-p[1],len=Math.hypot(dx,dy)||1;
        let nx=dy/len,ny=-dx/len;
        const mx=(p[0]+q[0])/2,my=(p[1]+q[1])/2;
        if(nx*(mx-centroid[0])+ny*(my-centroid[1])<0){nx=-nx;ny=-ny;}
        const tx=dx/len,ty=dy/len;
        const candidates=[];
        for(const distance of [25,43,61,79])for(const offset of [0,-22,22,-44,44,-66,66,-88,88]){
          const cx=mx+nx*distance+tx*offset,cy=my+ny*distance+ty*offset;
          const x=cx-boxW/2,y=cy-boxH/2;
          if(x<margin||y<margin||x+boxW>316-margin||y+boxH>216-margin)continue;
          const candidate={x,y,w:boxW,h:boxH};
          const collisionCount=placed.filter(other=>overlaps(candidate,other)).length;
          const score=distance+Math.abs(offset)*0.72+collisionCount*10000;
          candidates.push({candidate,score,collisionCount});
        }
        candidates.sort((a,b)=>a.score-b.score);
        let chosen=candidates.find(item=>item.collisionCount===0)?.candidate;
        if(!chosen&&candidates.length)chosen=candidates[0].candidate;
        if(!chosen){
          const x=Math.max(margin,Math.min(316-margin-boxW,mx-boxW/2));
          const y=Math.max(margin,Math.min(216-margin-boxH,my-boxH/2));
          chosen={x,y,w:boxW,h:boxH};
        }
        placed.push(chosen);
      }
      return placed.map(({x,y})=>({x,y}));
    })():[];
    const closeIrregularPolygon=()=>{const pts=irregularPoints.slice();if(pts.length>3&&Math.hypot(pts[pts.length-1][0]-pts[0][0],pts[pts.length-1][1]-pts[0][1])<=24)pts.pop();setIrregularPoints(pts);setIrregularClosed(true);setIrregularLengths(Array(pts.length).fill(''));setIrregularSolved(null);};
    const addPoint=e=>{if(irregularClosed)return;const r=e.currentTarget.getBoundingClientRect(),point=[Math.max(8,Math.min(312,(e.clientX-r.left)/r.width*320)),Math.max(8,Math.min(212,(e.clientY-r.top)/r.height*220))];if(irregularPoints.length>=3&&Math.hypot(point[0]-irregularPoints[0][0],point[1]-irregularPoints[0][1])<=24){closeIrregularPolygon();return;}if(irregularPoints.length&&Math.hypot(point[0]-irregularPoints[irregularPoints.length-1][0],point[1]-irregularPoints[irregularPoints.length-1][1])<8)return;setIrregularPoints([...irregularPoints,point]);};
    const validLengths=irregularClosed&&irregularLengths.length===irregularPoints.length&&irregularLengths.every(v=>Number(v)>0&&Number(v)<=500);
    const pointFromEvent=e=>{const r=irregularDrawRef.current?.getBoundingClientRect();if(!r)return null;return [Math.max(8,Math.min(312,(e.clientX-r.left)/r.width*320)),Math.max(8,Math.min(212,(e.clientY-r.top)/r.height*220))];};
    const vertexAngle=(pts,index)=>{const n=pts.length;if(n<3)return 0;const p=pts[index],a=pts[(index-1+n)%n],b=pts[(index+1)%n];const ax=a[0]-p[0],ay=a[1]-p[1],bx=b[0]-p[0],by=b[1]-p[1];const den=Math.hypot(ax,ay)*Math.hypot(bx,by);if(!den)return 0;return Math.acos(Math.max(-1,Math.min(1,(ax*bx+ay*by)/den)))*180/Math.PI;};
    const calculateIrregularCarpet=()=>{
      if(!irregularSolved)return null;const a=irregularAngle*Math.PI/180;
      const poly=irregularSolved.points.map(([x,y])=>[-x*Math.sin(a)+y*Math.cos(a),x*Math.cos(a)+y*Math.sin(a)]);
      const minV=Math.min(...poly.map(p=>p[1])),maxV=Math.max(...poly.map(p=>p[1]));
      const clip=(points,bound,greater)=>{const out=[];for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length],ip=greater?p[1]>=bound-1e-9:p[1]<=bound+1e-9,iq=greater?q[1]>=bound-1e-9:q[1]<=bound+1e-9;if(ip)out.push(p);if(ip!==iq){const t=(bound-p[1])/(q[1]-p[1]);out.push([p[0]+t*(q[0]-p[0]),bound]);}}return out;};
      const count=Math.ceil((maxV-minV)/1.33),rows=Array.from({length:count},(_,i)=>{const hi=maxV-i*1.33,lo=Math.max(minV,hi-1.33);let band=clip(poly,lo,true);if(band.length)band=clip(band,hi,false);const width=hi-lo,length=band.length>1?Math.max(...band.map(p=>p[0]))-Math.min(...band.map(p=>p[0])):0;const roomPoints=band.map(([u,v])=>[-u*Math.sin(a)+v*Math.cos(a),u*Math.cos(a)+v*Math.sin(a)]);return {number:i+1,width,length,points:roomPoints};});
      return {rows,total:rows.reduce((s,r)=>s+r.length,0),purchasedArea:rows.reduce((s,r)=>s+r.length*1.33,0),coveredArea:rows.reduce((s,r)=>s+r.length*r.width,0)};
    };
    const solveRealGeometry=()=>{
      const cleanPoints=irregularPoints.slice();
      if(cleanPoints.length>3&&Math.hypot(cleanPoints[cleanPoints.length-1][0]-cleanPoints[0][0],cleanPoints[cleanPoints.length-1][1]-cleanPoints[0][1])<=24)cleanPoints.pop();
      const target=irregularLengths.slice(0,cleanPoints.length).map(Number),n=cleanPoints.length;
      if(cleanPoints.length!==irregularPoints.length){setIrregularPoints(cleanPoints);setIrregularLengths(target.map((v)=>String(v)));}
      if(n<3||target.length!==n||target.some(v=>!Number.isFinite(v)||v<=0)){setIrregularSolveError('تحقق من إدخال طول صحيح لكل ضلع.');return;}
      const perimeter=target.reduce((a,b)=>a+b,0),drawn=cleanPoints.reduce((sum,p,i)=>sum+Math.hypot(cleanPoints[(i+1)%n][0]-p[0],cleanPoints[(i+1)%n][1]-p[1]),0);
      if(Math.max(...target)>perimeter-Math.max(...target)+1e-7){setIrregularSolveError('الأطوال غير قابلة لتكوين مضلع مغلق: أطول ضلع لازم يكون أقصر من مجموع باقي الأضلاع.');return;}
      if(!drawn){setIrregularSolveError('الرسم غير صالح. أعد رسم حدود القاعة.');return;}
      const scale=perimeter/drawn,original=cleanPoints.map(p=>[p[0]*scale,p[1]*scale]),pts=original.map(p=>[...p]);
      for(let iteration=0;iteration<3000;iteration++){
        for(let i=0;i<n;i++){const j=(i+1)%n,dx=pts[j][0]-pts[i][0],dy=pts[j][1]-pts[i][1],len=Math.hypot(dx,dy)||1e-9,correction=(len-target[i])/len,cx=dx*correction*.5,cy=dy*correction*.5;pts[i][0]+=cx;pts[i][1]+=cy;pts[j][0]-=cx;pts[j][1]-=cy;}
        const k=iteration<2500?0.0005:0.00003;for(let i=0;i<n;i++){pts[i][0]+=(original[i][0]-pts[i][0])*k;pts[i][1]+=(original[i][1]-pts[i][1])*k;}
      }
      const errors=pts.map((p,i)=>Math.abs(Math.hypot(pts[(i+1)%n][0]-p[0],pts[(i+1)%n][1]-p[1])-target[i])),maxError=Math.max(...errors);
      const area=Math.abs(pts.reduce((s,p,i)=>s+p[0]*pts[(i+1)%n][1]-pts[(i+1)%n][0]*p[1],0))/2;
      if(maxError>0.025||area<0.01){setIrregularSolveError('الأطوال ما تطابقتش مع شكل الرسم. حرّك الزوايا أو أعد الرسم حتى نقدروا نغلقوا المضلع بدقة. أكبر فرق: '+maxError.toFixed(3)+' م.');return;}
      setIrregularSolved({points:pts,maxError,area});setIrregularSolveError('');setIrregularStage('review');
    };
    const dragVertex=(e,index)=>{if(!irregularVertexDragging&&e.type!=='pointerdown')return;const candidate=pointFromEvent(e);if(!candidate)return;setIrregularPoints(old=>{if(old.length<3)return old;const next=old.map(p=>[...p]);const n=next.length,prev=next[(index-1+n)%n],after=next[(index+1)%n];let target=candidate;const v1=[prev[0]-candidate[0],prev[1]-candidate[1]],v2=[after[0]-candidate[0],after[1]-candidate[1]],den=Math.hypot(...v1)*Math.hypot(...v2);let measured=den?Math.acos(Math.max(-1,Math.min(1,(v1[0]*v2[0]+v1[1]*v2[1])/den)))*180/Math.PI:0;const mid=[(prev[0]+after[0])/2,(prev[1]+after[1])/2],radius=Math.hypot(after[0]-prev[0],after[1]-prev[1])/2;const dist=Math.hypot(candidate[0]-mid[0],candidate[1]-mid[1]);if(Math.abs(measured-90)<=6&&radius>0&&dist>0){target=[mid[0]+(candidate[0]-mid[0])*radius/dist,mid[1]+(candidate[1]-mid[1])*radius/dist];const snapKey=String(index);if(!irregularAngleSnapRef.current[snapKey]&&typeof navigator!=='undefined'&&navigator.vibrate)navigator.vibrate(35);irregularAngleSnapRef.current[snapKey]=true;}else{irregularAngleSnapRef.current[String(index)]=false;}next[index]=target;return next;});};
    const moveArrow=e=>{const r=irregularPlanRef.current?.getBoundingClientRect();if(!r)return;const x=(e.clientX-r.left)/r.width*320-160,y=110-(e.clientY-r.top)/r.height*220;if(Math.hypot(x,y)<10)return;let d=Math.atan2(y,x)*180/Math.PI;if(d<0)d+=360;const snaps=[0,90,180,270,360];let best=0,diff=999;snaps.forEach(v=>{const z=Math.min(Math.abs(d-v),360-Math.abs(d-v));if(z<diff){diff=z;best=v;}});setIrregularAngle(diff<=5?best:Math.round(d*10)/10);if(diff<=5&&typeof navigator!=='undefined'&&navigator.vibrate)navigator.vibrate(35);};
    const rad2=irregularAngle*Math.PI/180,arrow=65;
    return <section className="ls-panel">
      <h2 style={{marginTop:0}}>Simulation mosquée</h2>
      <p className="ls-muted">قاعة غير منتظمة — ارسم حدود القاعة، ثم أدخل قياس كل ضلع في المربع الموجود بجانبه.</p>
      <button type="button" style={{...styles.secondary,marginBottom:12}} onClick={()=>setRoomMode(null)}>رجوع لاختيار نوع القاعة</button>
      {irregularStage==='draw'?<>
        <strong>1. ارسم حدود القاعة</strong>
        <p className="ls-muted">اضغط داخل الرسم لإضافة الزوايا بالترتيب. بعد إغلاق الشكل اسحب الدوائر الزرقاء لتعديل الزوايا؛ كي تقرّب زاوية من 90° يفيبري الهاتف ويثبتها على زاوية قائمة.</p>
        <div style={{border:'1px solid var(--ls-border,#cbd5e1)',borderRadius:12,overflow:'hidden',background:'var(--ls-card,#fff)'}}>
          <svg ref={irregularDrawRef} viewBox="0 0 320 220" width="100%" style={{display:'block',touchAction:irregularClosed?'none':'manipulation',cursor:irregularClosed?'grab':'crosshair'}} onClick={addPoint}>
            {irregularPoints.length>=2&&<polyline points={irregularPoints.map(p=>p.join(',')).join(' ')+(irregularClosed?' '+irregularPoints[0].join(','):'')} fill={irregularClosed?'#607A9B22':'none'} stroke="#607A9B" strokeWidth="2.5"/>}
            {irregularPoints.map((p,i)=><g key={i}>
              {irregularClosed&&<circle cx={p[0]} cy={p[1]} r="13" fill="#607A9B" fillOpacity=".12" stroke="#607A9B" strokeWidth="1.5" style={{cursor:'grab',touchAction:'none'}} onPointerDown={e=>{e.stopPropagation();setIrregularVertexDragging(i);e.currentTarget.setPointerCapture?.(e.pointerId);dragVertex(e,i);}} onPointerMove={e=>{if(irregularVertexDragging===i)dragVertex(e,i);}} onPointerUp={e=>{e.stopPropagation();setIrregularVertexDragging(null);irregularAngleSnapRef.current[String(i)]=false;}} onPointerCancel={()=>setIrregularVertexDragging(null)}/>}
              <circle cx={p[0]} cy={p[1]} r={irregularClosed?5:5} fill="#607A9B" pointerEvents="none"/>
              <text x={p[0]} y={p[1]-9} fontSize="10" textAnchor="middle" fill="currentColor" pointerEvents="none">{i+1}</text>
              {irregularClosed&&<text x={p[0]+12} y={p[1]-12} fontSize="9" fontWeight="700" fill="#D69E36" stroke="#fff" strokeWidth="2" paintOrder="stroke" pointerEvents="none">{Math.round(vertexAngle(irregularPoints,i)*10)/10}°</text>}
            </g>)}
            {irregularClosed&&positions.map((p,i)=><foreignObject key={i} x={p.x} y={p.y} width="56" height="36"><input xmlns="http://www.w3.org/1999/xhtml" type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="متر" value={irregularLengths[i]||''} onChange={e=>setIrregularLengths(old=>old.map((v,j)=>j===i?e.target.value:v))} style={{width:54,height:32,boxSizing:'border-box',padding:3,border:'1.5px solid #607A9B',borderRadius:7,background:'#fff',color:'#172033',fontSize:12,textAlign:'center'}}/></foreignObject>)}
          </svg>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
          {!irregularClosed&&<button type="button" style={styles.button} disabled={irregularPoints.length<3} onClick={closeIrregularPolygon}>إغلاق الشكل وإظهار مربعات الأطوال</button>}
          <button type="button" style={styles.secondary} onClick={()=>{setIrregularPoints([]);setIrregularClosed(false);setIrregularLengths([]);}}>مسح الرسم</button>
        </div>
        {irregularClosed&&<><p className="ls-muted">كل مربع ملاصق لضلع معيّن. أدخل الأطوال بالمتر. الأرقام الذهبية بجانب الرؤوس تبيّن قياس الزوايا، والدوائر الزرقاء قابلة للسحب.</p><button type="button" style={{...styles.button,width:'100%'}} disabled={!validLengths} onClick={()=>setIrregularStage('qibla')}>موافق — اختيار اتجاه القبلة</button></>}
      </>:<>
        <strong>2. اختار اتجاه القبلة</strong>
        <p className="ls-muted">اسحب السهم لتحديد اتجاه القبلة.</p>
        <div ref={irregularPlanRef} onPointerDown={e=>{setIrregularDragging(true);e.currentTarget.setPointerCapture?.(e.pointerId);moveArrow(e);}} onPointerMove={e=>{if(irregularDragging)moveArrow(e);}} onPointerUp={()=>setIrregularDragging(false)} onPointerCancel={()=>setIrregularDragging(false)} style={{border:'1px solid var(--ls-border,#cbd5e1)',borderRadius:12,touchAction:'none'}}>
          <svg viewBox="0 0 320 220" width="100%">
            <polygon points={irregularPoints.map(p=>p.join(',')).join(' ')} fill="#607A9B22" stroke="#607A9B" strokeWidth="2.5"/>
            <path d={"M160 110 L"+(160+Math.cos(rad2)*arrow)+" "+(110-Math.sin(rad2)*arrow)} stroke="#D69E36" strokeWidth="4"/>
          </svg>
        </div>
        <p className="ls-muted">اتجاه القبلة: {irregularAngle}°</p>
        <input type="range" min="0" max="359" value={irregularAngle%360} onChange={e=>setIrregularAngle(Number(e.target.value))} style={{width:'100%'}}/>
        <button type="button" style={styles.secondary} onClick={()=>setIrregularStage('draw')}>رجوع لتعديل الأطوال</button>
        <button type="button" style={styles.button} onClick={solveRealGeometry}>موافق — ضبط الأطوال الحقيقية</button>
      </>}
      {irregularStage==='review'&&<div style={{marginTop:14,padding:12,border:'1px solid var(--ls-border,#cbd5e1)',borderRadius:10}}><strong>تم تحديد شكل القاعة واتجاه القبلة</strong><p className="ls-muted">الأطوال: {irregularLengths.map((v,i)=>'ضلع '+(i+1)+': '+v+' م').join(' — ')}.</p><p className="ls-muted">اتجاه القبلة: {irregularAngle}°.</p>{irregularSolveError&&<p className="ls-message">{irregularSolveError}</p>}{irregularSolved&&(()=>{const result=calculateIrregularCarpet();return <><p><strong>تم ضبط المضلع بالأطوال الحقيقية.</strong></p><p>مساحة القاعة: {irregularSolved.area.toFixed(2)} م² — أكبر فرق في الأطوال: {irregularSolved.maxError.toFixed(3)} م.</p><svg className="mosque-final-plan-irregular" viewBox="20 10 280 192" width="100%" style={{maxHeight:280,background:'var(--ls-card,#fff)',borderRadius:8}}>{result.rows.map(r=>{const minX=Math.min(...irregularSolved.points.map(p=>p[0])),maxX=Math.max(...irregularSolved.points.map(p=>p[0])),minY=Math.min(...irregularSolved.points.map(p=>p[1])),maxY=Math.max(...irregularSolved.points.map(p=>p[1])),scale=Math.min(280/Math.max(maxX-minX,.01),180/Math.max(maxY-minY,.01)),map=p=>[160+(p[0]-(minX+maxX)/2)*scale,110-(p[1]-(minY+maxY)/2)*scale],rp=r.points.map(map),label=rp.reduce((s,p)=>[s[0]+p[0]/rp.length,s[1]+p[1]/rp.length],[0,0]);return <g key={r.number}><polygon points={rp.map(p=>p.join(',')).join(' ')} fill="#607A9B" fillOpacity=".28" stroke="#607A9B" strokeWidth="1.2"/>{rp.length>0&&<text x={label[0]} y={label[1]} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill="#1e293b" stroke="#fff" strokeWidth="2.5" paintOrder="stroke">{r.length.toFixed(2)} م</text>}</g>;})}<polygon points={irregularSolved.points.map(p=>{const minX=Math.min(...irregularSolved.points.map(q=>q[0])),maxX=Math.max(...irregularSolved.points.map(q=>q[0])),minY=Math.min(...irregularSolved.points.map(q=>q[1])),maxY=Math.max(...irregularSolved.points.map(q=>q[1])),scale=Math.min(280/Math.max(maxX-minX,.01),180/Math.max(maxY-minY,.01));return [160+(p[0]-(minX+maxX)/2)*scale,110-(p[1]-(minY+maxY)/2)*scale].join(',');}).join(' ')} fill="none" stroke="#334155" strokeWidth="2.5"/><text x="160" y="16" textAnchor="middle" fontSize="10" fill="currentColor">صفوف السجاد داخل القاعة</text></svg><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:8}}><div><span className="ls-muted">عدد الصفوف</span><br/><strong>{result.rows.length}</strong></div><div><span className="ls-muted">إجمالي المتر الطولي</span><br/><strong>{result.total.toFixed(2)} م</strong></div><div><span className="ls-muted">مساحة الرولات المشتراة</span><br/><strong>{result.purchasedArea.toFixed(2)} م²</strong></div><div><span className="ls-muted">المساحة المغطاة تقديرياً</span><br/><strong>{result.coveredArea.toFixed(2)} م²</strong></div></div><p style={{fontWeight:700}}>طول كل صف من جهة القبلة:</p><ol>{result.rows.map(r=><li key={r.number}>الصف {r.number}: {r.length.toFixed(2)} م {r.width<1.325?' — عرض الصف '+r.width.toFixed(2)+' م (قص)':''}</li>)}</ol><p className="ls-muted">عرض الرول 1.33 م. أطوال الصفوف محسوبة من امتداد تقاطع الشريط مع المضلع؛ يلزم التحقق الميداني من القص عند الزوايا.</p>
{renderCostSection(result.purchasedArea)}<button type="button" style={{...styles.button,marginTop:12}} onClick={()=>exportMosquePdf({kind:"irregular",rows:result.rows.map(r=>({length:r.length,width:r.width})),purchaseArea:result.purchasedArea,coveredArea:result.coveredArea,roomDetails:"قاعة غير منتظمة — المساحة الهندسية: "+fmt(irregularSolved.area)+" م² — الأضلاع: "+irregularLengths.map((v,i)=>(i+1)+": "+fmt(v)+" م").join("، ")})}>Save PDF — A4</button></>;})()}</div>}
    </section>;
  }

  return (
    <section className="ls-panel">
      <h2 style={{marginTop:0}}>Simulation mosquée</h2>
      <p className="ls-muted">اختار نوع شكل قاعة الصلاة.</p>
      {roomMode===null?<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
        <button type="button" onClick={()=>setRoomMode('regular')} style={{...styles.secondary,padding:16,textAlign:'left',minHeight:96}}><strong style={{display:'block',fontSize:16,marginBottom:6}}>قاعة منتظمة</strong><span className="ls-muted">مستطيل أو مربع — الطول والعرض فقط.</span></button>
        <button type="button" onClick={()=>{setRoomMode('irregular');setIrregularStage('draw');}} style={{...styles.secondary,padding:16,textAlign:'left',minHeight:96}}><strong style={{display:'block',fontSize:16,marginBottom:6}}>قاعة غير منتظمة</strong><span className="ls-muted">ارسم الحدود وأدخل الأطوال بجانب الأضلاع.</span></button>
      </div>:<><button type="button" style={{...styles.secondary,marginBottom:12}} onClick={()=>setRoomMode(null)}>رجوع لاختيار نوع القاعة</button><p className="ls-muted">قاعة منتظمة — أدخل الطول والعرض.</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>
        <label style={{display:'grid',gap:6,fontWeight:700}}>Longueur de la salle (m)
          <input type="number" min="0.1" step="0.01" style={styles.field} value={roomLength} onChange={e=>{setRoomLength(e.target.value);setConfirmed(false);setRowChoice(null);}}/>
        </label>
        <label style={{display:'grid',gap:6,fontWeight:700}}>Largeur de la salle (m)
          <input type="number" min="0.1" step="0.01" style={styles.field} value={roomWidth} onChange={e=>{setRoomWidth(e.target.value);setConfirmed(false);setRowChoice(null);}}/>
        </label>
      </div>
      <div style={{marginTop:18}}>
        <strong>Choisir la direction de la Qibla</strong>
        <p className="ls-muted" style={{margin:'5px 0 10px'}}>اسحب السهم لتحديد اتجاه القبلة. شكل القاعة يبقى ثابتاً، وصفوف السجاد عمودية على السهم، ويبدأ الصف الأول من الجدار الموجود جهة القبلة.</p>
        <div ref={planRef} onPointerDown={e=>{setDragging(true);e.currentTarget.setPointerCapture?.(e.pointerId);setAngleFromPointer(e);}} onPointerMove={e=>{if(dragging)setAngleFromPointer(e);}} onPointerUp={()=>{setDragging(false);lastSnapRef.current=null;}} onPointerCancel={()=>{setDragging(false);lastSnapRef.current=null;}} style={{width:'100%',maxWidth:520,touchAction:'none',border:'1px solid var(--ls-border,#cbd5e1)',borderRadius:12,overflow:'hidden',background:'var(--ls-card,#fff)',cursor:'crosshair'}}>
          <svg className="mosque-final-plan-regular" viewBox="0 0 320 190" width="100%" role="img" aria-label="Plan fixe, rangées perpendiculaires à la Qibla avec longueur de chaque rangée">
            <polygon points={roomScreenPoints.map(p=>p.join(',')).join(' ')} fill="#94a3b8" fillOpacity=".08" stroke="currentColor" strokeWidth="1.5"/>
            {confirmed&&displayStrips.map((strip,i)=>strip.points.length>=3&&(
              <g key={i}>
                <polygon points={strip.points.map(p=>screenPoint(p).join(',')).join(' ')} fill="#607A9B" fillOpacity=".25" stroke="#607A9B" strokeWidth="1.5" strokeDasharray={strip.partial&&!selected?"5 4":undefined}/>
                <text x={screenPoint(strip.labelPoint)[0]} y={screenPoint(strip.labelPoint)[1]} transform={"rotate("+labelRotation+" "+screenPoint(strip.labelPoint)[0]+" "+screenPoint(strip.labelPoint)[1]+")"} textAnchor="middle" dominantBaseline="middle" fontSize="8" fontWeight="700" fill="#1e293b" stroke="#fff" strokeWidth="2.5" paintOrder="stroke">{fmt(strip.length)}</text>
              </g>
            ))}
            <path d={`M160 95 L${160+Math.cos(rad)*arrowLength} ${95-Math.sin(rad)*arrowLength}`} stroke="#D69E36" strokeWidth="4" strokeLinecap="round"/>
            <path d={`M${160+Math.cos(rad)*arrowLength} ${95-Math.sin(rad)*arrowLength} l-13 -3 l5 12`} fill="none" stroke="#D69E36" strokeWidth="3" strokeLinecap="round"/>
            <circle cx="160" cy="95" r="5" fill="#D69E36"/>
            <text x="160" y="12" textAnchor="middle" fontSize="10" fill="currentColor">Salle de prière</text>
            <text x="244" y="30" fontSize="10" fill="#D69E36">Qibla</text>
          </svg>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',marginTop:8,flexWrap:'wrap'}}>
          <span className="ls-muted">Angle sélectionné : <strong>{fmt(angle===360?0:angle)}°</strong></span>
          <button type="button" style={styles.secondary} onClick={()=>{setAngle(0);setConfirmed(false);setRowChoice(null);}}>Réinitialiser l’angle</button>
        </div>
      </div>
      <button type="button" style={{...styles.button,marginTop:16}} disabled={!valid} onClick={onConfirm}>موافق — حساب الكمية</button>
      {!valid&&<p className="ls-message">أدخل طولاً وعرضاً صحيحين أكبر من صفر.</p>}
      {confirmed&&valid&&(
        <div style={{marginTop:20,borderTop:'1px solid var(--ls-border,#e2e8f0)',paddingTop:16}}>
          <h3 style={{marginTop:0}}>Résultat du calcul</h3>
          <p className="ls-muted">المسافة العمودية على اتجاه القبلة داخل القاعة: <strong>{fmt(across)} م</strong>. عدد الصفوف النظري: <strong>{fmt(across/rollWidth)}</strong>.</p>
          {remainder<0.01?(
            <div style={{padding:14,border:'1px solid #16a34a',borderRadius:10}}>
              <strong>{fullRows} صفوف كاملة</strong>
              <p style={{margin:'6px 0 0'}}>الطول الإجمالي: {fmt(lower.total)} م طولي — مساحة الرولات المشتراة: {fmt(lower.purchasedArea)} م² — المساحة المغطاة: {fmt(lower.coveredArea)} م².</p>
            </div>
          ):(
            <>
              <p>كاين عرض متبقّي قدره <strong>{fmt(remainder)} م</strong>. اختار طريقة التغطية:</p>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
                <button type="button" onClick={()=>setRowChoice('lower')} style={{...styles.secondary,textAlign:'left',padding:14,border:rowChoice==='lower'?'2px solid #607A9B':undefined}}>
                  <strong>{fullRows} صفوف كاملة</strong><br/>
                  <span>يبقى فراغ بعرض {fmt(remainder)} م</span>
                </button>
                <button type="button" onClick={()=>setRowChoice('upper')} style={{...styles.secondary,textAlign:'left',padding:14,border:rowChoice==='upper'?'2px solid #607A9B':undefined}}>
                  <strong>{ceilRows} صفوف مع قص الصف الأخير</strong><br/>
                  <span>عرض الصف الأخير {fmt(remainder)} م بعد القص</span>
                </button>
              </div>
            </>
          )}
          {selected&&(
            <div style={{marginTop:14,padding:14,border:'1px solid var(--ls-border,#cbd5e1)',borderRadius:12}}>
              <strong>النتيجة حسب اختيارك: {selectedRows} صفوف</strong>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:10,marginTop:12}}>
                <div><div className="ls-muted">Longueur totale à acheter</div><strong style={{fontSize:22}}>{fmt(selected.total)} m</strong></div>
                <div><div className="ls-muted">Surface achetée (rouleau entier)</div><strong style={{fontSize:22}}>{fmt(selected.purchasedArea)} m²</strong></div>
                <div><div className="ls-muted">Surface couverte estimée</div><strong style={{fontSize:22}}>{fmt(selected.coveredArea)} m²</strong></div>
                <div><div className="ls-muted">Largeur de la dernière bande</div><strong style={{fontSize:22}}>{fmt(finalStripWidth)} m</strong></div>
              </div>
              <p className="ls-muted" style={{marginBottom:0}}>أطوال الشرائط المقدّرة: {selected.lengths.map(fmt).join(' + ')} متر.</p>{renderCostSection(selected.purchasedArea)}<button type="button" style={{...styles.button,marginTop:12}} onClick={()=>exportMosquePdf({kind:"regular",rows:selected.lengths.map((length,i)=>({length,width:selected.widths[i]})),purchaseArea:selected.purchasedArea,coveredArea:selected.coveredArea,roomDetails:"قاعة منتظمة — الطول: "+fmt(L)+" م — العرض: "+fmt(W)+" م"})}>Save PDF — A4</button>
            </div>
          )}
          {remainder<0.01&&<>{renderCostSection(lower.purchasedArea)}<button type="button" style={{...styles.button,marginTop:12}} onClick={()=>exportMosquePdf({kind:"regular",rows:lower.lengths.map((length,i)=>({length,width:lower.widths[i]})),purchaseArea:lower.purchasedArea,coveredArea:lower.coveredArea,roomDetails:"قاعة منتظمة — الطول: "+fmt(L)+" م — العرض: "+fmt(W)+" م"})}>Save PDF — A4</button></>}
        </div>
      )}
      <p className="ls-muted" style={{marginTop:18,fontSize:12}}>ملاحظة: هذه محاكاة أولية. الحساب يعتمد على تقاطع صفوف بعرض 1.33 م مع حدود القاعة؛ راجع القص النهائي ميدانياً قبل الشراء، خصوصاً عند الزوايا المائلة.</p>
      </>}
    </section>
  );
}

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [hiddenProducts, setHiddenProducts] = useState([]);
  const [suggestedProducts, setSuggestedProducts] = useState([]);
  const [stockDecreaseProducts, setStockDecreaseProducts] = useState([]);
  const [stockDecreaseLoading, setStockDecreaseLoading] = useState(false);
  const [decreaseSearch, setDecreaseSearch] = useState('');
  const [decreasePage, setDecreasePage] = useState(1);
  const [decreasePageSize, setDecreasePageSize] = useState(20);
  const [decreaseDays, setDecreaseDays] = useState(1);
  const [decreaseSortKey, setDecreaseSortKey] = useState('quantity_decreased');
  const [decreaseSortDirection, setDecreaseSortDirection] = useState('desc');
  const [selectedSuggestions, setSelectedSuggestions] = useState([]);
  const [selectedStockDecrease, setSelectedStockDecrease] = useState([]);
  const [stockHistory, setStockHistory] = useState([]);
  const [replenishmentRequests, setReplenishmentRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [csvPreview, setCsvPreview] = useState([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [tapisCsvPreview, setTapisCsvPreview] = useState([]);
  const [tapisCsvFileName, setTapisCsvFileName] = useState('');
  const [pdfPreview, setPdfPreview] = useState([]);
  const [pdfSearch, setPdfSearch] = useState('');
  const [pdfFileName, setPdfFileName] = useState('');
  const [tapisPdfPreview, setTapisPdfPreview] = useState([]);
  const [tapisPdfSearch, setTapisPdfSearch] = useState('');
  const [tapisPdfFileName, setTapisPdfFileName] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortKey, setSortKey] = useState('product_ref');
  const [sortDirection, setSortDirection] = useState('asc');
  const [pageOrder, setPageOrder] = useState([]);
  const [hiddenPages, setHiddenPages] = useState([]);
  const [pagePermissions, setPagePermissions] = useState({});
  const [photoPreview, setPhotoPreview] = useState(null);
  const [tableSearch, setTableSearch] = useState('');
  const [hiddenSearch, setHiddenSearch] = useState('');
  const [hiddenPage, setHiddenPage] = useState(1);
  const [hiddenPageSize, setHiddenPageSize] = useState(20);
  const [hiddenSortKey, setHiddenSortKey] = useState('name');
  const [hiddenSortDirection, setHiddenSortDirection] = useState('asc');
  const [analysisSearch, setAnalysisSearch] = useState('');
  const [analysisPage, setAnalysisPage] = useState(1);
  const [analysisPageSize, setAnalysisPageSize] = useState(20);
  const [analysisSortKey, setAnalysisSortKey] = useState('days_remaining');
  const [analysisSortDirection, setAnalysisSortDirection] = useState('asc');
  const [activePage, setActivePage] = useState('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [alertScope, setAlertScope] = useState('linge');
  const [statsScope, setStatsScope] = useState('all');
  const [alertTablePages, setAlertTablePages] = useState({});
  const [alertTablePageSizes, setAlertTablePageSizes] = useState({});
  const [alertTableSelections, setAlertTableSelections] = useState({});
  const [statsPage, setStatsPage] = useState(1);
  const [statsPageSize, setStatsPageSize] = useState(10);
  const [statsSelection, setStatsSelection] = useState([]);

  const [searchTerm, setSearchTerm] = useState('');
  const [productPhotos, setProductPhotos] = useState([]);
  const [photoProductId, setPhotoProductId] = useState('');
  const [photoSearch, setPhotoSearch] = useState('');
  const [photoProductSearch, setPhotoProductSearch] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [salesAddQuantities, setSalesAddQuantities] = useState({});
  const [labelAddQuantities, setLabelAddQuantities] = useState({});
  const [showTraderQuantities, setShowTraderQuantities] = useState(true);
  const [showArinaZeroStock, setShowArinaZeroStock] = useState(true);
  const [lastImportBatch, setLastImportBatch] = useState(null);
  const [lastLingePdfImport, setLastLingePdfImport] = useState(null);
  const [lastTapisImportBatch, setLastTapisImportBatch] = useState(null);
  const [lastTapisPdfImport, setLastTapisPdfImport] = useState(null);
  const [productNotes, setProductNotes] = useState([]);
  const [noteProductId, setNoteProductId] = useState('');
  const [noteText, setNoteText] = useState('');
  const [notesLoading, setNotesLoading] = useState(false);
  const [language, setLanguage] = useState('fr');
  const [arinaQuantities, setArinaQuantities] = useState({});
  const [theme, setTheme] = useState('light');
  const [suggestions, setSuggestions] = useState([]);
  const [tapisSuggestedProducts, setTapisSuggestedProducts] = useState([]);
  const [tapisSuggestionsLoading, setTapisSuggestionsLoading] = useState(false);
  const [tapisAnalysisSearch, setTapisAnalysisSearch] = useState('');
  const [tapisAnalysisPage, setTapisAnalysisPage] = useState(1);
  const [tapisAnalysisPageSize, setTapisAnalysisPageSize] = useState(20);
  const [tapisAnalysisSortKey, setTapisAnalysisSortKey] = useState('days_remaining');
  const [tapisAnalysisSortDirection, setTapisAnalysisSortDirection] = useState('asc');
  const [selectedTapisSuggestions, setSelectedTapisSuggestions] = useState([]);
  const [tapisStockDecreaseProducts, setTapisStockDecreaseProducts] = useState([]);
  const [tapisStockDecreaseLoading, setTapisStockDecreaseLoading] = useState(false);
  const [tapisDecreaseSearch, setTapisDecreaseSearch] = useState('');
  const [tapisDecreasePage, setTapisDecreasePage] = useState(1);
  const [tapisDecreasePageSize, setTapisDecreasePageSize] = useState(20);
  const [tapisDecreaseDays, setTapisDecreaseDays] = useState(1);
  const [tapisDecreaseSortKey, setTapisDecreaseSortKey] = useState('quantity_decreased');
  const [tapisDecreaseSortDirection, setTapisDecreaseSortDirection] = useState('desc');
  const [selectedTapisStockDecrease, setSelectedTapisStockDecrease] = useState([]);
  const [suggestionTitle, setSuggestionTitle] = useState('');
  const [suggestionBody, setSuggestionBody] = useState('');
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [accountPermissions, setAccountPermissions] = useState([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionsMessage, setPermissionsMessage] = useState('');
  const [permissionSavingId, setPermissionSavingId] = useState('');
  const [salesCustomer, setSalesCustomer] = useState('');
  const [salesProductId, setSalesProductId] = useState('');
  const [salesSearch, setSalesSearch] = useState('');
  const [salesLines, setSalesLines] = useState([]);
  const [labelSearch, setLabelSearch] = useState('');
  const [labelLines, setLabelLines] = useState([]);
  const [couloirSearch, setCouloirSearch] = useState('');
  const [couloirLines, setCouloirLines] = useState([]);
  const [couloirAddQuantities, setCouloirAddQuantities] = useState({});
  const [moquetteSearch, setMoquetteSearch] = useState('');
  const [moquetteLines, setMoquetteLines] = useState([]);
  const [moquetteAddQuantities, setMoquetteAddQuantities] = useState({});
  const [hideLabelPrice, setHideLabelPrice] = useState(false);
  const [barcodeSearch, setBarcodeSearch] = useState('');
  const [barcodeLines, setBarcodeLines] = useState([]);
  const [barcodeAddQuantities, setBarcodeAddQuantities] = useState({});
  const [scannerTarget, setScannerTarget] = useState(null);
  const [scannerStatus, setScannerStatus] = useState('');
  const scannerVideoRef = useRef(null);
  const [mosqueTapisProducts, setMosqueTapisProducts] = useState([]);
  const [tapisTickets, setTapisTickets] = useState([]);
  const [ticketModel, setTicketModel] = useState('');
  const [ticketDraft, setTicketDraft] = useState({type:'',denomination:'',dimension:'',dessin:'',couleur:'',code_barres:''});
  const [ticketPhoto, setTicketPhoto] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketBusy, setTicketBusy] = useState(false);
  const ticketFileRef = useRef(null);
  const [printSettings, setPrintSettings] = useState({ invoice_width_cm: 10, invoice_height_cm: 15, label_width_cm: 5, label_height_cm: 3 });
  const [printSettingsMessage, setPrintSettingsMessage] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [savedPdfDocuments, setSavedPdfDocuments] = useState([]);
  const [selectedInvoiceDocuments, setSelectedInvoiceDocuments] = useState([]);
  const [selectedLabelDocuments, setSelectedLabelDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [labelDocumentTitle, setLabelDocumentTitle] = useState('');

  async function loadProducts() {
    let allProducts = [];
    const pageSize = 500;
    let start = 0;

    while (true) {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, product_ref, reference_1, name, current_quantity, wholesale_price, retail_price, min_stock_level, is_hidden, is_active, is_in_latest_pdf'
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

    // Include inactive Europ Arina items with zero stock so the dedicated
    // Arina toggle can show them without activating them across the app.
    const { data: inactiveArinaProducts, error: inactiveArinaError } = await supabase
      .from('products')
      .select(
        'id, product_ref, reference_1, name, current_quantity, wholesale_price, retail_price, min_stock_level, is_hidden, is_active, is_in_latest_pdf'
      )
      .eq('is_active', false)
      .eq('is_hidden', false)
      .eq('current_quantity', 0)
      .ilike('name', '%EUROP%ARINA%');

    if (inactiveArinaError) {
      setMessage('Erreur produits Europ Arina : ' + inactiveArinaError.message);
      return;
    }

    const existingIds = new Set(allProducts.map((product) => product.id));
    allProducts = allProducts.concat(
      (inactiveArinaProducts || []).filter((product) => !existingIds.has(product.id))
    );

    // Charger le catalogue Tapis séparément, sans mélanger ses opérations avec Linge.
    let tapisProducts = [];
    let tapisStart = 0;
    while (true) {
      const { data: tapisPage, error: tapisError } = await supabase
        .from('tapis_products')
        .select('id, product_ref, reference_1, name, current_quantity, wholesale_price, retail_price, min_stock_level, is_hidden, is_active, is_in_latest_pdf')
        .eq('is_active', true)
        .eq('is_hidden', false)
        .order('name')
        .range(tapisStart, tapisStart + pageSize - 1);
      if (tapisError) {
        setMessage('Erreur produits Tapis : ' + tapisError.message + '. Vérifiez la migration des droits de lecture Tapis.');
        return;
      }
      tapisProducts = tapisProducts.concat(tapisPage || []);
      if (!tapisPage || tapisPage.length < pageSize) break;
      tapisStart += pageSize;
    }

    // Base fiable : catalogue Tapis déjà chargé avec les droits de lecture habituels.
    // Normaliser les accents pour reconnaître MOSQUE, MOSQUEE et MOSQUÉE.
    const normalizeMosqueName = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    const mosqueMap = new Map();
    for (const product of tapisProducts) {
      if (/(?:TAPIS\s+)?MOSQUEE?/.test(normalizeMosqueName(product.name))) {
        mosqueMap.set(String(product.id), product);
      }
    }

    // Ajouter aussi les variétés masquées/inactives quand les droits le permettent.
    // Une erreur sur cette requête complémentaire ne doit jamais vider la liste visible.
    let mosqueStart = 0;
    while (true) {
      const { data: mosquePage, error: mosqueError } = await supabase
        .from('tapis_products')
        .select('id, product_ref, reference_1, name, current_quantity, wholesale_price, retail_price, min_stock_level, is_hidden, is_active, is_in_latest_pdf')
        .ilike('name', '%MOSQ%')
        .order('name')
        .range(mosqueStart, mosqueStart + pageSize - 1);
      if (mosqueError) {
        console.warn('Chargement complémentaire MOSQUE indisponible :', mosqueError.message);
        break;
      }
      for (const product of mosquePage || []) {
        if (/(?:TAPIS\s+)?MOSQUEE?/.test(normalizeMosqueName(product.name))) {
          mosqueMap.set(String(product.id), product);
        }
      }
      if (!mosquePage || mosquePage.length < pageSize) break;
      mosqueStart += pageSize;
    }
    setMosqueTapisProducts(Array.from(mosqueMap.values()).sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'fr')
    ));
    // Sécurité temporaire : ne pas remplacer une quantité correcte par 0
    // tant que la détection des références présentes dans le PDF n'est pas fiabilisée.
    // La quantité enregistrée en base reste affichée sans modification.

    setProducts(allProducts.map((product) => ({ ...product, catalog_source: 'products' })));
    setCatalogProducts([
      ...allProducts.map((product) => ({ ...product, catalog_source: 'products' })),
      ...tapisProducts.map((product) => ({ ...product, catalog_source: 'tapis_products' })),
    ]);
    setCurrentPage(1);
    setMessage('');
  }
  async function hideProduct(product) {
    const confirmed = window.confirm(
      `Voulez-vous masquer le produit "${product.name}" ?`
    );

    if (!confirmed) return;

    const sourceTable = product.catalog_source === 'tapis_products' ? 'tapis_products' : 'products';
    const { error } = await supabase
      .from(sourceTable)
      .update({ is_hidden: true })
      .eq('id', product.id);

    if (error) {
      window.alert('Erreur : ' + error.message);
      return;
    }

    setProducts((current) => current.filter((item) => !(item.id === product.id && item.catalog_source === sourceTable)));
    setCatalogProducts((current) => current.filter((item) => !(item.id === product.id && item.catalog_source === sourceTable)));

    window.alert('Produit masqué avec succès.');
  }


  async function hideCatalogItems(items, onDone) {
    const normalized = (items || []).map((item) => ({
      ...item,
      id: item.id || item.product_id,
      catalog_source: item.catalog_source || 'products',
    })).filter((item) => item.id);
    if (!normalized.length) {
      window.alert('Sélectionnez au moins un produit.');
      return;
    }
    if (!window.confirm(`Voulez-vous masquer les ${normalized.length} produit(s) sélectionné(s) ?`)) return;
    const groups = {
      products: normalized.filter((item) => item.catalog_source !== 'tapis_products').map((item) => item.id),
      tapis_products: normalized.filter((item) => item.catalog_source === 'tapis_products').map((item) => item.id),
    };
    for (const [table, ids] of Object.entries(groups)) {
      if (!ids.length) continue;
      const { error } = await supabase.from(table).update({ is_hidden: true }).in('id', ids);
      if (error) {
        window.alert('Erreur : ' + error.message);
        return;
      }
    }
    const hiddenIds = new Set(normalized.map((item) => String(item.id)));
    const hiddenKeys = new Set(normalized.map((item) => `${item.catalog_source}:${item.id}`));
    setProducts((current) => current.filter((item) => !hiddenIds.has(String(item.id))));
    setCatalogProducts((current) => current.filter((item) => !hiddenKeys.has(`${item.catalog_source}:${item.id}`)));
    setSuggestedProducts((current) => current.filter((item) => !hiddenIds.has(String(item.id))));
    setTapisSuggestedProducts((current) => current.filter((item) => !hiddenIds.has(String(item.id))));
    setStockDecreaseProducts((current) => current.filter((item) => !hiddenIds.has(String(item.product_id))));
    setTapisStockDecreaseProducts((current) => current.filter((item) => !hiddenIds.has(String(item.product_id))));
    if (onDone) onDone();
    await loadHiddenProducts();
    window.alert('Produits sélectionnés masqués avec succès.');
  }

  async function copyCatalogItems(items) {
    const names = (items || []).map((item) => item.name || item.product_name).filter(Boolean);
    if (!names.length) {
      window.alert('Sélectionnez au moins un produit.');
      return;
    }
    const textToCopy = names.join('\n');
    try {
      await navigator.clipboard.writeText(textToCopy);
      window.alert(`${names.length} désignation(s) copiée(s).`);
    } catch (error) {
      window.prompt('Copiez les désignations :', textToCopy);
    }
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

  async function hideSelectedStockDecrease() {
    if (selectedStockDecrease.length === 0) {
      window.alert('Veuillez sélectionner au moins un produit.');
      return;
    }
    const confirmed = window.confirm(
      `Voulez-vous masquer les ${selectedStockDecrease.length} produit(s) sélectionné(s) ?`
    );
    if (!confirmed) return;
    const { error } = await supabase
      .from('products')
      .update({ is_hidden: true })
      .in('id', selectedStockDecrease);
    if (error) {
      window.alert('Erreur : ' + error.message);
      return;
    }
    setStockDecreaseProducts((current) =>
      current.filter((product) => !selectedStockDecrease.includes(product.product_id))
    );
    setSelectedStockDecrease([]);
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

  async function loadTapisSuggestedProducts() {
    setTapisSuggestionsLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_tapis_reorder_suggestions');
      if (error) throw error;
      setTapisSuggestedProducts(data || []);
      setSelectedTapisSuggestions([]);
    } catch (error) {
      console.error('[Tapis reorder suggestions]', error);
      setMessage('Erreur suggestions Tapis : ' + error.message);
    } finally {
      setTapisSuggestionsLoading(false);
    }
  }

  async function loadTapisStockDecreaseAnalysis() {
    setTapisStockDecreaseLoading(true);
    try {
      const { data, error } = await supabase.rpc(
        'get_tapis_pdf_stock_decrease_analysis',
        { p_days: Math.max(1, Math.min(3650, Number(tapisDecreaseDays) || 1)) }
      );
      if (error) throw error;
      setTapisStockDecreaseProducts(data || []);
      setSelectedTapisStockDecrease([]);
    } catch (error) {
      console.error('[Tapis stock decrease analysis]', error);
      setMessage('Erreur analyse des baisses Tapis : ' + error.message);
    } finally {
      setTapisStockDecreaseLoading(false);
    }
  }

  async function hideSelectedTapisSuggestions() {
    if (!selectedTapisSuggestions.length) { window.alert('Veuillez sélectionner au moins un produit.'); return; }
    if (!window.confirm('Voulez-vous masquer les ' + selectedTapisSuggestions.length + ' produit(s) Tapis sélectionné(s) ?')) return;
    const { error } = await supabase.from('tapis_products').update({ is_hidden: true }).in('id', selectedTapisSuggestions);
    if (error) { window.alert('Erreur : ' + error.message); return; }
    setTapisSuggestedProducts(current => current.filter(p => !selectedTapisSuggestions.includes(p.id)));
    setSelectedTapisSuggestions([]);
    window.alert('Produits Tapis sélectionnés masqués avec succès.');
  }

  async function hideSelectedTapisStockDecrease() {
    if (!selectedTapisStockDecrease.length) { window.alert('Veuillez sélectionner au moins un produit.'); return; }
    if (!window.confirm('Voulez-vous masquer les ' + selectedTapisStockDecrease.length + ' produit(s) Tapis sélectionné(s) ?')) return;
    const { error } = await supabase.from('tapis_products').update({ is_hidden: true }).in('id', selectedTapisStockDecrease);
    if (error) { window.alert('Erreur : ' + error.message); return; }
    setTapisStockDecreaseProducts(current => current.filter(p => !selectedTapisStockDecrease.includes(p.product_id)));
    setSelectedTapisStockDecrease([]);
    window.alert('Produits Tapis sélectionnés masqués avec succès.');
  }
  async function loadStockDecreaseAnalysis() {
    setStockDecreaseLoading(true);

    try {
      const { data, error } = await supabase.rpc(
        'get_pdf_stock_decrease_analysis',
        { p_days: Math.max(1, Math.min(3650, Number(decreaseDays) || 1)) }
      );

      if (error) throw error;

      setStockDecreaseProducts(data || []);
    } catch (error) {
      console.error('[Stock decrease analysis]', error);
      setMessage('Erreur analyse des baisses : ' + error.message);
    } finally {
      setStockDecreaseLoading(false);
    }
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

  function handleTapisCsvFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setTapisCsvFileName(file.name);
    setTapisCsvPreview([]);
    Papa.parse(file, {
      delimiter: ';',
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().replace(/�/g, 'é'),
      complete: (results) => {
        if (results.errors.length > 0) {
          setMessage('Erreur lecture CSV Tapis : ' + results.errors[0].message);
          return;
        }
        if (!results.data || results.data.length === 0) {
          setMessage('Le fichier CSV Tapis est vide.');
          return;
        }
        setTapisCsvPreview(results.data);
        setMessage(`Fichier CSV Tapis lu : ${results.data.length} lignes. Vérifiez les colonnes avant import.`);
      },
      error: (error) => setMessage('Erreur lecture CSV Tapis : ' + error.message),
    });
  }

  async function syncProductDesignations(rpcName, rows) {
    const designationRows = (rows || [])
      .filter((row) => row.product_ref && row.name)
      .map((row) => ({
        product_ref: String(row.product_ref).trim(),
        name: String(row.name).trim(),
      }));
    if (!designationRows.length) return null;
    const { error } = await supabase.rpc(rpcName, { p_rows: designationRows });
    return error || null;
  }

  async function importTapisCsvToSupabase() {
    if (!tapisCsvPreview.length) {
      window.alert('Veuillez sélectionner un fichier CSV Tapis.');
      return;
    }

    const today = new Date();
    const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const snapshotDate = window.prompt('Date historique CSV Tapis (AAAA-MM-JJ) :', defaultDate);
    if (snapshotDate === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate.trim())) {
      window.alert('Date invalide. Utilisez le format AAAA-MM-JJ.');
      return;
    }

    const rows = tapisCsvPreview.map((row) => ({
      product_ref: String(row['Code'] ?? '').trim(),
      name: String(row['Désignation'] ?? '').trim(),
      quantity: String(row['Quantité'] ?? '').trim().replace(',', '.'),
      wholesale_price: String(row['Gros'] ?? '').trim().replace(',', '.'),
      retail_price: String(row['Détail'] ?? '').trim().replace(',', '.'),
    }));
    const invalidRows = rows.map((row, index) => ({ ...row, line: index + 2 }))
      .filter((row) => !row.product_ref || !row.name || row.quantity === '' ||
        !/^-?\d+(?:\.\d+)?$/.test(row.quantity) ||
        (row.wholesale_price !== '' && !/^-?\d+(?:\.\d+)?$/.test(row.wholesale_price)) ||
        (row.retail_price !== '' && !/^-?\d+(?:\.\d+)?$/.test(row.retail_price)));
    if (invalidRows.length) {
      window.alert(`Lignes CSV Tapis invalides : ${invalidRows.length}\n` + invalidRows.slice(0, 5).map(r => `Ligne ${r.line}: ${r.product_ref} — quantité ${r.quantity}`).join('\n'));
      return;
    }

    if (!window.confirm(`Importer ${rows.length} lignes CSV Tapis pour les prix et l’historique ?\n\nLe stock actuel Tapis ne sera PAS modifié.\nFichier : ${tapisCsvFileName}\nDate : ${snapshotDate}`)) return;

    setMessage('Enregistrement des prix et de l’historique Tapis en cours...');
    const { data, error } = await supabase.rpc('admin_import_tapis_csv_history_prices', {
      p_file_name: tapisCsvFileName,
      p_snapshot_date: snapshotDate.trim(),
      p_rows: rows,
    });
    if (error) {
      setMessage('Erreur import CSV Tapis : ' + error.message);
      return;
    }
    const designationError = await syncProductDesignations('admin_sync_tapis_product_designations', rows);
    await loadProducts();
    setMessage(designationError
      ? `CSV Tapis enregistré, mais échec de mise à jour des désignations : ${designationError.message}`
      : `CSV Tapis enregistré : ${data?.rows_saved ?? 0} lignes historiques. Prix et désignations Tapis actualisés. Le stock actuel n’a pas été modifié.`);
    setTapisCsvPreview([]);
    setTapisCsvFileName('');
  }

  async function importCsvToSupabase() {
    if (!csvPreview.length) {
      window.alert('Veuillez sélectionner un fichier CSV.');
      return;
    }

    const today = new Date();
    const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const snapshotDate = window.prompt('Date historique CSV (AAAA-MM-JJ) :', defaultDate);
    if (snapshotDate === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate.trim())) {
      window.alert('Date invalide. Utilisez le format AAAA-MM-JJ.');
      return;
    }
    if (!window.confirm(`Importer ${csvPreview.length} lignes du CSV pour l’historique et les prix ?\\n\\nLa quantité actuelle ne sera PAS modifiée.\\nFichier : ${csvFileName}\\nDate : ${snapshotDate}`)) return;

    const rows = csvPreview.map((row) => ({
      product_ref: String(row['Code'] ?? '').trim(),
      name: String(row['Désignation'] ?? '').trim(),
      quantity: String(row['Quantité'] ?? '').trim().replace(',', '.'),
      wholesale_price: String(row['Gros'] ?? '').trim().replace(',', '.'),
      retail_price: String(row['Détail'] ?? '').trim().replace(',', '.'),
    }));
    const invalidRows = rows.map((row, index) => ({ ...row, line: index + 2 }))
      .filter((row) => !row.product_ref || !row.name || row.quantity === '' ||
        !/^-?\d+(?:\.\d+)?$/.test(row.quantity) ||
        (row.wholesale_price !== '' && !/^-?\d+(?:\.\d+)?$/.test(row.wholesale_price)) ||
        (row.retail_price !== '' && !/^-?\d+(?:\.\d+)?$/.test(row.retail_price)));
    if (invalidRows.length) {
      window.alert(`Lignes CSV invalides : ${invalidRows.length}\\n` + invalidRows.slice(0, 5).map(r => `Ligne ${r.line}: ${r.product_ref} — quantité ${r.quantity}`).join('\\n'));
      return;
    }

    setMessage('Enregistrement de l’historique et des prix en cours...');
    const { data, error } = await supabase.rpc('admin_import_csv_history_prices', {
      p_file_name: csvFileName,
      p_snapshot_date: snapshotDate.trim(),
      p_rows: rows,
    });
    if (error) {
      setMessage('Erreur import CSV : ' + error.message);
      return;
    }
    const designationError = await syncProductDesignations('admin_sync_product_designations', rows);
    await loadProducts();
    await loadLastImport();
    setMessage(designationError
      ? `CSV enregistré, mais échec de mise à jour des désignations : ${designationError.message}`
      : `CSV enregistré : ${data?.rows_saved ?? 0} lignes historiques. Prix et désignations actualisés. La quantité actuelle n’a pas été modifiée.`);
    setCsvPreview([]);
    setCsvFileName('');
  }

  async function handlePdfFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPdfFileName(file.name);
    setPdfPreview([]);
    setPdfSearch('');
    setMessage('Lecture du PDF en cours...');
    try {
      const bytes = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const lines = [];
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        const items = content.items
          .filter(item => item.str && item.str.trim() && item.transform)
          .map(item => ({ x: item.transform[4], y: item.transform[5], text: item.str.trim() }))
          .sort((a, b) => b.y - a.y || a.x - b.x);

        // Group by baseline tolerance instead of rounding each item's Y separately.
        const rowGroups = [];
        for (const item of items) {
          let group = rowGroups.find(row => Math.abs(row.y - item.y) <= 3);
          if (!group) {
            group = { y: item.y, items: [] };
            rowGroups.push(group);
          }
          group.items.push(item);
          group.y = group.items.reduce((sum, part) => sum + part.y, 0) / group.items.length;
        }

        for (const group of rowGroups) {
          const sorted = group.items.sort((a, b) => a.x - b.x);
          const first = sorted[0]?.text || '';
          if (/^[A-Z0-9][A-Z0-9._/-]{2,}$/.test(first) && sorted.length >= 2) {
            lines.push({ items: sorted });
          }
        }
      }

      const numericPattern = /^-?\d[\d\s]*(?:[.,]\d+)?$/;
      const parsed = [];
      for (const line of lines) {
        const code = line.items[0]?.text?.trim() || '';
        if (!code) continue;
        const numericItems = [];
        for (let i = 1; i < line.items.length; i++) {
          const text = line.items[i].text.replace(/\u00a0/g, ' ').trim();
          if (numericPattern.test(text)) numericItems.push({ index: i, text });
        }
        if (!numericItems.length) continue;

        let quantityText = numericItems[0].text.replace(/\s+/g, '');
        if (
          numericItems.length > 1 &&
          /^-?\d+$/.test(quantityText) &&
          /[.,]\d{2}$/.test(numericItems[1].text.replace(/\s+/g, '')) &&
          numericItems[1].index === numericItems[0].index + 1
        ) {
          quantityText += numericItems[1].text.replace(/\s+/g, '');
        }
        const quantity = Number(quantityText.replace(',', '.'));
        if (!Number.isFinite(quantity)) continue;

        const numericIndexes = new Set(numericItems.map(item => item.index));
        const name = line.items.slice(1)
          .filter((item, index) => !numericIndexes.has(index + 1))
          .map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();
        if (!name) continue;
        parsed.push({ product_ref: code, name, quantity: String(quantity) });
      }

      const unique = new Map();
      for (const row of parsed) unique.set(row.product_ref, row);
      const rows = [...unique.values()];
      if (!rows.length) {
        setMessage('Aucune ligne produit reconnue. Vérifiez que le PDF est un état de stock texte.');
        return;
      }
      setPdfPreview(rows);
      setPdfSearch('');
      const negatives = rows.filter(r => Number(r.quantity) < 0).length;
      const target = rows.find(r => r.product_ref.toUpperCase() === 'COUHAD01');
      setMessage(
        `PDF lu : ${rows.length} références. Quantités négatives : ${negatives}.` +
        (target ? ` COUHAD01 détecté : ${target.quantity}.` : ' COUHAD01 non détecté : vérifiez le PDF avant import.') +
        ' Vérifiez l’aperçu avant import.'
      );
    } catch (error) {
      console.error('PDF parse error', error);
      setMessage('Erreur lecture PDF : ' + error.message);
    }
  }

  async function importPdfCurrentStock() {
    if (!pdfPreview.length) {
      window.alert('Veuillez sélectionner un fichier PDF.');
      return;
    }
    const today = new Date();
    const defaultStockDate = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
    const date = window.prompt('Date du stock magasin (AAAA-MM-JJ) :', defaultStockDate);
    if (date === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      window.alert('Date invalide. Utilisez le format AAAA-MM-JJ.');
      return;
    }
    if (!window.confirm(`Mettre à jour les quantités actuelles depuis le PDF ?\\n\\nSeules les quantités seront modifiées, jamais les prix ni l’historique CSV.\\nFichier : ${pdfFileName}\\nDate : ${date}\\nLignes : ${pdfPreview.length}`)) return;
    setMessage('Mise à jour des quantités depuis le PDF...');
    const { data, error } = await supabase.rpc('admin_import_pdf_current_stock_with_history', {
      p_file_name: pdfFileName,
      p_snapshot_date: date.trim(),
      p_rows: pdfPreview,
    });
    if (error) {
      setMessage('Erreur import PDF : ' + error.message);
      return;
    }
    const designationError = await syncProductDesignations('admin_sync_product_designations', pdfPreview);
    await loadProducts();
    setMessage(designationError
      ? `PDF importé, mais échec de mise à jour des désignations : ${designationError.message}`
      : `PDF importé : ${data?.rows_updated ?? 0} quantités mises à jour et désignations synchronisées. Références introuvables : ${data?.products_not_found ?? 0}. Prix et historique CSV inchangés.`);
    setPdfPreview([]);
    setPdfSearch('');
    setPdfFileName('');
  }
  async function handleTapisPdfFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setTapisPdfFileName(file.name);
    setTapisPdfPreview([]);
    setTapisPdfSearch('');
    setMessage('Lecture du PDF Tapis en cours...');
    try {
      const bytes = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const lines = [];
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        const items = content.items
          .filter(item => item.str && item.str.trim() && item.transform)
          .map(item => ({ x: item.transform[4], y: item.transform[5], text: item.str.trim() }))
          .sort((a, b) => b.y - a.y || a.x - b.x);
        const rowGroups = [];
        for (const item of items) {
          let group = rowGroups.find(row => Math.abs(row.y - item.y) <= 3);
          if (!group) {
            group = { y: item.y, items: [] };
            rowGroups.push(group);
          }
          group.items.push(item);
          group.y = group.items.reduce((sum, part) => sum + part.y, 0) / group.items.length;
        }
        for (const group of rowGroups) {
          const sorted = group.items.sort((a, b) => a.x - b.x);
          const first = sorted[0]?.text || '';
          if (/^[A-Z0-9][A-Z0-9._/-]{2,}$/i.test(first) && sorted.length >= 2) {
            lines.push({ items: sorted });
          }
        }
      }

      const numericPattern = /^-?\d[\d\s]*(?:[.,]\d+)?$/;
      const parsed = [];
      for (const line of lines) {
        const code = line.items[0]?.text?.trim() || '';
        if (!code) continue;
        const numericItems = [];
        for (let i = 1; i < line.items.length; i++) {
          const value = line.items[i].text.replace(/\u00a0/g, ' ').trim();
          if (numericPattern.test(value)) numericItems.push({ index: i, text: value });
        }
        if (!numericItems.length) continue;
        let quantityText = numericItems[0].text.replace(/\s+/g, '');
        if (
          numericItems.length > 1 &&
          /^-?\d+$/.test(quantityText) &&
          /[.,]\d{2}$/.test(numericItems[1].text.replace(/\s+/g, '')) &&
          numericItems[1].index === numericItems[0].index + 1
        ) {
          quantityText += numericItems[1].text.replace(/\s+/g, '');
        }
        const quantity = Number(quantityText.replace(',', '.'));
        if (!Number.isFinite(quantity)) continue;
        const numericIndexes = new Set(numericItems.map(item => item.index));
        const name = line.items.slice(1)
          .filter((item, index) => !numericIndexes.has(index + 1))
          .map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();
        if (!name) continue;
        parsed.push({ product_ref: code, name, quantity: String(quantity) });
      }
      const unique = new Map();
      for (const row of parsed) unique.set(row.product_ref, row);
      const rows = [...unique.values()];
      if (!rows.length) {
        setMessage('Aucune ligne Tapis reconnue. Vérifiez que le PDF contient du texte sélectionnable avec code, désignation et quantité.');
        return;
      }
      setTapisPdfPreview(rows);
      const negatives = rows.filter(row => Number(row.quantity) < 0).length;
      setMessage(`PDF Tapis lu : ${rows.length} références reconnues. Quantités négatives : ${negatives}. Vérifiez l’aperçu avant import.`);
    } catch (error) {
      console.error('Tapis PDF parse error', error);
      setMessage('Erreur lecture PDF Tapis : ' + error.message);
    }
  }

  async function importTapisPdfCurrentStock() {
    if (!tapisPdfPreview.length) {
      window.alert('Veuillez sélectionner un PDF Tapis.');
      return;
    }
    const today = new Date();
    const defaultStockDate = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
    const date = window.prompt('Date du stock Tapis (AAAA-MM-JJ) :', defaultStockDate);
    if (date === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      window.alert('Date invalide. Utilisez le format AAAA-MM-JJ.');
      return;
    }
    if (!window.confirm(
      `Importer le stock actuel Tapis ?\n\nLes nouveaux produits seront créés dans la base Tapis. Les produits absents du PDF passeront à zéro. Aucune donnée Linge ne sera modifiée.\n\nFichier : ${tapisPdfFileName}\nDate : ${date}\nLignes : ${tapisPdfPreview.length}`
    )) return;
    setMessage('Import du stock Tapis et création des produits en cours...');
    const { data, error } = await supabase.rpc('admin_import_tapis_pdf_current_stock_with_history', {
      p_file_name: tapisPdfFileName,
      p_snapshot_date: date.trim(),
      p_rows: tapisPdfPreview,
    });
    if (error) {
      setMessage('Erreur import PDF Tapis : ' + error.message);
      return;
    }
    const designationError = await syncProductDesignations('admin_sync_tapis_product_designations', tapisPdfPreview);
    setMessage(
      designationError
        ? `PDF Tapis importé, mais échec de mise à jour des désignations : ${designationError.message}`
        : `PDF Tapis importé : ${data?.rows_updated ?? 0} quantités mises à jour et désignations synchronisées. Produits créés/actualisés : ${data?.products_created_or_refreshed ?? 0}. Références introuvables : ${data?.products_not_found ?? 0}.`
    );
    setTapisPdfPreview([]);
    setTapisPdfSearch('');
    setTapisPdfFileName('');
    await loadProducts();
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
          'full_name, role, is_active, preferred_language, can_view_negative_stock, can_view_zero_negative_products, can_view_requests, can_view_other_notes, preferred_theme, page_order, hidden_pages, page_permissions'
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
      setPageOrder(Array.isArray(profile.page_order) ? profile.page_order : []);
      setHiddenPages(Array.isArray(profile.hidden_pages) ? profile.hidden_pages : []);
      setPagePermissions(profile.page_permissions && typeof profile.page_permissions === 'object' ? profile.page_permissions : {});
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
    if (product.catalog_source === 'tapis_products') {
      window.alert('La modification manuelle du stock Tapis sera ajoutée avec ses propres fonctions.');
      return;
    }
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
    const [lingeCsv, lingePdf, tapisCsv, tapisPdf] = await Promise.all([
      supabase.from('import_batches').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('pdf_stock_imports').select('*').order('imported_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('tapis_import_batches').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('tapis_pdf_stock_imports').select('*').order('imported_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!lingeCsv.error) setLastImportBatch(lingeCsv.data || null);
    if (!lingePdf.error) setLastLingePdfImport(lingePdf.data || null);
    if (!tapisCsv.error) setLastTapisImportBatch(tapisCsv.data || null);
    if (!tapisPdf.error) setLastTapisPdfImport(tapisPdf.data || null);
  }

  function latestImportRecord(...records) {
    return records.filter(Boolean).sort((a, b) => {
      const dateA = new Date(a.imported_at || a.created_at || a.stock_date || a.snapshot_date || 0).getTime();
      const dateB = new Date(b.imported_at || b.created_at || b.stock_date || b.snapshot_date || 0).getTime();
      return dateB - dateA;
    })[0] || null;
  }

  function displayImportDate(record) {
    const value = record?.imported_at || record?.created_at || record?.stock_date || record?.snapshot_date;
    return value ? new Date(value).toLocaleString('fr-FR') : 'Aucun import trouvé';
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
          'id, full_name, role, is_active, can_view_negative_stock, can_view_zero_negative_products, page_permissions'
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

  async function updateAccountRole(profileId, role) {
    if (!['trader', 'viewer', 'sous-admin'].includes(role)) return;
    const previous = accountPermissions.find((item) => item.id === profileId)?.role;
    setAccountPermissions((current) => current.map((item) => item.id === profileId ? { ...item, role } : item));
    setPermissionSavingId(profileId + ':role');
    try {
      const { error } = await supabase.from('profiles').update({ role }).eq('id', profileId);
      if (error) throw error;
      setPermissionsMessage('Rôle du compte mis à jour : ' + role);
    } catch (error) {
      setAccountPermissions((current) => current.map((item) => item.id === profileId ? { ...item, role: previous } : item));
      setPermissionsMessage('Erreur changement de rôle : ' + error.message);
    } finally {
      setPermissionSavingId('');
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
    const { error } = await supabase.rpc('set_my_preferred_theme', { p_theme: nextTheme });
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

  async function uploadProductPhoto(file, product) {
    if (user?.profile?.role !== 'admin') { window.alert('Seul l’administrateur peut gérer les photos.'); return; }
    if (!file || !product?.id) return;
    setPhotoUploading(true);
    try {
      const blob = await compressImage(file);
      const safeRef = String(product.product_ref || product.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      const path = `${safeRef}.jpg`;
      const { error: uploadError } = await supabase.storage.from('product-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('product-photos').getPublicUrl(path);
      const photoUrl = `${urlData.publicUrl}${urlData.publicUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
      const { error: saveError } = await supabase.from('product_photos').upsert({ product_id: product.id, storage_path: path, photo_url: photoUrl, updated_at: new Date().toISOString() }, { onConflict: 'product_id' });
      if (saveError) throw saveError;
      setMessage(`Photo enregistrée pour ${product.name} (${Math.round(blob.size / 1024)} Ko).`);
      await loadProductPhotos();
    } catch (error) { setMessage('Erreur photo : ' + (error?.message || String(error))); }
    finally { setPhotoUploading(false); }
  }

  async function deleteProductPhoto(photoOrProduct) {
    if (!isAdmin) return;
    const productId = photoOrProduct.product_id || photoOrProduct.id;
    const photo = productPhotos.find((p) => p.product_id === productId);
    if (!photo) return;
    if (!window.confirm('Supprimer uniquement la photo ? Le produit restera dans le stock.')) return;
    try {
      if (photo.storage_path) {
        const { error: storageError } = await supabase.storage.from('product-photos').remove([photo.storage_path]);
        if (storageError) console.warn('Suppression stockage photo:', storageError.message);
      }
      const { error } = await supabase.from('product_photos').delete().eq('product_id', productId);
      if (error) throw error;
      setMessage('Photo supprimée. Le produit est conservé.');
      await loadProductPhotos();
    } catch (error) { setMessage('Erreur suppression photo : ' + error.message); }
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

  async function savePagePreferences(nextOrder, nextHidden) {
    setPageOrder(nextOrder); setHiddenPages(nextHidden);
    const { error } = await supabase.rpc('set_my_page_preferences', { p_page_order: nextOrder, p_hidden_pages: nextHidden });
    if (error) { setMessage('Erreur sauvegarde des pages : ' + error.message); return; }
    setUser((current)=>current ? {...current,profile:{...current.profile,page_order:nextOrder,hidden_pages:nextHidden}} : current);
    setMessage('Ordre et visibilité des pages enregistrés.');
  }

  async function savePagePermission(profileId, pageId, allowed) {
    const account = accountPermissions.find((x)=>x.id===profileId);
    const next = {...(account?.page_permissions || {}), [pageId]: allowed};
    setAccountPermissions((cur)=>cur.map((x)=>x.id===profileId?{...x,page_permissions:next}:x));
    const {error}=await supabase.from('profiles').update({page_permissions:next}).eq('id',profileId);
    if(error){setPermissionsMessage('Erreur permission section : '+error.message);return;}
    setPermissionsMessage('Permission de section enregistrée.');
  }


  async function loadPrintSettings() {
    const { data, error } = await supabase.from('app_print_settings').select('invoice_width_cm, invoice_height_cm, label_width_cm, label_height_cm').eq('id', 1).maybeSingle();
    if (error) {
      setPrintSettingsMessage('Réglages PDF non chargés : exécutez d’abord le SQL fourni. Les valeurs par défaut restent utilisables.');
      return;
    }
    if (data) setPrintSettings({ invoice_width_cm: Number(data.invoice_width_cm) || 10, invoice_height_cm: Number(data.invoice_height_cm) || 15, label_width_cm: Number(data.label_width_cm) || 5, label_height_cm: Number(data.label_height_cm) || 3 });
    setPrintSettingsMessage('');
  }

  async function savePrintSettings() {
    if (!isAdmin) return;
    const values = Object.fromEntries(Object.entries(printSettings).map(([key, value]) => [key, Number(value)]));
    if (Object.values(values).some((value) => !Number.isFinite(value) || value <= 0 || value > 100)) {
      setPrintSettingsMessage('Les dimensions doivent être comprises entre 0,1 et 100 cm.');
      return;
    }
    const { error } = await supabase.from('app_print_settings').upsert({ id: 1, ...values, updated_by: user.id, updated_at: new Date().toISOString() });
    if (error) {
      setPrintSettingsMessage('Erreur sauvegarde : ' + error.message + '. Vérifiez que le SQL des réglages a été exécuté.');
      return;
    }
    setPrintSettingsMessage('Dimensions enregistrées pour tous les comptes autorisés.');
  }

  function addSalesLine(productOrId = salesProductId, requestedQuantity = 1) {
    const product = productOrId && typeof productOrId === 'object'
      ? productOrId
      : catalogProducts.find((item) => String(item.id) === String(productOrId));
    const quantity = Number(requestedQuantity);
    if (!product) { window.alert('Choisissez un produit dans les résultats de recherche.'); return; }
    if (!Number.isFinite(quantity) || quantity <= 0) { window.alert('Saisissez une quantité supérieure à zéro.'); return; }
    const key = `${product.catalog_source}:${product.id}`;
    setSalesLines((current) => {
      const existing = current.find((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source);
      return existing ? current.map((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source ? { ...line, quantity: Number(line.quantity) + quantity } : line) : [...current, { ...product, quantity }];
    });
    setSalesAddQuantities((current) => ({ ...current, [key]: '1' }));
    setSalesProductId('');
  }

  const salesTotal = salesLines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.wholesale_price || 0), 0);

  async function deleteSavedPdfDocument(documentId) {
    if (!documentId || !window.confirm('Supprimer définitivement ce document de l’historique ?')) return;
    const { error } = await supabase.from('app_pdf_documents').delete().eq('id', documentId);
    if (error) {
      setMessage('Erreur suppression du document : ' + error.message);
      return;
    }
    setSavedPdfDocuments((current) => current.filter((document) => document.id !== documentId));
    setMessage('Document supprimé de l’historique.');
  }

  async function deleteSelectedPdfDocuments(docType, selectedIds, setSelectedIds) {
    const ids = [...new Set(selectedIds || [])];
    if (!ids.length) { window.alert('Sélectionnez au moins un document.'); return; }
    if (!window.confirm(`Supprimer définitivement les ${ids.length} document(s) sélectionné(s) ?`)) return;
    const { error } = await supabase.from('app_pdf_documents').delete().in('id', ids).eq('doc_type', docType);
    if (error) {
      setMessage('Erreur suppression des documents : ' + error.message);
      return;
    }
    setSavedPdfDocuments((current) => current.filter((document) => !ids.includes(document.id)));
    setSelectedIds([]);
    setMessage(`${ids.length} document(s) supprimé(s) de l’historique.`);
  }

  async function loadSavedPdfDocuments() {
    setDocumentsLoading(true);
    const { data, error } = await supabase
      .from('app_pdf_documents')
      .select('id, doc_type, title, customer_name, document_date, items, total, created_by, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      setMessage('Erreur historique PDF : ' + error.message + '. Vérifiez que la migration des documents PDF a été exécutée.');
      setDocumentsLoading(false);
      return;
    }
    setSavedPdfDocuments(data || []);
    setDocumentsLoading(false);
  }

  function addLabelLine(product, requestedQuantity = 1) {
    if (!product) return;
    const quantity = Math.floor(Number(requestedQuantity));
    if (!Number.isFinite(quantity) || quantity <= 0) { window.alert('Saisissez un nombre d’étiquettes supérieur à zéro.'); return; }
    const key = `${product.catalog_source}:${product.id}`;
    setLabelLines((current) => {
      const existing = current.find((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source);
      if (existing) {
        return current.map((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source
          ? { ...line, quantity: Math.min(500, Number(line.quantity || 0) + quantity) }
          : line);
      }
      return [...current, { ...product, quantity: Math.min(500, quantity) }];
    });
    setLabelAddQuantities((current) => ({ ...current, [key]: '1' }));
  }

  function addBarcodeLine(product, requestedQuantity = 1) {
    if (!product) return;
    if (!String(product.reference_1 || '').trim()) { window.alert('Ce produit ne possède pas de REFERENCE 1.'); return; }
    const quantity = Math.floor(Number(requestedQuantity));
    if (!Number.isFinite(quantity) || quantity <= 0) { window.alert('Saisissez un nombre d’étiquettes supérieur à zéro.'); return; }
    setBarcodeLines((current) => {
      const exists = current.some((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source);
      return exists ? current.map((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source ? { ...line, quantity: Math.min(500, Number(line.quantity || 0) + quantity) } : line) : [...current, { ...product, quantity: Math.min(500, quantity) }];
    });
    setBarcodeAddQuantities((current) => ({ ...current, [`${product.catalog_source}:${product.id}`]: '1' }));
  }
  function updateBarcodeLineQuantity(product, value) {
    const quantity = value === '' ? '' : Math.max(1, Math.min(500, Math.floor(Number(value) || 1)));
    setBarcodeLines((current) => current.map((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source ? { ...line, quantity } : line));
  }
  async function makeBarcodePdf() {
    if (pdfBusy) return;
    const chosen = barcodeLines.filter((line) => Number(line.quantity) > 0);
    const totalLabels = chosen.reduce((sum, line) => sum + Math.floor(Number(line.quantity)), 0);
    if (!totalLabels) { window.alert('Choisissez au moins un produit et un nombre d’étiquettes.'); return; }
    if (totalLabels > 500) { window.alert('Limite de sécurité : 500 étiquettes par PDF.'); return; }
    const missing = chosen.find((line) => !/^\d{1,41}$/.test(String(line.reference_1 || '').trim()));
    if (missing) { window.alert('REFERENCE 1 manquante ou invalide pour : ' + missing.name); return; }
    setPdfBusy(true);
    try {
      const { jsPDF } = await import('jspdf');
      const width = Number(printSettings.label_width_cm) * 10, height = Number(printSettings.label_height_cm) * 10;
      const doc = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'mm', format: [width, height] });
      let pageIndex = 0;
      for (const product of chosen) {
        const qr = makeReferenceQrDataUrl(product.reference_1);
        for (let copy = 0; copy < Math.floor(Number(product.quantity)); copy++) {
          if (pageIndex++) doc.addPage([width, height], width > height ? 'landscape' : 'portrait');
          const margin = 1.5, qrSize = Math.max(8, Math.min(height - margin * 2, width * 0.48));
          doc.addImage(qr, 'PNG', margin, (height - qrSize) / 2, qrSize, qrSize);
          const textX = margin + qrSize + 2, textWidth = Math.max(5, width - textX - margin);
          const fontSize = Math.max(6, Math.min(10, textWidth / 4.5));
          doc.setFont('helvetica', 'bold'); doc.setFontSize(fontSize);
          const nameLines = doc.splitTextToSize(String(product.name || ''), textWidth).slice(0, 4);
          const lineHeight = fontSize * 0.42, textY = (height - nameLines.length * lineHeight) / 2 + lineHeight * 0.75;
          doc.text(nameLines, textX, textY, { lineHeightFactor: 1.05 });
        }
      }
      doc.save('codes-QR-' + new Date().toISOString().slice(0, 10) + '.pdf');
      setMessage(`PDF QR téléchargé : ${totalLabels} étiquette(s). Le QR contient REFERENCE 1.`);
    } catch (error) { window.alert('Erreur création PDF QR : ' + (error?.message || error)); }
    finally { setPdfBusy(false); }
  }
  function addCouloirLine(product, requestedQuantity = 1) {
    if (!product) return;
    const quantity = Math.floor(Number(requestedQuantity));
    if (!Number.isFinite(quantity) || quantity <= 0) { window.alert('Saisissez un nombre d’étiquettes supérieur à zéro.'); return; }
    setCouloirLines((current) => {
      const exists = current.find((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source);
      return exists ? current.map((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source ? { ...line, quantity: Math.min(500, Number(line.quantity || 0) + quantity) } : line) : [...current, { ...product, quantity: Math.min(500, quantity) }];
    });
  }
  function updateCouloirLineQuantity(product, value) {
    const quantity = value === '' ? '' : Math.max(1, Math.min(500, Math.floor(Number(value) || 1)));
    setCouloirLines((current) => current.map((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source ? { ...line, quantity } : line));
  }
  function getCouloirLabelData(product) {
    const words = String(product.name || '').trim().split(/\s+/);
    // La largeur est la première valeur numérique située après le mot COULOIR
    // (ex. « COULOIR ESPLANA 83 AU ML » ou « COULOIR 0 NOMADE … »).
    const couloirIndex = words.findIndex((word) => /^COULOIR$/i.test(word));
    const width = couloirIndex >= 0
      ? (words.slice(couloirIndex + 1).find((word) => /^\d+(?:[.,]\d+)?$/.test(word)) || '')
      : '';
    // Le prix de l'étiquette Prix couloir est le Prix de détail du produit.
    const retailPrice = product.retail_price;
    const price = retailPrice == null || String(retailPrice).trim() === '' ? '' : String(retailPrice).trim();
    return { width, price };
  }
  async function makeCouloirPdf() {
    if (pdfBusy) return;
    const chosen = couloirLines.filter((line) => Number(line.quantity) > 0);
    const total = chosen.reduce((sum, line) => sum + Math.floor(Number(line.quantity)), 0);
    if (!total) { window.alert('Choisissez au moins un produit et un nombre d’étiquettes.'); return; }
    if (total > 500) { window.alert('Limite de sécurité : 500 étiquettes par PDF.'); return; }
    const missing = chosen.find((line) => { const data = getCouloirLabelData(line); return !data.width || !data.price; });
    if (missing) { window.alert('LARGEUR ou PRIX introuvable dans la désignation/DETAIL de : ' + missing.name); return; }
    setPdfBusy(true);
    try {
      const { jsPDF } = await import('jspdf');
      const width = 100, height = 100;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [width, height] });
      let page = 0;
      for (const product of chosen) {
        const data = getCouloirLabelData(product);
        for (let copy = 0; copy < Math.floor(Number(product.quantity)); copy++) {
          if (page++) doc.addPage([width, height], 'portrait');
          // Nom de la boutique tout en haut de l'étiquette.
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(12);
          doc.text('Africha Shop Hamiz', 50, 8, { align: 'center' });

          // Désignation sur deux lignes maximum, centrée, avec une taille fixe de 25 pt.
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(25);
          const nameText = String(product.name || '');
          const nameLines = doc.splitTextToSize(nameText, 88).slice(0, 2);
          doc.text(nameLines, 50, 30, { align: 'center', lineHeightFactor: 1.0 });

          // Largeur : taille réduite pour rester visuellement sous la désignation.
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(14);
          doc.text('LARGEUR : ' + data.width + ' mm', 8, 60);

          // Prix : 5 fois la taille initiale (60 pt), gras et italique.
          const priceText = 'PRIX : ' + data.price + ' DA / m';
          doc.setFont('helvetica', 'bolditalic');
          let priceFontSize = 60;
          doc.setFontSize(priceFontSize);
          while (doc.getTextWidth(priceText) > 92 && priceFontSize > 30) {
            priceFontSize -= 1;
            doc.setFontSize(priceFontSize);
          }
          doc.text(priceText, 50, 79, { align: 'center' });

          // Mention des réseaux sociaux en bas, à la taille du nom de la boutique.
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(12);
          doc.text('FB/ INSTA : AFRICHA SHOP', 50, 97, { align: 'center' });
        }
      }
      // Téléchargement direct via Blob : évite l'ouverture d'une page PDF vide sur mobile.
      const pdfBlob = doc.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const downloadLink = document.createElement('a');
      downloadLink.href = pdfUrl;
      downloadLink.download = 'prix-couloir-' + new Date().toISOString().slice(0, 10) + '.pdf';
      downloadLink.style.display = 'none';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
      setMessage('PDF Prix couloir prêt au téléchargement : ' + total + ' étiquette(s).');
    } catch (error) { window.alert('Erreur création PDF Prix couloir : ' + (error?.message || error)); }
    finally { setPdfBusy(false); }
  }


  function addMoquetteLine(product, requestedQuantity = 1) {
    if (!product) return;
    const quantity = Math.floor(Number(requestedQuantity));
    if (!Number.isFinite(quantity) || quantity <= 0) { window.alert('Saisissez un nombre d’étiquettes supérieur à zéro.'); return; }
    setMoquetteLines((current) => {
      const exists = current.find((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source);
      return exists ? current.map((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source ? { ...line, quantity: Math.min(500, Number(line.quantity || 0) + quantity) } : line) : [...current, { ...product, quantity: Math.min(500, quantity) }];
    });
  }
  function updateMoquetteLineQuantity(product, value) {
    const quantity = value === '' ? '' : Math.max(1, Math.min(500, Math.floor(Number(value) || 1)));
    setMoquetteLines((current) => current.map((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source ? { ...line, quantity } : line));
  }
  function getMoquetteLabelData(product) {
    const words = String(product.name || '').trim().split(/\s+/);
    // Pour les moquettes, la largeur est le premier nombre autonome de la désignation (ex. PLAZA 400 AU M).
    const width = words.find((word) => /^\d+(?:[.,]\d+)?$/.test(word)) || '';
    // Le prix de l'étiquette Prix moquette mosquée est le Prix de détail du produit.
    const retailPrice = product.retail_price;
    const price = retailPrice == null || String(retailPrice).trim() === '' ? '' : String(retailPrice).trim();
    return { width, price };
  }
  async function makeMoquettePdf() {
    if (pdfBusy) return;
    const chosen = moquetteLines.filter((line) => Number(line.quantity) > 0);
    const total = chosen.reduce((sum, line) => sum + Math.floor(Number(line.quantity)), 0);
    if (!total) { window.alert('Choisissez au moins un produit et un nombre d’étiquettes.'); return; }
    if (total > 500) { window.alert('Limite de sécurité : 500 étiquettes par PDF.'); return; }
    const missing = chosen.find((line) => { const data = getMoquetteLabelData(line); return !data.width || !data.price; });
    if (missing) { window.alert('LARGEUR ou PRIX introuvable dans la désignation/DETAIL de : ' + missing.name); return; }
    setPdfBusy(true);
    try {
      const { jsPDF } = await import('jspdf');
      const width = 100, height = 100;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [width, height] });
      let page = 0;
      for (const product of chosen) {
        const data = getMoquetteLabelData(product);
        for (let copy = 0; copy < Math.floor(Number(product.quantity)); copy++) {
          if (page++) doc.addPage([width, height], 'portrait');
          // Nom de la boutique tout en haut de l'étiquette.
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(12);
          doc.text('Africha Shop Hamiz', 50, 8, { align: 'center' });

          // Désignation sur deux lignes maximum, centrée, avec une taille fixe de 25 pt.
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(25);
          const nameText = String(product.name || '');
          const nameLines = doc.splitTextToSize(nameText, 88).slice(0, 2);
          doc.text(nameLines, 50, 30, { align: 'center', lineHeightFactor: 1.0 });

          // Largeur : taille réduite pour rester visuellement sous la désignation.
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(14);
          doc.text('LARGEUR : ' + data.width + ' mm', 8, 60);

          // Prix : 5 fois la taille initiale (60 pt), gras et italique.
          const priceText = 'PRIX : ' + data.price + ' DA / m²';
          doc.setFont('helvetica', 'bolditalic');
          let priceFontSize = 60;
          doc.setFontSize(priceFontSize);
          while (doc.getTextWidth(priceText) > 92 && priceFontSize > 30) {
            priceFontSize -= 1;
            doc.setFontSize(priceFontSize);
          }
          doc.text(priceText, 50, 79, { align: 'center' });

          // Mention des réseaux sociaux en bas, à la taille du nom de la boutique.
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(12);
          doc.text('FB/ INSTA : AFRICHA SHOP', 50, 97, { align: 'center' });
        }
      }
      // Téléchargement direct via Blob : évite l'ouverture d'une page PDF vide sur mobile.
      const pdfBlob = doc.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const downloadLink = document.createElement('a');
      downloadLink.href = pdfUrl;
      downloadLink.download = 'prix-moquette-mosquee-' + new Date().toISOString().slice(0, 10) + '.pdf';
      downloadLink.style.display = 'none';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
      setMessage('PDF Prix moquette mosquée prêt au téléchargement : ' + total + ' étiquette(s).');
    } catch (error) { window.alert('Erreur création PDF Prix moquette mosquée : ' + (error?.message || error)); }
    finally { setPdfBusy(false); }
  }

  function updateLabelLineQuantity(product, value) {
    const quantity = value === '' ? '' : Math.max(1, Math.min(500, Math.floor(Number(value) || 1)));
    setLabelLines((current) => current.map((line) =>
      String(line.id) === String(product.id) && line.catalog_source === product.catalog_source ? { ...line, quantity } : line
    ));
  }

  async function makePdf(kind, action = 'download') {
    if (pdfBusy) return;
    if (kind === 'invoice' && (!salesCustomer.trim() || salesLines.length === 0)) {
      window.alert('Saisissez le nom du client et ajoutez au moins un produit.');
      return;
    }
    const labelProducts = kind === 'labels' ? labelLines.filter((line) => Number(line.quantity) > 0) : [];
    const labelItems = kind === 'labels' ? labelProducts.flatMap((line) => Array.from({ length: Math.floor(Number(line.quantity)) }, () => line)) : [];
    if (kind === 'labels' && labelItems.length === 0) { window.alert('Choisissez au moins un produit et une quantité.'); return; }
    if (kind === 'labels' && labelItems.length > 500) { window.alert('Limite de sécurité : 500 étiquettes par document.'); return; }
    setPdfBusy(true);
    try {
      const { jsPDF } = await import('jspdf');
      let doc;
      if (kind === 'invoice') {
        const width = Number(printSettings.invoice_width_cm) * 10;
        const height = Number(printSettings.invoice_height_cm) * 10;
        doc = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'mm', format: [width, height] });
        const margin = Math.max(3, Math.min(8, width * 0.05));
        let y = margin + 3;
        const lineHeight = Math.max(4, Math.min(7, height / 18));
        doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.max(8, Math.min(15, width / 8)));
        doc.text('BON DE VENTE', margin, y); y += lineHeight * 1.2;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(Math.max(6, Math.min(10, width / 12)));
        doc.text('Date : ' + new Date().toLocaleDateString('fr-FR'), margin, y); y += lineHeight;
        doc.text('Client : ' + salesCustomer.trim().slice(0, 90), margin, y); y += lineHeight * 1.3;
        doc.setFont('helvetica', 'bold');
        doc.text('Produit', margin, y); doc.text('Qté', width * 0.59, y); doc.text('PU gros', width * 0.70, y); doc.text('Total', width - margin, y, { align: 'right' }); y += lineHeight;
        doc.line(margin, y - lineHeight * 0.55, width - margin, y - lineHeight * 0.55);
        doc.setFont('helvetica', 'normal');
        for (const line of salesLines) {
          if (y > height - margin - lineHeight * 2) {
            doc.addPage([width, height], width > height ? 'landscape' : 'portrait');
            y = margin + lineHeight;
          }
          const name = doc.splitTextToSize(String(line.name || ''), width * 0.40)[0] || '';
          doc.text(name, margin, y);
          doc.text(String(line.quantity), width * 0.59, y);
          doc.text(Number(line.wholesale_price || 0).toFixed(2), width * 0.70, y);
          doc.text((Number(line.quantity) * Number(line.wholesale_price || 0)).toFixed(2), width - margin, y, { align: 'right' });
          y += lineHeight;
        }
        y += lineHeight * 0.4; doc.line(margin, y - lineHeight * 0.55, width - margin, y - lineHeight * 0.55);
        doc.setFont('helvetica', 'bold'); doc.text('TOTAL : ' + salesTotal.toFixed(2) + ' DA', width - margin, Math.min(height - margin, y + lineHeight), { align: 'right' });
      } else {
        const width = Number(printSettings.label_width_cm) * 10;
        const height = Number(printSettings.label_height_cm) * 10;
        doc = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'mm', format: [width, height] });
        labelItems.forEach((product, index) => {
          if (index > 0) doc.addPage([width, height], width > height ? 'landscape' : 'portrait');
          const margin = 1.5;
          // Shop name at the top: regular weight, smaller than the product name.
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(Math.max(5, Math.min(6.5, width / 7.5)));
          doc.text('Africha SHOP', width / 2, Math.max(3.5, height * 0.15), { align: 'center' });
          // Product name in the middle: slightly larger and bold, centered.
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(Math.max(6.5, Math.min(9, width / 5.5)));
          const nameLines = doc.splitTextToSize(String(product.name || ''), width - margin * 2).slice(0, 3);
          const nameY = height * 0.47 - (nameLines.length > 1 ? (nameLines.length - 1) * 2 : 0);
          doc.text(nameLines, width / 2, nameY, { align: 'center', lineHeightFactor: 1.05 });
          // Retail price at the bottom: larger/bolder and with no decimal places.
          doc.setFontSize(16);
          const formattedRetailPrice = Math.round(Number(product.retail_price || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
          doc.text(formattedRetailPrice + ' DA', width / 2, height * 0.86, { align: 'center' });
        });
      }

      const now = new Date();
      const documentDate = now.toISOString().slice(0, 10);
      const documentTitle = kind === 'invoice' ? ('Bon - ' + salesCustomer.trim()) : 'Étiquettes prix';
      const savedItems = kind === 'invoice'
        ? salesLines.map((line) => ({ product_id: line.id, product_ref: line.product_ref || '', name: line.name || '', quantity: Number(line.quantity), unit_price: Number(line.wholesale_price || 0), line_total: Number(line.quantity) * Number(line.wholesale_price || 0) }))
        : labelProducts.map((product) => ({ product_id: product.id, product_ref: product.product_ref || '', name: product.name || '', retail_price: Number(product.retail_price || 0), quantity: Math.floor(Number(product.quantity)) }));
      const total = kind === 'invoice' ? salesTotal : labelItems.length;
      const { error: saveError } = await supabase.from('app_pdf_documents').insert({
        doc_type: kind,
        title: documentTitle.slice(0, 160),
        customer_name: kind === 'invoice' ? salesCustomer.trim().slice(0, 160) : null,
        document_date: documentDate,
        items: savedItems,
        total: Number(total),
        created_by: user.id,
      });
      if (saveError) throw new Error('Le PDF n’a pas été enregistré dans l’historique : ' + saveError.message);
      await loadSavedPdfDocuments();

      const filename = (kind === 'invoice' ? 'bon-de-vente' : 'etiquettes-prix') + '-' + documentDate + '.pdf';
      const blob = doc.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (action === 'share' && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: kind === 'invoice' ? 'Bon de vente' : 'Étiquettes prix' });
      } else {
        doc.save(filename);
        if (action === 'share') window.alert('Le partage direct n’est pas disponible sur cet appareil : le PDF a été téléchargé pour que vous puissiez le partager.');
      }
      setMessage('Document enregistré dans l’historique et PDF préparé.');
    } catch (error) {
      window.alert('Erreur création/enregistrement PDF : ' + (error?.message || error));
    } finally { setPdfBusy(false); }
  }

  useEffect(() => {
    if (!scannerTarget) return undefined;
    let stream, animationFrame, stopped = false, lastScannedValue = '', lastSeenAt = 0;
    const cleanup = () => { stopped = true; if (animationFrame) cancelAnimationFrame(animationFrame); if (stream) stream.getTracks().forEach((track) => track.stop()); if (scannerVideoRef.current) scannerVideoRef.current.srcObject = null; };
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Caméra indisponible. Utilisez HTTPS ou l’APK.');
        if (!('BarcodeDetector' in window)) throw new Error('Lecture QR native non prise en charge. Mettez à jour Chrome / Android System WebView.');
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) { stream.getTracks().forEach((track) => track.stop()); return; }
        const video = scannerVideoRef.current; if (!video) return;
        video.srcObject = stream; await video.play(); setScannerStatus('Placez le QR dans le cadre.');
        const scan = async () => {
          if (stopped) return;
          try {
            if (video.readyState >= 2) {
              const results = await detector.detect(video), value = results?.[0]?.rawValue?.trim();
              if (value) {
                lastSeenAt = Date.now();
                if (value !== lastScannedValue) {
                  lastScannedValue = value;
                  const product = catalogProducts.find((item) => String(item.reference_1 || '').trim() === value);
                  if (product) {
                    if (scannerTarget === 'sales') {
                      setSalesLines((current) => {
                        const exists = current.some((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source);
                        return exists ? current.map((line) => String(line.id) === String(product.id) && line.catalog_source === product.catalog_source ? { ...line, quantity: Number(line.quantity || 0) + 1 } : line) : [...current, { ...product, quantity: 1 }];
                      });
                      setSalesSearch('');
                      setScannerStatus('Produit ajouté : ' + product.name + '. Caméra arrêtée.');
                      setScannerTarget(null);
                      return;
                    } else {
                      setSearchTerm(product.name); setCurrentPage(1);
                      setScannerStatus('Produit trouvé : ' + product.name); setScannerTarget(null); return;
                    }
                  } else {
                    setScannerStatus('Aucun produit associé à ce QR : ' + value);
                  }
                }
              } else if (lastScannedValue && Date.now() - lastSeenAt > 800) {
                lastScannedValue = '';
              }
            }
          } catch (error) { setScannerStatus('Lecture en cours…'); }
          animationFrame = requestAnimationFrame(scan);
        };
        scan();
      } catch (error) { setScannerStatus(error?.message || 'Impossible de démarrer la caméra.'); }
    };
    start(); return cleanup;
  }, [scannerTarget, catalogProducts]);


  async function loadTapisTickets() {
    const {data,error}=await supabase.from('tapis_ticket_catalog').select('id,type,denomination,dimension,dessin,couleur,code_barres,created_at').order('created_at',{ascending:false}).limit(500);
    if(error) setTicketMessage('Erreur : '+error.message); else setTapisTickets(data||[]);
  }
  async function readTapisTicket(file) {
    if (!file) return;
    if (ticketPhoto && ticketPhoto.startsWith('blob:')) URL.revokeObjectURL(ticketPhoto);
    const photoUrl = URL.createObjectURL(file);
    setTicketPhoto(photoUrl);
    setTicketBusy(true);
    setTicketMessage('قراءة سريعة للتيكي…');
    try {
      if (!window.Tesseract) await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Impossible de charger le moteur OCR.'));
        document.head.appendChild(script);
      });

      const img = new Image();
      img.src = photoUrl;
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

      // Read both landscape orientations. Upscale before OCR; keep a clean
      // grayscale image instead of applying an aggressive global threshold.
      const makeVariant = (rotation) => {
        const swap = Math.abs(rotation) === 90;
        const scale = Math.min(3, 2400 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round((swap ? img.height : img.width) * scale);
        canvas.height = Math.round((swap ? img.width : img.height) * scale);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.drawImage(img, -img.width * scale / 2, -img.height * scale / 2, img.width * scale, img.height * scale);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const gray = 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2];
          const adjusted = Math.max(0, Math.min(255, (gray - 118) * 1.28 + 128));
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = adjusted;
        }
        ctx.putImageData(pixels, 0, 0);
        return canvas;
      };

      // Fast first pass. Retry one rotated orientation only when the first
      // pass is too weak, avoiding six expensive OCR runs on every phone photo.
      const runOcr = async (canvas) => window.Tesseract.recognize(canvas, 'eng', {
        logger: () => {},
        tessedit_pageseg_mode: 6,
        preserve_interword_spaces: 1
      });
      let firstResult = await runOcr(makeVariant(0));
      let firstText = String(firstResult.data.text || '').toUpperCase().replace(/[–—]/g, '-');
      let chosenResult = firstResult;
      let chosenText = firstText;
      const firstConfidence = Number(firstResult.data.confidence) || 0;
      if (firstConfidence < 48 || firstText.trim().length < 35) {
        const retryResult = await runOcr(makeVariant(img.width > img.height ? -90 : 90));
        const retryText = String(retryResult.data.text || '').toUpperCase().replace(/[–—]/g, '-');
        if ((Number(retryResult.data.confidence) || 0) > firstConfidence || retryText.length > firstText.length) {
          chosenResult = retryResult;
          chosenText = retryText;
        }
      }
      const combinedText = chosenText;
      if (!combinedText.trim()) throw new Error('لم أستطع قراءة النص من الصورة. جرّب صورة أوضح.');
      const modelHint = String(ticketModel || '').trim().toUpperCase();
      // The selected model is kept as context for the current batch. It is
      // deliberately not written into Type or any other ticket field.
      if (modelHint && !combinedText.includes(modelHint)) {
        setTicketMessage('نقرأ التيكي مع اعتماد المودال ' + modelHint + ' كمرجع…');
      }

      const clean = value => String(value || '').toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9%+./: x×-]/g, ' ').replace(/\s+/g, ' ').trim();
      const lines = combinedText.split(/\r?\n/).map(clean).filter(Boolean);
      const allText = clean(combinedText);
      const findValueAfterLabel = (labels, validator) => {
        const labelRe = new RegExp('\\b(?:' + labels.join('|') + ')\\b', 'i');
        for (let i = 0; i < lines.length; i++) {
          if (!labelRe.test(lines[i])) continue;
          const sameLine = lines[i].replace(labelRe, '').replace(/^[: -]+/, '').trim();
          if (sameLine && validator(sameLine)) return validator(sameLine);
          for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
            if (/^(TYPE|DENOMINATION|DIMENSION|DESSIN|COULEUR|COMPOSITION|REFERENCE)/.test(lines[j])) break;
            const candidate = validator(lines[j]);
            if (candidate) return candidate;
          }
        }
        return '';
      };

      const dimensionMatch = allText.match(/\bT?\s*\d{2,3}\s*[X×]\s*\d{2,3}\s*(?:CM)?\b/);
      const dimension = dimensionMatch ? dimensionMatch[0].replace(/^T\s*/i, '').replace(/\s*CM$/i, '').replace(/\s/g, '').replace(/[X×]/g, 'x') : '';
      const dessin = findValueAfterLabel(['DESSIN', 'DESIGN'], value => {
        const m = value.match(/\b[A-Z0-9]{3,10}\b/);
        return m ? m[0] : '';
      });
      const couleur = findValueAfterLabel(['COULEUR', 'COLOR'], value => {
        const v = value.replace(/^(?:COULEUR|COLOR)\s*/i, '').trim();
        if (!v || /^(TYPE|DESSIN|DIMENSION|DENOMINATION)/.test(v)) return '';
        const m = v.match(/\b(?:BORDEAUX|BEIGE|GRIS|NOIR|BLANC|ROUGE|BLEU|VERT|MARRON|CREME|IVOIRE|TAUPE|MULTICOLORE|ANTHRACITE)\b/);
        return m ? m[0] : (/^[A-Z][A-Z -]{2,20}$/.test(v) ? v : '');
      });
      const denomination = /\bTAPIS\b/.test(allText) ? 'TAPIS' : findValueAfterLabel(['DENOMINATION', 'DESIGNATION'], value => {
        const m = value.match(/\bTAPIS\b|\bENSEMBLE\b/);
        return m ? m[0] : '';
      });

      // On this label TEPIDOR is the brand; SAHAR immediately following it
      // is the product type. Never mistake the brand itself for Type.
      let type = '';
      for (let i = 0; i < lines.length; i++) {
        if (/\bTEPIDOR\b/.test(lines[i])) {
          for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
            const candidate = lines[j].match(/\b(SAHAR|SILKAR|ECLAT|MANISA)\b/);
            if (candidate) { type = candidate[1]; break; }
          }
          if (type) break;
        }
      }
      if (!type) {
        const knownType = allText.match(/\b(SAHAR|SILKAR|ECLAT|MANISA)\b/);
        type = knownType ? knownType[1] : '';
      }

      const codeCandidates = [...new Set((combinedText.match(/\d[\d\s]{8,18}\d/g) || [])
        .map(x => x.replace(/\s/g, '')).filter(x => /^\d{10,14}$/.test(x)))];
      const code = codeCandidates.sort((a, b) => b.length - a.length)[0] || '';

      setTicketDraft({
        type,
        denomination,
        dimension,
        dessin,
        couleur,
        code_barres: code
      });
      const found = [type, denomination, dimension, dessin, couleur, code].filter(Boolean).length;
      setTicketMessage('تمت القراءة السريعة: ' + found + '/6 خانات' + (modelHint ? ' — المودال: ' + modelHint : '') + '. راجع القيم قبل الحفظ.');
    } catch (e) {
      setTicketMessage(e.message || 'تعذرت قراءة الصورة؛ يمكنك إدخال المعلومات يدوياً.');
    } finally {
      setTicketBusy(false);
    }
  }
  async function saveTapisTicket() {
    const v=Object.fromEntries(Object.entries(ticketDraft).map(([k,x])=>[k,String(x||'').trim()]));
    if(Object.values(v).some(x=>!x)){setTicketMessage('أكمل جميع الخانات.');return;}
    if(!/^\d{10,14}$/.test(v.code_barres)){setTicketMessage('رقم التعريف العمودي يجب أن يكون من 10 إلى 14 رقماً.');return;}
    const {data:old,error:check}=await supabase.from('tapis_ticket_catalog').select('id').eq('code_barres',v.code_barres).maybeSingle();
    if(check){setTicketMessage('تعذر التحقق: '+check.message);return;}
    if(old){setTicketMessage('هذا التيكي مسجل من قبل، لم تتم إضافة تكرار.');return;}
    const {error}=await supabase.from('tapis_ticket_catalog').insert({...v,created_by:user.id,source_label:'image'});
    if(error){setTicketMessage('فشل الحفظ: '+error.message);return;}
    // The image is processed locally only; after the database confirms the
    // text fields were saved, release the preview URL and clear the file input.
    if(ticketPhoto && ticketPhoto.startsWith('blob:')) URL.revokeObjectURL(ticketPhoto);
    setTicketPhoto('');
    if(ticketFileRef.current) ticketFileRef.current.value='';
    setTicketDraft({type:'',denomination:'',dimension:'',dessin:'',couleur:'',code_barres:''});
    setTicketMessage('تم حفظ المعلومات بنجاح وحذف الصورة المؤقتة من الجهاز.');
    await loadTapisTickets();
  }

  function navigateTo(page) {
    setScannerTarget(null);
    setActivePage(page);
    setCurrentPage(1);
    setSearchTerm('');
    setTableSearch('');
    if (page === 'hidden') loadHiddenProducts();
    if (page === 'analysis') {
      loadSuggestedProducts();
      loadStockDecreaseAnalysis();
    }
    if (page === 'alerts') {
      loadSuggestedProducts();
      loadTapisSuggestedProducts();
    }
    if (page === 'statistics') {
      loadStockDecreaseAnalysis();
      loadTapisStockDecreaseAnalysis();
    }
    if (page === 'tapis-analysis') { loadTapisSuggestedProducts(); loadTapisStockDecreaseAnalysis(); }
    if (page === 'tapis') loadTapisTickets();
    if (page === 'history' && canViewPage('history')) loadStockHistory();
    if (page === 'requests') loadReplenishmentRequests();
    if (page === 'notes') loadProductNotes();
    if (page === 'settings' && user?.profile?.role === 'admin') {
      loadSuggestions();
      loadAccountPermissions();
      loadPrintSettings();
    }
    if (page === 'photos' || page === 'sales') loadProductPhotos();
    if (page === 'sales' || page === 'labels') loadSavedPdfDocuments();
  }

  const navItems = [
    {
      id: 'dashboard',
      label: language === 'ar' ? 'لوحة التحكم' : 'Tableau de bord',
      icon: '⌂',
      adminOnly: true,
    },
    {
      id: 'imports',
      label: language === 'ar' ? 'الاستيراد والمراقبة' : 'Imports et contrôle',
      icon: '⇧',
      adminOnly: true,
    },
    {
      id: 'alerts',
      label: language === 'ar' ? 'تنبيهات المخزون' : 'Alertes de stock',
      icon: '⚑',
      admin: true,
    },
    {
      id: 'statistics',
      label: language === 'ar' ? 'الإحصائيات' : 'Statistiques',
      icon: '▥',
      admin: true,
    },
    {
      id: 'products',
      label: language === 'ar' ? 'جميع المنتجات' : 'Tous les produits',
      icon: '▦',
    },
    {
      id: 'analysis',
      label: language === 'ar' ? 'Analyse Linge' : 'Analyse Linge',
      icon: '⌁',
      admin: true,
    },
    { id: 'tapis', label: 'Tapis', icon: '▧', adminOnly: true },
    { id: 'mosque-simulation', label: 'Simulation mosquée', icon: '▦', adminOnly: true },
    {
      id: 'tapis-analysis',
      label: language === 'ar' ? 'Analyse Tapis' : 'Analyse Tapis',
      icon: '▧',
      admin: true,
    },
    {
      id: 'ai-analysis',
      label: language === 'ar' ? 'التحليل الذكي' : 'Analyse intelligente',
      icon: '✧',
      admin: true,
    },
    {
      id: 'chora-matelas',
      label: language === 'ar' ? 'Chora & Matelas' : 'Chora & Matelas',
      icon: '▤',
    },
    { id: 'sales', label: 'Bon de vente', icon: '▧' },
    { id: 'labels', label: 'Étiquettes prix', icon: '▤' },
    { id: 'barcode', label: 'Code à barre', icon: '▦' },
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
  const canViewPage = (pageId) => pageId === 'tapis' ? isAdmin : isAdmin || (['sales', 'labels', 'barcode'].includes(pageId) ? pagePermissions[pageId] === true : pagePermissions[pageId] === true || (!navItems?.find?.((item) => item.id === pageId)?.admin && !navItems?.find?.((item) => item.id === pageId)?.adminOnly && pagePermissions[pageId] !== false));
  const normalizeName = (value) =>
    String(value || '')
      .toLocaleUpperCase('fr')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]/g, '');
  const matchesTableSearch = (query, ...values) => {
    const tokens = String(query || '').toLocaleUpperCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Z0-9]+/).filter(Boolean);
    if (!tokens.length) return true;
    const words = values.join(' ').toLocaleUpperCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Z0-9]+/).filter(Boolean);
    return tokens.every((token) => words.some((word) => word.startsWith(token) || word.includes(token)));
  };
  const pageProducts = (activePage === 'products' ? catalogProducts : products).filter((product) => {
    const normalizedName = normalizeName(product.name);
    const searchTokens = String(searchTerm || '').toLocaleUpperCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Z0-9]+/).filter(Boolean);
    const nameTokens = String(product.name || '').toLocaleUpperCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Z0-9]+/).filter(Boolean);
    const searchMatch = !searchTokens.length || searchTokens.every((token) =>
      nameTokens.some((word) => word.startsWith(token) || word.includes(token))
    );
    const isArina = normalizedName.includes('EUROPARINA') || (normalizedName.includes('EUROP') && normalizedName.includes('ARINA'));
    const isChora = normalizedName.includes('CHORA');
    const isVoilage = normalizedName.includes('VOILAGE');
    const isRideau = normalizedName.includes('RIDEAU') && !normalizedName.includes('CUISINE');
    const pageMatch =
      activePage === 'arina' ? isArina :
      activePage === 'textiles' ? (isChora || isVoilage || isRideau) : true;
    const canSeeZeroNegativeOnArina =
      activePage === 'arina' &&
      showArinaZeroStock &&
      (isAdmin || Boolean(user?.profile?.can_view_zero_negative_products));
    const inactiveArinaAllowed =
      activePage === 'arina' &&
      showArinaZeroStock &&
      (isAdmin || Boolean(user?.profile?.can_view_zero_negative_products)) &&
      product.is_active === false &&
      Number(product.current_quantity) === 0;
    const stockAllowed =
      Number(product.current_quantity) > 0 ||
      activePage === 'products' ||
      (isAdmin && activePage !== 'arina') ||
      canSeeZeroNegativeOnArina;
    const activeAllowed = product.is_active !== false || inactiveArinaAllowed;
    // Les produits absents du dernier PDF doivent rester visibles :
    // leur quantité affichée est déjà ramenée à 0 dans loadProducts().
    return searchMatch && pageMatch && activeAllowed && stockAllowed;
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
  const africhaSortedProducts = products.filter((product) => {
    const normalized = normalizeName(product.name);
    const tokens = String(searchTerm || '').toLocaleUpperCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Z0-9]+/).filter(Boolean);
    const words = String(product.name || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Z0-9]+/).filter(Boolean);
    const isAfrichaShop = normalized.includes('AFRICHASHOP') || (normalized.includes('AFRICHA') && normalized.includes('SHOP'));
    const match = isAfrichaShop && (!tokens.length || tokens.every((token)=>words.some((word)=>word.startsWith(token)||word.includes(token))));
    return match && (Number(product.current_quantity) > 0 || (showArinaZeroStock && (isAdmin || Boolean(user?.profile?.can_view_zero_negative_products))));
  }).sort((a,b)=>{
    const av=a[sortKey], bv=b[sortKey];
    const numeric=['current_quantity','wholesale_price','retail_price'].includes(sortKey);
    const cmp=numeric ? Number(av||0)-Number(bv||0) : String(av??'').localeCompare(String(bv??''),'fr',{numeric:true,sensitivity:'base'});
    return sortDirection==='asc'?cmp:-cmp;
  });
  const africhaTotalPages = Math.max(1, Math.ceil(africhaSortedProducts.length / pageSize));
  const africhaPageProducts = africhaSortedProducts.slice((Math.min(currentPage,africhaTotalPages)-1)*pageSize, Math.min(currentPage,africhaTotalPages)*pageSize);
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

  const negativeTapisProducts = (catalogProducts || [])
    .filter((product) => product.catalog_source === 'tapis_products' && Number(product.current_quantity) < 0)
    .sort((a, b) => String(a.product_ref || '').localeCompare(String(b.product_ref || ''), 'fr', { numeric: true }));

  const activeRequests = replenishmentRequests.filter(
    (request) => !request.archived_at
  );
  const archivedRequests = replenishmentRequests.filter((request) =>
    Boolean(request.archived_at)
  );
  const newRequestsCount = activeRequests.filter(
    (request) => request.status === 'new'
  ).length;

  const visibleNavItems = navItems
    .filter((item) => item.id !== 'tapis' || isAdmin)
    .filter((item) => (!item.admin || isAdmin || pagePermissions[item.id] === true) && (!item.adminOnly || isAdmin || pagePermissions[item.id] === true))
    .filter((item) => !hiddenPages.includes(item.id))
    .filter((item) => isAdmin || pagePermissions[item.id] !== false)
    .filter((item) => isAdmin || !['sales', 'labels', 'barcode'].includes(item.id) || pagePermissions[item.id] === true)
    .sort((a, b) => {
      if (a.id === 'dashboard') return -1;
      if (b.id === 'dashboard') return 1;
      if (a.id === 'imports') return -1;
      if (b.id === 'imports') return 1;
      const ai = pageOrder.indexOf(a.id); const bi = pageOrder.indexOf(b.id);
      if (ai < 0 && bi < 0) return navItems.findIndex(x => x.id === a.id) - navItems.findIndex(x => x.id === b.id);
      if (ai < 0) return 1; if (bi < 0) return -1; return ai - bi;
    });
  const activePageTitle =
    navItems.find((item) => item.id === activePage)?.label || 'Africha Hamiz Assistant';
  const lastStockUpdate = stockHistory[0]?.created_at;
  const newRequests = activeRequests.filter(
    (request) => request.status === 'new'
  );
  const urgentNewRequests = newRequests.filter((request) => request.is_urgent);
  const tableSortButtonStyle = { border: 0, padding: 0, background: 'transparent', color: 'inherit', font: 'inherit', fontWeight: 700, cursor: 'pointer', textAlign: 'inherit' };
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
            {product.catalog_source !== 'tapis_products' && <button style={styles.secondary} onClick={() => adjustStock(product)}>{language === 'ar' ? 'تعديل المخزون' : 'Modifier stock'}</button>}
            <button style={styles.secondary} onClick={() => hideProduct(product)}>{language === 'ar' ? 'إخفاء' : 'Masquer'}</button>
          </>
        ) : product.catalog_source === 'tapis_products' ? (
          <span className="ls-muted">Consultation uniquement</span>
        ) : user?.profile?.role === 'trader' && (activePage === 'arina' || (activePage === 'chora-matelas' && (normalizeName(product.name).includes('EUROP') || normalizeName(product.name).includes('AFRICHA')))) ? (
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
    const hideProductActionColumn = activePage === 'products' && ['trader', 'viewer'].includes(String(user?.profile?.role || '').trim().toLowerCase());
    const catalogCell = { ...styles.td, fontSize: hideProductActionColumn ? 14 : undefined };
    if (!paginatedProducts.length)
      return (
        <tr>
          <td
            colSpan={hideProductActionColumn ? 4 : 5}
            style={{ ...catalogCell, textAlign: 'center', color: '#64748b' }}
          >
            Aucun produit trouvé.
          </td>
        </tr>
      );
    return paginatedProducts.map((product) => (
      <tr key={`${product.catalog_source || 'products'}:${product.id || product.product_ref}`}>
        
        <td style={{ ...catalogCell, fontSize: hideProductActionColumn ? 15 : undefined }}>
          <span style={{display:'inline-flex',alignItems:'center',gap:8}}>
            {activePage === 'textiles' && product.catalog_source !== 'tapis_products' && photoFor(product.id) ? <img src={photoFor(product.id)} alt="" onClick={()=>setPhotoPreview({url:photoFor(product.id),name:product.name})} style={{width:38,height:38,objectFit:'cover',borderRadius:6,cursor:'zoom-in'}}/> : null}
            <span style={{ fontWeight: activePage === 'products' ? 700 : undefined }}>{product.name}{activePage === 'products' && product.catalog_source === 'tapis_products' ? <small style={{display:'inline-block',marginInlineStart:8,padding:'2px 7px',borderRadius:6,background:'#eef2ff',color:'#475569',fontSize:11,fontWeight:700}}>Tapis</small> : null}{activePage === 'arina' && normalizeName(product.name).includes('AFRICHA') ? <small style={{display:'block',color:'#64748b'}}>Africha Shop</small> : activePage === 'arina' ? <small style={{display:'block',color:'#64748b'}}>Europ Arina</small> : null}</span>
          </span>
        </td>
        <td
          style={{
            ...catalogCell,
            width: hideProductActionColumn ? '10%' : undefined,
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
        {!hideProductActionColumn && <td style={catalogCell}>{productActions(product)}</td>}
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
          <article key={`${product.catalog_source || 'products'}:${product.id || product.product_ref}`} style={styles.card}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#64748b', fontSize: 12 }}>
                Réf. {product.product_ref}
              </div>
              <strong style={{display:'flex',alignItems:'center',gap:8}}>{activePage === 'textiles' && product.catalog_source !== 'tapis_products' && photoFor(product.id) ? <img src={photoFor(product.id)} alt="" onClick={()=>setPhotoPreview({url:photoFor(product.id),name:product.name})} style={{width:42,height:42,objectFit:'cover',borderRadius:6,cursor:'zoom-in'}}/> : null}{product.name}{activePage === 'products' && product.catalog_source === 'tapis_products' ? <small style={{marginInlineStart:8,padding:'2px 7px',borderRadius:6,background:'#eef2ff',color:'#475569',fontSize:11}}>Tapis</small> : null}</strong>
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
      className={`ls-app ${typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() ? 'ls-native' : 'ls-web'} ${theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'ls-dark' : ''}`}
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      <style>{`
        .ls-app{--ls-card:#fff;--ls-card-soft:#f8fafc;--ls-border:#e2e8f0;--ls-text:#102b46;--ls-text-muted:#64748b;--ls-table-head:#f1f5f9;--ls-table-line:#edf1f5}
        .ls-dark{--ls-card:#182431;--ls-card-soft:#223242;--ls-border:#405266;--ls-text:#e7edf4;--ls-text-muted:#bdc9d6;--ls-table-head:#263747;--ls-table-line:#334456}
        *{box-sizing:border-box} body{margin:0;background:#f3f6fa;font-family:Inter,Arial,sans-serif;color:#102b46}
        .ls-app{min-height:100vh;background:#f3f6fa;color:#102b46}.ls-login{max-width:440px;margin:7vh auto;padding:30px;background:#fff;border:1px solid #e2e8f0;border-radius:20px;box-shadow:0 15px 45px rgba(16,43,70,.09)}
        .ls-brand{display:flex;align-items:center;gap:12px}.ls-brand-mark{display:grid;place-items:center;background:#fff;color:#102b46;border-radius:12px;width:42px;height:42px;font-weight:900;font-size:19px}.ls-layout{display:grid;grid-template-columns:250px minmax(0,1fr);min-height:100vh}.ls-sidebar{background:#102b46;color:#fff;padding:22px 14px;display:flex;flex-direction:column;gap:20px}.ls-nav{display:flex;flex-direction:column;gap:5px}.ls-nav button{display:flex;gap:11px;align-items:center;width:100%;border:0;border-radius:10px;padding:12px;color:#d8e4f1;background:transparent;text-align:left;cursor:pointer;font-weight:600}.ls-nav button.active,.ls-nav button:hover{background:#214361;color:#fff}.ls-nav .ls-count{margin-left:auto;background:#e5484d;color:white;border-radius:20px;padding:2px 7px;font-size:11px}.ls-main{min-width:0;padding:26px clamp(14px,3vw,34px) 50px}.ls-topbar{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:24px}.ls-panel{background:white;border:1px solid #e2e8f0;border-radius:14px;padding:18px;margin-bottom:18px;min-width:0}.ls-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}.ls-stat{padding:18px;background:white;border:1px solid #e2e8f0;border-radius:14px}.ls-stat small{display:block;color:#64748b;margin-bottom:8px}.ls-stat strong{font-size:25px}.ls-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0 16px}.ls-search{flex:1;min-width:200px}.ls-table-wrap{width:100%;overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px}.ls-table{width:100%;border-collapse:collapse;min-width:850px;background:white}.ls-products-readonly-table th{font-size:13px!important}.ls-products-readonly-table td{font-size:14px}.ls-table th button{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:0}.ls-actions{display:flex;gap:7px;flex-wrap:wrap}.ls-actions button{font-size:12px;padding:8px 9px}.ls-pagination{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px}.ls-product-cards{display:none}.ls-photo-placeholder{width:78px;height:78px;display:grid;place-items:center;border-radius:10px;background:#edf2f7;color:#9aaabd;font-weight:900}.ls-card-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:16px 0}.ls-card-metrics>div{background:#f5f8fb;border-radius:9px;padding:10px;min-width:0}.ls-card-metrics small{display:block;color:#64748b;font-size:11px;margin-bottom:5px}.ls-card-metrics strong{font-size:13px;overflow-wrap:anywhere}.ls-alert{padding:12px 14px;border-radius:10px;background:#fff2e0;color:#9a4b00;border:1px solid #ffddb0;margin:12px 0}.ls-message{padding:12px 14px;background:#eaf2ff;border:1px solid #cbdcf5;border-radius:10px;margin-bottom:16px;overflow-wrap:anywhere}.ls-request{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:14px 0;border-top:1px solid #edf1f5}.ls-muted{color:#64748b;font-size:13px}.ls-photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}.ls-photo-grid img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;background:#f1f5f9}.ls-input-row{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end}.ls-footer-note{color:#8ba0b5;font-size:12px;line-height:1.5;margin-top:auto;padding:8px}
        .ls-app .ls-muted{color:#526477}.ls-app h1,.ls-app h2,.ls-app h3,.ls-app strong{color:inherit}.ls-app section,.ls-app article{color:#102b46}.ls-app .ls-panel strong{color:inherit}.ls-app .ls-panel h2,.ls-app .ls-panel h3{color:#102b46}.ls-app .ls-panel .ls-muted{color:#475569}.ls-import-panel{background:#ffffff!important;color:#102b46!important}.ls-import-panel h2,.ls-import-panel strong,.ls-import-panel .ls-muted{color:#243b53!important}.ls-dark .ls-import-panel{background:#182431!important;color:#e7edf4!important}.ls-dark .ls-import-panel h2,.ls-dark .ls-import-panel strong,.ls-dark .ls-import-panel .ls-muted{color:#e7edf4!important}.ls-dark{background:#101820!important;color:#e7edf4!important}.ls-dark .ls-panel h2,.ls-dark .ls-panel h3{color:#e7edf4!important}.ls-dark .ls-panel,.ls-dark .ls-panel strong,.ls-dark .ls-panel label{color:#e7edf4!important}.ls-dark .ls-panel [style*='background: rgb(245, 248, 251)'],.ls-dark .ls-panel [style*='background: rgb(245, 248, 251)']{background:#223242!important;color:#e7edf4!important}.ls-dark .ls-app .ls-muted{color:#bdc9d6!important}.ls-dark .ls-main,.ls-dark .ls-panel,.ls-dark .ls-stat,.ls-dark .ls-table,.ls-dark .ls-login{background:#182431!important;color:#e7edf4!important;border-color:#334456!important}.ls-dark .ls-table-wrap{border-color:#334456!important}.ls-dark .ls-app,.ls-dark .ls-panel,.ls-dark .ls-stat,.ls-dark .ls-table,.ls-dark .ls-login{color:#e7edf4!important}.ls-dark .ls-panel [style*='background: rgb(245, 248, 251)'],.ls-dark .ls-panel [style*='background: rgb(255, 255, 255)'],.ls-dark .ls-panel [style*='background: white']{background:#223242!important;color:#e7edf4!important}.ls-dark .ls-panel .ls-muted{color:#bdc9d6!important}.ls-dark [style*='background: rgb(245, 248, 251)'],.ls-dark [style*='background: rgb(255, 255, 255)'],.ls-dark [style*='background: white']{background:#182431!important;color:#e7edf4!important}.ls-dark .ls-alert{background:#3b2b19!important;color:#ffd7a8!important}.ls-dark .ls-table td,.ls-dark .ls-table th,.ls-dark article{border-color:#334456!important;color:#e7edf4}.ls-dark .ls-table td[style*='#102b46']{color:#e7edf4!important}.ls-dark .ls-table td[style*='color: rgb(16, 43, 70)'],.ls-dark .ls-table td[style*='color: #102b46']{color:#e7edf4!important}.ls-dark .ls-table td[style*='color: rgb(180, 35, 24)'],.ls-dark .ls-table td[style*='color: #b42318']{color:#ff9b9b!important}.ls-dark .ls-card-metrics strong[style*='#102b46']{color:#e7edf4!important}.ls-dark input,.ls-dark select,.ls-dark textarea{background:#111b25!important;color:#e7edf4!important;border-color:#405266!important}.ls-dark .ls-card-metrics>div,.ls-dark [style*="background: rgb(245, 248, 251)"],.ls-dark [style*="background: rgb(245, 248, 251)"]{background:#223242!important;color:#e7edf4!important}.ls-dark .ls-muted{color:#a9b8c8!important}.ls-dark .ls-message{background:#20344a!important;color:#e7edf4!important;border-color:#405266!important}
        @media(max-width:1050px){.ls-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ls-layout{grid-template-columns:215px minmax(0,1fr)}}
        @media(max-width:760px){.stock-decrease-table{width:100%;min-width:0!important;table-layout:fixed}.stock-decrease-table th{font-size:10px!important;line-height:1.15;white-space:normal;overflow-wrap:anywhere;padding:7px 3px!important}.stock-decrease-table td{padding:8px 3px!important;text-align:center}.stock-decrease-table th:nth-child(1),.stock-decrease-table td:nth-child(1){width:7%}.stock-decrease-table th:nth-child(2),.stock-decrease-table td:nth-child(2){width:25%}.stock-decrease-table th:nth-child(3),.stock-decrease-table td:nth-child(3),.stock-decrease-table th:nth-child(4),.stock-decrease-table td:nth-child(4),.stock-decrease-table th:nth-child(5),.stock-decrease-table td:nth-child(5){width:11%}.stock-decrease-table th:nth-child(6),.stock-decrease-table td:nth-child(6),.stock-decrease-table th:nth-child(7),.stock-decrease-table td:nth-child(7){width:15%}.stock-decrease-table th:nth-child(8),.stock-decrease-table td:nth-child(8){width:9%}.stock-decrease-designation{font-size:16px!important;font-weight:700;line-height:1.2;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:break-word;word-break:normal}.ls-layout{display:block}.ls-sidebar{position:sticky;top:0;z-index:10;padding:10px 12px;gap:10px}.ls-sidebar-head{display:flex;justify-content:space-between;align-items:center}.ls-nav{flex-direction:row;overflow-x:auto;gap:6px;padding-bottom:2px;scrollbar-width:thin}.ls-nav button{white-space:nowrap;width:auto;flex-shrink:0;padding:10px 12px;font-size:12px}.ls-nav button .ls-nav-text{display:inline}.ls-footer-note{display:none}.ls-main{padding:16px 12px 38px}.ls-topbar{align-items:flex-start;flex-direction:column;margin-bottom:16px}.ls-topbar-actions{width:100%;display:flex;gap:8px;flex-wrap:wrap}.ls-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.ls-stat{padding:13px}.ls-stat strong{font-size:21px}.ls-table-wrap:not(.ls-force-table){display:none}.ls-product-cards{display:grid;grid-template-columns:1fr;gap:12px}.ls-panel{padding:13px}.ls-input-row{grid-template-columns:1fr}.ls-request{grid-template-columns:1fr}.ls-actions button{flex:1}.ls-login{margin:5vh 14px;padding:22px}.ls-card-metrics{gap:6px}.ls-card-metrics>div{padding:8px}.ls-card-metrics strong{font-size:12px}}

        /* Soft Editorial refresh — isolated to the preview branch */
        .ls-app{background:#f7f6f2;color:#2a2f38;font-family:Inter,Arial,sans-serif}
        .ls-layout{background:#f7f6f2;grid-template-columns:252px minmax(0,1fr)}
        .ls-sidebar{background:#fff;color:#2a2f38;border:1px solid #ebe9e3;border-radius:22px;margin:16px 0 16px 16px;padding:22px 14px;box-shadow:0 8px 28px rgba(43,48,58,.045)}
        .ls-brand-mark{background:#e8e2f4;color:#3e6fd8;border-radius:14px}
        .ls-sidebar .ls-brand strong{color:#2a2f38}
        .ls-sidebar .ls-brand div div{color:#81858d!important}
        .ls-nav button{color:#5f6570;border-radius:12px;padding:12px 11px}
        .ls-nav button.active,.ls-nav button:hover{background:#e8e2f4;color:#345fc0}
        .ls-nav .ls-count{background:#e6854c;color:#fff}
        .ls-main{padding:28px clamp(18px,3vw,42px) 52px}
        .ls-topbar{margin-bottom:28px}
        .ls-topbar h1{color:#2a2f38;letter-spacing:-.6px}
        .ls-panel,.ls-stat,.ls-login{background:#fff;border:1px solid #ebe9e3;border-radius:18px;box-shadow:0 7px 24px rgba(43,48,58,.035)}
        .ls-dashboard-stats{grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:26px}
        .ls-stat-clickable{appearance:none;text-align:left;font:inherit;color:inherit;cursor:pointer;min-height:178px;aspect-ratio:1.08/1;padding:20px;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
        .ls-stat-clickable:hover{transform:translateY(-3px);box-shadow:0 12px 28px rgba(43,48,58,.09);border-color:#d8d1e8}
        .ls-stat-icon,.ls-shortcut-icon{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;font-size:21px;font-weight:800}
        .ls-icon-lavender{background:#e8e2f4;color:#3e6fd8}
        .ls-icon-peach{background:#f9e7da;color:#d87943}
        .ls-icon-sage{background:#e0ebe2;color:#568c69}
        .ls-icon-blue{background:#e7ecf7;color:#3e6fd8}
        .ls-stat-label{font-size:14px;font-weight:650;color:#727783;margin-top:8px}
        .ls-stat-clickable strong{font-size:clamp(32px,3vw,42px);line-height:1.05;letter-spacing:-1.2px;color:#D97706}
        .ls-dashboard-shortcuts{margin:8px 0 24px}
        .ls-section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 15px}
        .ls-section-heading h2{margin:0;color:#2a2f38;font-size:21px}
        .ls-section-heading span{color:#858994;font-size:13px}
        .ls-shortcut-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}
        .ls-shortcut-card{min-height:112px;display:flex;align-items:center;gap:12px;text-align:left;padding:16px;background:#fff;border:1px solid #ebe9e3;border-radius:16px;color:#343943;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 5px 18px rgba(43,48,58,.025);transition:transform .18s ease,border-color .18s ease}
        .ls-shortcut-card:hover{transform:translateY(-2px);border-color:#cfc6e4}
        .ls-shortcut-icon{width:38px;height:38px;flex:0 0 38px;font-size:18px}
        .ls-shortcut-arrow{margin-left:auto;color:#9296a0;font-size:18px}
        .ls-stat-heading{display:flex;align-items:center;gap:12px;width:100%}
        .ls-stat-primary{justify-content:space-between;min-height:178px}
        .ls-stat-primary .ls-stat-label{margin:0;text-align:left;line-height:1.35;font-size:15px}
        .ls-stat-primary strong{font-size:clamp(42px,4vw,54px);line-height:1;letter-spacing:-1.8px;margin-top:auto}
        .ls-stat-icon,.ls-shortcut-icon{background:#e5eff0;color:#607A9B}
        .ls-stat-icon svg,.ls-shortcut-icon svg{width:23px;height:23px;display:block}
        .ls-shortcut-icon{width:42px;height:42px;flex:0 0 42px;border-radius:12px;display:grid;place-items:center}
        .ls-stat-primary .ls-stat-icon{width:46px;height:46px;flex:0 0 46px;border-radius:13px}
        .ls-stat-primary .ls-stat-icon svg{width:25px;height:25px}
        .ls-shortcut-card{color:#454b55}
        .ls-shortcut-card>span:nth-child(2){flex:1}
        .ls-dark .ls-stat-icon,.ls-dark .ls-shortcut-icon{background:#263f4a!important;color:#607A9B!important}
        .ls-dark .ls-stat-primary .ls-stat-label{color:#c4cad4!important}
        .ls-dark .ls-stat-primary strong{color:#ffad55!important}
        @media(max-width:760px){
          .ls-stat-primary{min-height:150px;aspect-ratio:1/1;padding:13px}
          .ls-stat-primary .ls-stat-label{font-size:12px}
          .ls-stat-primary strong{font-size:clamp(34px,9vw,43px)}
          .ls-stat-heading{gap:8px}
          .ls-stat-primary .ls-stat-icon{width:38px;height:38px;flex-basis:38px}
          .ls-stat-primary .ls-stat-icon svg{width:21px;height:21px}
          .ls-shortcut-icon{width:36px;height:36px;flex-basis:36px}
          .ls-shortcut-icon svg{width:21px;height:21px}
        }
        .ls-message{background:#eaf0ff;border-color:#d6e0fb;color:#345fc0}
        .ls-app .ls-muted{color:#7d828d}
        .ls-app input,.ls-app select,.ls-app textarea{border-color:#e3e1dc;border-radius:10px}
        .ls-app button{transition:background-color .15s ease,border-color .15s ease}
        .ls-app .ls-panel h2,.ls-app .ls-panel h3{color:#2a2f38}
        .ls-table-wrap{border-color:#ebe9e3;border-radius:14px}
        .ls-table{background:#fff}
        @media(max-width:1120px){.ls-dashboard-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.ls-shortcut-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:760px){
          .ls-layout{display:block}
          .ls-sidebar{margin:8px 8px 0;border-radius:16px;padding:10px;background:#fff}
          .ls-nav button.active,.ls-nav button:hover{background:#e8e2f4;color:#345fc0}
          .ls-main{padding:18px 12px 36px}
          .ls-dashboard-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
          .ls-stat-clickable{min-height:150px;aspect-ratio:1/1;padding:14px}
          .ls-stat-clickable strong{font-size:32px}
          .ls-stat-label{font-size:12px}
          .ls-shortcut-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
          .ls-shortcut-card{min-height:100px;padding:11px;gap:8px;font-size:12px}
          .ls-shortcut-icon{width:34px;height:34px;flex-basis:34px}
          .ls-section-heading{align-items:flex-start;flex-direction:column;gap:4px}
        }
        .ls-dark{background:#222731!important;color:#edf0f5!important}
        .ls-dark .ls-sidebar{background:#2f3541!important;border-color:#414957!important;color:#edf0f5!important}
        .ls-dark .ls-sidebar .ls-brand strong,.ls-dark .ls-topbar h1{color:#edf0f5!important}
        .ls-dark .ls-nav button{color:#c4cad4}
        .ls-dark .ls-nav button.active,.ls-dark .ls-nav button:hover{background:#414b60;color:#fff}
        .ls-dark .ls-stat-clickable,.ls-dark .ls-shortcut-card{background:#2f3541!important;border-color:#414957!important;color:#edf0f5!important}
        .ls-dark .ls-stat-clickable strong,.ls-dark .ls-shortcut-card{color:#edf0f5!important}
        .ls-dark .ls-stat-label,.ls-dark .ls-section-heading span{color:#b7bfcb!important}
        .ls-dark .ls-section-heading h2{color:#edf0f5!important}
        .ls-dark .ls-dashboard-shortcuts .ls-shortcut-arrow{color:#b7bfcb}
        .ls-dark .ls-icon-lavender,.ls-dark .ls-icon-blue{background:#414b60;color:#a9bcff}
        .ls-dark .ls-icon-peach{background:#594334;color:#ffbd91}
        .ls-dark .ls-icon-sage{background:#354b40;color:#a4d2b2}

        /* Mobile web only: reclaim screen width for tables; keep native APK and desktop unchanged. */
        @media(max-width:760px){
          .ls-app.ls-web .ls-layout{display:block}
          .ls-app.ls-web .ls-sidebar{display:none}
          .ls-app.ls-web .ls-nav-open .ls-sidebar{display:flex;position:fixed;inset:0 auto 0 0;z-index:1000;width:min(82vw,300px);height:100dvh;margin:0;border-radius:0;padding:18px 12px;overflow-y:auto;box-shadow:12px 0 32px rgba(0,0,0,.22)}
          .ls-app.ls-web .ls-nav-open .ls-nav{display:flex;flex-direction:column;overflow:visible}
          .ls-app.ls-web .ls-nav-open .ls-nav button{width:100%;white-space:normal;flex-shrink:1;font-size:13px}
          .ls-app.ls-web .ls-mobile-menu{display:inline-flex!important;position:fixed!important;top:calc(10px + env(safe-area-inset-top, 0px))!important;left:10px!important;z-index:9999!important;transform:none!important;contain:none!important;align-items:center;justify-content:center;gap:7px;min-height:38px;padding:7px 12px;border:1px solid #d8dee8;border-radius:9px;background:#fff;color:#102b46;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.18);pointer-events:auto!important}
          .ls-app.ls-web .ls-main{padding:56px 7px 28px}
          .ls-app.ls-web .ls-topbar{gap:8px;margin-bottom:12px}
          .ls-app.ls-web .ls-topbar h1{font-size:22px!important}
          .ls-app.ls-web .ls-topbar-actions{width:100%;gap:6px}
          .ls-app.ls-web .ls-panel{padding:8px;margin-bottom:10px;border-radius:10px}
          .ls-app.ls-web .ls-table-wrap{display:block!important;width:100%;max-width:100%;overflow-x:hidden!important}
          .ls-app.ls-web .ls-table-wrap:not(.ls-force-table){display:block!important}
          .ls-app.ls-web .ls-product-cards{display:none!important}
          .ls-app.ls-web .ls-table{width:100%!important;min-width:0!important;table-layout:fixed;font-size:10px;line-height:1.25}
          .ls-app.ls-web .ls-table th,.ls-app.ls-web .ls-table td{padding:5px 3px!important;white-space:normal!important;overflow-wrap:anywhere;word-break:normal;vertical-align:middle}
          .ls-app.ls-web .ls-table td strong{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:1.2}
          .ls-app.ls-web .ls-table button{font-size:10px!important;padding:5px 4px!important;white-space:normal}
          .ls-app.ls-web .ls-actions{gap:3px}
          .ls-app.ls-web .ls-actions button{font-size:9px;padding:4px 3px}
          .ls-app.ls-web .ls-toolbar{gap:6px}
          .ls-app.ls-web .ls-search{min-width:0}
          .ls-app.ls-web .barcode-picker-table,.ls-app.ls-web .sales-lines-table{table-layout:fixed!important;width:100%!important;min-width:0!important}
          .ls-app.ls-web .barcode-picker-table th,.ls-app.ls-web .barcode-picker-table td,.ls-app.ls-web .sales-lines-table th,.ls-app.ls-web .sales-lines-table td{padding:4px 2px!important;font-size:10px!important;overflow-wrap:anywhere;min-width:0!important}
          .ls-app.ls-web .barcode-picker-table input[type="number"],.ls-app.ls-web .sales-lines-table input[type="number"]{display:block!important;width:42px!important;max-width:42px!important;min-width:0!important;box-sizing:border-box;padding:4px 2px!important;margin:0!important}
          .ls-app.ls-web .barcode-picker-table button,.ls-app.ls-web .sales-lines-table button{display:inline-block!important;width:auto!important;max-width:64px!important;min-width:0!important;white-space:nowrap!important;padding:4px 5px!important;font-size:9px!important;line-height:1.2!important}
          .ls-app.ls-web .barcode-picker-table .label-qty-control,.ls-app.ls-web .sales-lines-table .label-qty-control{display:flex!important;align-items:center!important;justify-content:center!important;gap:3px!important;min-width:0!important}
          .ls-app.ls-web .barcode-picker-table .label-qty-plus,.ls-app.ls-web .sales-lines-table .label-qty-plus{width:23px!important;height:27px!important;min-width:23px!important;max-width:23px!important;padding:0!important;font-size:16px!important;line-height:1!important;border-radius:5px!important}
          .ls-app.ls-web .sales-lines-table td:first-child>div{gap:4px!important}
          .ls-app.ls-web .sales-lines-table td:first-child img{display:none!important}
          .ls-app.ls-web .sales-lines-table{display:table!important;border-collapse:collapse!important;table-layout:fixed!important;width:100%!important;min-width:0!important}
          .ls-app.ls-web .sales-lines-table th,.ls-app.ls-web .sales-lines-table td{font-size:10px!important;padding:5px 2px!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word!important}
          .ls-app.ls-web .sales-search-table{display:table!important;border-collapse:collapse!important;table-layout:fixed!important;width:100%!important;min-width:0!important}
          .ls-app.ls-web .sales-search-table th,.ls-app.ls-web .sales-search-table td{font-size:10px!important;padding:5px 2px!important;white-space:normal!important;overflow-wrap:anywhere!important}

          .ls-app.ls-web .label-picker-table{table-layout:fixed!important;width:100%!important;min-width:0!important}
          .ls-app.ls-web .label-picker-table th,.ls-app.ls-web .label-picker-table td{padding:4px 2px!important;font-size:10px!important;overflow-wrap:anywhere;min-width:0!important}
          .ls-app.ls-web .label-picker-table th:first-child,.ls-app.ls-web .label-picker-table td:first-child{font-size:10px!important}
          .ls-app.ls-web .label-picker-table input[type="number"]{display:block!important;width:42px!important;max-width:42px!important;min-width:0!important;box-sizing:border-box;padding:4px 2px!important;margin:0!important}
          .ls-app.ls-web .label-picker-table button{display:inline-block!important;width:auto!important;max-width:64px!important;min-width:0!important;white-space:nowrap!important;padding:4px 5px!important;font-size:9px!important;line-height:1.2!important}
          .ls-app.ls-web .label-picker-table .label-qty-control{display:flex!important;align-items:center!important;justify-content:center!important;gap:3px!important;min-width:0!important}
          .ls-app.ls-web .label-picker-table .label-qty-plus{width:23px!important;height:27px!important;min-width:23px!important;max-width:23px!important;padding:0!important;font-size:16px!important;line-height:1!important;border-radius:5px!important}
          .ls-app.ls-web .label-picker-table td:last-child{text-align:center!important}
          .ls-app.ls-web .label-picker-table td strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        }
        @media(min-width:761px){.ls-app.ls-web .ls-mobile-menu{display:none!important}}

        /* Africha Hamiz — Petrol / Terracotta / Sand palette preview */
        .ls-app{
          --ls-primary:#0E5E6F;
          --ls-accent:#D9622B;
          --ls-sand:#8FA7A0;
          --ls-charcoal:#2B2D33;
          --ls-card:#FFFFFF;
          --ls-card-soft:#F5F1E7;
          --ls-border:#E5DCC9;
          --ls-text:#26343A;
          --ls-text-muted:#65747A;
          --ls-table-head:#F1E8D7;
          --ls-table-line:#E9E1D3;
          background:#F7F5EF!important;color:var(--ls-text)!important;
        }
        .ls-app .ls-sidebar{background:var(--ls-primary)!important;color:#fff!important;border-color:var(--ls-primary)!important}
        .ls-app .ls-sidebar .ls-brand strong,.ls-app .ls-sidebar .ls-brand div div{color:#fff!important}
        .ls-app .ls-nav button{color:#EAF2F2!important}
        .ls-app .ls-nav button.active,.ls-app .ls-nav button:hover{background:rgba(227,207,164,.22)!important;color:#fff!important}
        .ls-app .ls-nav .ls-count{background:var(--ls-accent)!important;color:#fff!important}
        .ls-app .ls-brand-mark{background:var(--ls-sand)!important;color:var(--ls-primary)!important}
        .ls-app .ls-topbar h1,.ls-app .ls-section-heading h2{color:var(--ls-primary)!important}
        .ls-app .ls-panel,.ls-app .ls-stat,.ls-app .ls-shortcut-card,.ls-app .ls-login{background:var(--ls-card)!important;border-color:var(--ls-border)!important;color:var(--ls-text)!important}
        .ls-app .ls-stat-clickable strong{color:var(--ls-primary)!important}
        .ls-app .ls-stat-icon,.ls-app .ls-shortcut-icon{background:#EAF1EF!important;color:var(--ls-primary)!important}
        .ls-app .ls-icon-peach{background:#F8E6DC!important;color:var(--ls-accent)!important}
        .ls-app .ls-table{background:var(--ls-card)!important;color:var(--ls-text)!important}
        .ls-app .ls-table th{background:var(--ls-table-head)!important;color:var(--ls-primary)!important}
        .ls-app .ls-table td{border-color:var(--ls-table-line)!important}
        .ls-app .ls-muted{color:var(--ls-text-muted)!important}
        .ls-app .ls-message{background:#EAF1EF!important;border-color:#C8DAD8!important;color:var(--ls-primary)!important}
        .ls-app button:not(.ls-nav button){accent-color:var(--ls-primary)}
        /* Black AMOLED: pure black background, near-black cards */
        .ls-app .ls-dark,.ls-app.ls-dark{
          --ls-card:#0A0A0A;--ls-card-soft:#101010;--ls-border:#242424;
          --ls-text:#F5F5F5;--ls-text-muted:#A3A3A3;
          --ls-table-head:#111111;--ls-table-line:#242424;
          background:#000000!important;color:#F5F5F5!important;
        }
        .ls-app.ls-dark,.ls-app.ls-dark .ls-layout,.ls-app.ls-dark .ls-main{background:#000000!important;color:#F5F5F5!important}
        .ls-app.ls-dark .ls-sidebar{background:#050505!important;border-color:#202020!important}
        .ls-app.ls-dark .ls-sidebar .ls-brand strong,.ls-app.ls-dark .ls-sidebar .ls-brand div div{color:#F5F5F5!important}
        .ls-app.ls-dark .ls-nav button.active,.ls-app.ls-dark .ls-nav button:hover{background:rgba(14,94,111,.28)!important;color:#8FA7A0!important}
        .ls-app.ls-dark .ls-panel,.ls-app.ls-dark .ls-stat,.ls-app.ls-dark .ls-stat-clickable,.ls-app.ls-dark .ls-shortcut-card,.ls-app.ls-dark .ls-login,.ls-app.ls-dark .ls-import-card{background:var(--ls-card)!important;border-color:var(--ls-border)!important;color:var(--ls-text)!important}
        .ls-app.ls-dark .ls-topbar h1,.ls-app.ls-dark .ls-section-heading h2,.ls-app.ls-dark .ls-panel h2,.ls-app.ls-dark .ls-panel h3{color:#8FA7A0!important}
        .ls-app.ls-dark .ls-stat-clickable strong{color:#8FA7A0!important}
        .ls-app.ls-dark .ls-stat-icon,.ls-app.ls-dark .ls-shortcut-icon{background:#102326!important;color:#8FA7A0!important}
        .ls-app.ls-dark .ls-table,.ls-app.ls-dark .ls-table td{background:var(--ls-card)!important;color:var(--ls-text)!important}
        .ls-app.ls-dark .ls-table th{background:var(--ls-table-head)!important;color:#8FA7A0!important}
        .ls-app.ls-dark .ls-muted{color:var(--ls-text-muted)!important}
        .ls-app.ls-dark input,.ls-app.ls-dark select,.ls-app.ls-dark textarea{background:#080808!important;color:#F5F5F5!important;border-color:#303030!important}
        .ls-app.ls-dark .ls-alert{background:#29150F!important;color:#FFD5C2!important;border-color:#633522!important}
        .ls-app.ls-dark .ls-message{background:#0D2023!important;color:#DDECEB!important;border-color:#21464B!important}
        .ls-app.ls-dark .ls-import-panel{background:var(--ls-card)!important;color:var(--ls-text)!important}
        .ls-app.ls-dark .ls-import-panel h2,.ls-app.ls-dark .ls-import-panel strong,.ls-app.ls-dark .ls-import-panel .ls-muted{color:var(--ls-text)!important}
        .ls-app.ls-web .ls-mobile-menu{border-color:var(--ls-border)!important;color:var(--ls-primary)!important}
        .ls-app.ls-dark.ls-web .ls-mobile-menu{background:#0A0A0A!important;color:#8FA7A0!important;border-color:#242424!important}
        /* Remove leftover blue-tinted surfaces from legacy component styles */
        .ls-app.ls-dark .ls-icon-lavender,
        .ls-app.ls-dark .ls-icon-blue{background:#0A0A0A!important;color:#8FA7A0!important}
        .ls-app.ls-dark [style*="background: rgb(245, 248, 251)"],
        .ls-app.ls-dark [style*="background-color: rgb(245, 248, 251)"]{
          background:#0A0A0A!important;color:#F5F5F5!important;border-color:#242424!important
        }
        .ls-app.ls-dark .ls-card-metrics>div{background:#0A0A0A!important;border-color:#242424!important;color:#F5F5F5!important}
      `}</style>

      {!user ? (
        <div className="ls-login">
          <div className="ls-brand" style={{ marginBottom: 24 }}>
            <div
              className="ls-brand-mark"
              style={{ background: '#102b46', color: '#fff' }}
            >
              AH
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 23 }}>Africha Hamiz Assistant</h1>
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
        <div className={`ls-layout ${mobileNavOpen ? "ls-nav-open" : ""}`}>
          <button type="button" className="ls-mobile-menu" onClick={() => setMobileNavOpen((open) => !open)} aria-expanded={mobileNavOpen} aria-label="Ouvrir le menu">☰ Menu</button>
          <aside className="ls-sidebar">
            <div className="ls-sidebar-head">
              <div className="ls-brand">
                <div className="ls-brand-mark">AH</div>
                <div>
                  <strong style={{ fontSize: 16 }}>Africha Hamiz Assistant</strong>
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
                  onClick={() => { navigateTo(item.id); setMobileNavOpen(false); }}
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
                  AFRICHA HAMIZ ASSISTANT / {activePageTitle.toLocaleUpperCase('fr')}
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

            {activePage === 'ai-analysis' && canViewPage('ai-analysis') && <AIAnalysis />}

            {activePage === 'dashboard' && canViewPage('dashboard') && (
              <>
                <div className="ls-grid ls-dashboard-stats">
                  <button type="button" className="ls-stat ls-stat-clickable ls-stat-primary" onClick={() => navigateTo('products')}>
                    <span className="ls-stat-heading"><span className="ls-stat-icon"><DashboardIcon name="products" /></span><span className="ls-stat-label">Produits<br />visibles</span></span>
                    <strong>{catalogProducts.filter(product => product.is_active !== false).length.toLocaleString('fr-FR')}</strong>
                  </button>
                  <button type="button" className="ls-stat ls-stat-clickable ls-stat-primary" onClick={() => navigateTo('analysis')}>
                    <span className="ls-stat-heading"><span className="ls-stat-icon"><DashboardIcon name="analysis" /></span><span className="ls-stat-label">Quantités<br />négatives</span></span>
                    <strong>{negativeProducts.length + negativeTapisProducts.length}</strong>
                  </button>
                  <button type="button" className="ls-stat ls-stat-clickable ls-stat-primary" onClick={() => navigateTo('requests')}>
                    <span className="ls-stat-heading"><span className="ls-stat-icon"><DashboardIcon name="requests" /></span><span className="ls-stat-label">Nouvelles<br />demandes</span></span>
                    <strong>{newRequestsCount}</strong>
                  </button>
                  <button type="button" className="ls-stat ls-stat-clickable ls-stat-primary" onClick={() => navigateTo('photos')}>
                    <span className="ls-stat-heading"><span className="ls-stat-icon"><DashboardIcon name="photos" /></span><span className="ls-stat-label">Photos<br />enregistrées</span></span>
                    <strong>{productPhotos.length}</strong>
                  </button>
                </div>
                <section className="ls-dashboard-shortcuts">
                  <div className="ls-section-heading">
                    <h2>Accès rapide</h2>
                    <span>Choisissez une section pour ouvrir son tableau</span>
                  </div>
                  <div className="ls-shortcut-grid">
                    {[
                      { id: 'products', label: 'Liste des produits', icon: 'products' },
                      { id: 'analysis', label: 'Analyse des produits', icon: 'analysis' },
                      { id: 'arina', label: 'Matelas Europ Arina', icon: 'arina' },
                      { id: 'textiles', label: 'Chora / Voilage / Rideau', icon: 'textiles' },
                      { id: 'sales', label: 'Bon de vente', icon: 'sales' },
                      { id: 'labels', label: 'Étiquettes prix', icon: 'labels' },
                      { id: 'photos', label: 'Photos des produits', icon: 'photos' },
                      { id: 'requests', label: 'Demandes clients', icon: 'requests' },
                    ].filter((item) => visibleNavItems.some((nav) => nav.id === item.id)).map((item) => (
                      <button key={item.id} type="button" className="ls-shortcut-card" onClick={() => navigateTo(item.id)}>
                        <span className="ls-shortcut-icon"><DashboardIcon name={item.icon} /></span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}

            {activePage === 'alerts' && isAdmin && (() => {
              const sourceProducts = alertScope === 'tapis'
                ? catalogProducts.filter(p => p.catalog_source === 'tapis_products')
                : products;
              const suggestions = alertScope === 'tapis' ? tapisSuggestedProducts : suggestedProducts;
              const negatives = sourceProducts.filter(p => Number(p.current_quantity) < 0);
              const exhausted = sourceProducts.filter(p => Number(p.current_quantity) === 0);
              const low = sourceProducts.filter(p => Number(p.min_stock_level) > 0 && Number(p.current_quantity) > 0 && Number(p.current_quantity) <= Number(p.min_stock_level));
              const imminent = suggestions.filter(p => Number(p.days_remaining) > 0 && Number(p.days_remaining) <= 2)
                .map(p => ({ ...p, catalog_source: alertScope === 'tapis' ? 'tapis_products' : 'products' }));
              const groups = [
                { key: 'negative', title: 'Stock négatif', items: negatives, color: '#b42318' },
                { key: 'zero', title: 'Stock épuisé', items: exhausted, color: '#b54708' },
                { key: 'imminent', title: 'Rupture imminente (≤ 2 jours)', items: imminent, color: '#b54708' },
                { key: 'low', title: 'Stock faible', items: low, color: '#175cd3' },
              ];
              const rowKey = (p) => String(p.id || p.product_id || p.product_ref);
              const productForHide = (p) => ({ ...p, id: p.id || p.product_id, catalog_source: p.catalog_source || (alertScope === 'tapis' ? 'tapis_products' : 'products') });
              return <section className="ls-panel">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                  <div><h2 style={{margin:'0 0 5px'}}>Alertes de stock</h2><p className="ls-muted" style={{margin:0}}>Les alertes sont calculées à partir du dernier PDF et des suggestions de réapprovisionnement.</p></div>
                  <div className="ls-toolbar">
                    <button style={alertScope==='linge'?styles.button:styles.secondary} onClick={()=>setAlertScope('linge')}>Linge</button>
                    <button style={alertScope==='tapis'?styles.button:styles.secondary} onClick={()=>setAlertScope('tapis')}>Tapis</button>
                    <button style={styles.secondary} onClick={()=>{if(alertScope==='tapis'){loadProducts();loadTapisSuggestedProducts();}else{loadProducts();loadSuggestedProducts();}}}>Actualiser</button>
                  </div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:10,margin:'16px 0'}}>
                  {groups.map(group=><div key={group.key} style={{border:'1px solid #e2e8f0',borderRadius:12,padding:14,background:'var(--ls-card,#fff)'}}><div className="ls-muted">{group.title}</div><strong style={{fontSize:28,color:group.color}}>{group.items.length.toLocaleString('fr-FR')}</strong></div>)}
                </div>
                {groups.map(group=>{
                  const pageSize=alertTablePageSizes[group.key]||10;
                  const page=alertTablePages[group.key]||1;
                  const selected=alertTableSelections[group.key]||[];
                  const pages=Math.max(1,Math.ceil(group.items.length/pageSize));
                  const safePage=Math.min(page,pages);
                  const visible=group.items.slice((safePage-1)*pageSize,safePage*pageSize);
                  const selectedItems=group.items.filter(p=>selected.includes(rowKey(p))).map(productForHide);
                  return <section key={group.key} style={{marginTop:18}}>
                    <h3 style={{marginBottom:8}}>{group.title} <span className="ls-muted">({group.items.length})</span></h3>
                    <div className="ls-toolbar" style={{flexWrap:'wrap',marginBottom:8}}>
                      <button style={styles.secondary} disabled={!selected.length} onClick={()=>copyCatalogItems(selectedItems)}>Copier ({selected.length})</button>
                      <button style={styles.secondary} disabled={!selected.length} onClick={()=>hideCatalogItems(selectedItems,()=>setAlertTableSelections(current=>({...current,[group.key]:[]})))}>Masquer sélection ({selected.length})</button>
                      <button style={styles.secondary} disabled={!selected.length} onClick={()=>setAlertTableSelections(current=>({...current,[group.key]:[]}))}>Désélectionner</button>
                      <label className="ls-muted">Lignes par page <select style={{...styles.field,width:'auto'}} value={pageSize} onChange={e=>{setAlertTablePageSizes(current=>({...current,[group.key]:Number(e.target.value)}));setAlertTablePages(current=>({...current,[group.key]:1}));}}>{[10,20,100].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
                    </div>
                    {group.items.length===0?<p className="ls-muted">Aucun produit dans cette catégorie.</p>:<>
                      <div className="ls-table-wrap"><table className="ls-table"><thead><tr>
                        <th style={styles.th}><input type="checkbox" aria-label="Tout sélectionner" checked={visible.length>0&&visible.every(p=>selected.includes(rowKey(p)))} onChange={e=>setAlertTableSelections(current=>({...current,[group.key]:e.target.checked?Array.from(new Set([...selected,...visible.map(rowKey)])):selected.filter(id=>!visible.some(p=>rowKey(p)===id))}))}/></th>
                        <th style={styles.th}>Désignation</th><th style={styles.th}>Quantité actuelle</th>{group.key==='imminent'&&<th style={styles.th}>Jours restants</th>}<th style={styles.th}>Action</th>
                      </tr></thead><tbody>{visible.map((p,i)=><tr key={rowKey(p)||i}>
                        <td style={styles.td}><input type="checkbox" checked={selected.includes(rowKey(p))} onChange={e=>setAlertTableSelections(current=>({...current,[group.key]:e.target.checked?[...selected,rowKey(p)]:selected.filter(id=>id!==rowKey(p))}))}/></td>
                        <td style={styles.td}>{p.name||p.product_name||'—'}</td><td style={styles.td}>{p.current_quantity??'—'}</td>{group.key==='imminent'&&<td style={styles.td}>{p.days_remaining}</td>}
                        <td style={styles.td}><button style={{...styles.secondary,padding:'5px 9px',fontSize:12}} onClick={()=>hideProduct(productForHide(p))}>Masquer</button></td>
                      </tr>)}</tbody></table></div>
                      <div className="ls-toolbar" style={{justifyContent:'space-between',marginTop:8}}><span className="ls-muted">Page {safePage} / {pages} · {group.items.length} produit(s)</span><div className="ls-toolbar"><button style={styles.secondary} disabled={safePage<=1} onClick={()=>setAlertTablePages(current=>({...current,[group.key]:safePage-1}))}>Précédent</button><button style={styles.secondary} disabled={safePage>=pages} onClick={()=>setAlertTablePages(current=>({...current,[group.key]:safePage+1}))}>Suivant</button></div></div>
                    </>}
                  </section>;
                })}
              </section>;
            })()}
            {activePage === 'statistics' && isAdmin && (() => {
              const sourceProducts = statsScope === 'linge' ? products : statsScope === 'tapis' ? catalogProducts.filter(p=>p.catalog_source==='tapis_products') : catalogProducts;
              const total = sourceProducts.length;
              const quantity = sourceProducts.reduce((sum,p)=>sum+(Number(p.current_quantity)||0),0);
              const negative = sourceProducts.filter(p=>Number(p.current_quantity)<0).length;
              const zero = sourceProducts.filter(p=>Number(p.current_quantity)===0).length;
              const positive = sourceProducts.filter(p=>Number(p.current_quantity)>0).length;
              const currentQuantityById = new Map(sourceProducts.map(p=>[String(p.id),p.current_quantity]));
              const currentQuantityByRef = new Map(sourceProducts.map(p=>[String(p.catalog_source||'products')+'|'+String(p.product_ref||''),p.current_quantity]));
              const decreases = (statsScope==='tapis'
                ? tapisStockDecreaseProducts.map(p=>({...p,catalog_source:'tapis_products'}))
                : statsScope==='linge'
                  ? stockDecreaseProducts.map(p=>({...p,catalog_source:'products'}))
                  : [...stockDecreaseProducts.map(p=>({...p,catalog_source:'products'})),...tapisStockDecreaseProducts.map(p=>({...p,catalog_source:'tapis_products'}))]
              ).map(p=>({
                ...p,
                current_quantity: currentQuantityById.get(String(p.product_id||p.id||'')) ?? currentQuantityByRef.get(String(p.catalog_source)+'|'+String(p.product_ref||'')) ?? p.current_quantity ?? null
              }));
              const sortedDecreases=[...decreases].sort((a,b)=>Number(b.quantity_decreased||0)-Number(a.quantity_decreased||0));
              const maxDecrease=Math.max(1,...sortedDecreases.map(p=>Number(p.quantity_decreased)||0));
              const metrics=[{label:'Produits suivis',value:total},{label:'Quantité totale actuelle',value:quantity.toLocaleString('fr-FR',{maximumFractionDigits:2})},{label:'Stock positif',value:positive},{label:'Stock négatif',value:negative},{label:'Stock épuisé',value:zero},{label:'Baisses PDF détectées',value:decreases.length}];
              const pages=Math.max(1,Math.ceil(sortedDecreases.length/statsPageSize));
              const safePage=Math.min(statsPage,pages);
              const visible=sortedDecreases.slice((safePage-1)*statsPageSize,safePage*statsPageSize);
              const selectedItems=sortedDecreases.filter(p=>statsSelection.includes(String(p.product_id||p.id||p.product_ref))).map(p=>({...p,id:p.product_id||p.id,catalog_source:p.catalog_source}));
              return <section className="ls-panel">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                  <div><h2 style={{margin:'0 0 5px'}}>Statistiques du stock</h2><p className="ls-muted" style={{margin:0}}>Vue synthétique calculée à partir des quantités actuelles et des comparaisons PDF.</p></div>
                  <div className="ls-toolbar"><button style={statsScope==='all'?styles.button:styles.secondary} onClick={()=>{setStatsScope('all');setStatsPage(1);setStatsSelection([]);}}>Tout</button><button style={statsScope==='linge'?styles.button:styles.secondary} onClick={()=>{setStatsScope('linge');setStatsPage(1);setStatsSelection([]);}}>Linge</button><button style={statsScope==='tapis'?styles.button:styles.secondary} onClick={()=>{setStatsScope('tapis');setStatsPage(1);setStatsSelection([]);}}>Tapis</button><button style={styles.secondary} onClick={()=>{loadStockDecreaseAnalysis();loadTapisStockDecreaseAnalysis();loadProducts();}}>Actualiser</button></div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:10,margin:'16px 0'}}>
                  {metrics.map(m=><div key={m.label} style={{border:'1px solid #e2e8f0',borderRadius:12,padding:14,background:'var(--ls-card,#fff)'}}><div className="ls-muted">{m.label}</div><strong style={{fontSize:26}}>{m.value}</strong></div>)}
                </div>
                <h3 style={{marginTop:20}}>Répartition du stock</h3>
                {[{label:'Stock positif',value:positive,color:'#1570ef'},{label:'Stock négatif',value:negative,color:'#d92d20'},{label:'Stock épuisé',value:zero,color:'#b54708'}].map(item=><div key={item.label} style={{margin:'12px 0'}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}><span>{item.label}</span><strong>{item.value}</strong></div><div style={{height:9,background:'#e9eef5',borderRadius:20,overflow:'hidden'}}><div style={{height:'100%',width:(total?Math.min(100,item.value/total*100):0)+'%',background:item.color,borderRadius:20}}/></div></div>)}
                <h3 style={{marginTop:22}}>Plus fortes baisses de stock (PDF)</h3>
                <div className="ls-toolbar" style={{flexWrap:'wrap',marginBottom:8}}>
                  <button style={styles.secondary} disabled={!statsSelection.length} onClick={()=>copyCatalogItems(selectedItems)}>Copier ({statsSelection.length})</button>
                  <button style={styles.secondary} disabled={!statsSelection.length} onClick={()=>hideCatalogItems(selectedItems,()=>setStatsSelection([]))}>Masquer sélection ({statsSelection.length})</button>
                  <button style={styles.secondary} disabled={!statsSelection.length} onClick={()=>setStatsSelection([])}>Désélectionner</button>
                  <label className="ls-muted">Lignes par page <select style={{...styles.field,width:'auto'}} value={statsPageSize} onChange={e=>{setStatsPageSize(Number(e.target.value));setStatsPage(1);}}>{[10,20,100].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
                </div>
                {sortedDecreases.length===0?<p className="ls-muted">Aucune baisse PDF chargée. Actualisez les données ou vérifiez les imports PDF.</p>:<>
                  <div className="ls-table-wrap"><table className="ls-table"><thead><tr>
                    <th style={styles.th}><input type="checkbox" aria-label="Tout sélectionner" checked={visible.length>0&&visible.every(p=>statsSelection.includes(String(p.product_id||p.id||p.product_ref)))} onChange={e=>setStatsSelection(e.target.checked?Array.from(new Set([...statsSelection,...visible.map(p=>String(p.product_id||p.id||p.product_ref))])):statsSelection.filter(id=>!visible.some(p=>String(p.product_id||p.id||p.product_ref)===id)))}/></th>
                    <th style={styles.th}>Désignation</th><th style={styles.th}>Quantité actuelle</th><th style={styles.th}>Quantité diminuée</th><th style={styles.th}>Action</th>
                  </tr></thead><tbody>{visible.map((p,i)=>{const key=String(p.product_id||p.id||p.product_ref);const product={...p,id:p.product_id||p.id,name:p.name||p.product_name||'Produit',catalog_source:p.catalog_source};return <tr key={key||i}>
                    <td style={styles.td}><input type="checkbox" checked={statsSelection.includes(key)} onChange={e=>setStatsSelection(e.target.checked?[...statsSelection,key]:statsSelection.filter(id=>id!==key))}/></td>
                    <td style={styles.td}>{p.name||p.product_name||'—'}</td>
                    <td style={styles.td}>{p.current_quantity??'—'}</td>
                    <td style={styles.td}><div style={{display:'flex',alignItems:'center',gap:8}}><strong>{p.quantity_decreased??'—'}</strong><div style={{height:7,background:'#e9eef5',borderRadius:20,flex:1,overflow:'hidden'}}><div style={{height:'100%',width:Math.min(100,(Number(p.quantity_decreased)||0)/maxDecrease*100)+'%',background:'#d97706'}}/></div></div></td>
                    <td style={styles.td}><button style={{...styles.secondary,padding:'5px 9px',fontSize:12}} onClick={()=>hideProduct(product)}>Masquer</button></td>
                  </tr>})}</tbody></table></div>
                  <div className="ls-toolbar" style={{justifyContent:'space-between',marginTop:8}}><span className="ls-muted">Page {safePage} / {pages} · {sortedDecreases.length} produit(s)</span><div className="ls-toolbar"><button style={styles.secondary} disabled={safePage<=1} onClick={()=>setStatsPage(safePage-1)}>Précédent</button><button style={styles.secondary} disabled={safePage>=pages} onClick={()=>setStatsPage(safePage+1)}>Suivant</button></div></div>
                </>}
              </section>;
            })()}
            {activePage === 'imports' && isAdmin && (
              <>
                {isAdmin && (
                  <section className="ls-panel ls-import-panel">
                    <h2 style={{ marginTop: 0 }}>Dernier import historique</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
                      <div className="ls-import-card" style={{ border: '1px solid var(--ls-border, #dbe3ec)', borderRadius: 14, padding: 16, background: 'var(--ls-card-soft, #f8fafc)', color: 'var(--ls-text, #102b46)' }}>
                        <h3 style={{ margin: '0 0 10px', color: '#183b5b' }}>Linge</h3>
                        <div className="ls-muted">Dernier fichier : <strong>{latestImportRecord(lastImportBatch, lastLingePdfImport)?.file_name || latestImportRecord(lastImportBatch, lastLingePdfImport)?.filename || 'Aucun fichier importé'}</strong></div>
                        <div className="ls-muted" style={{ marginTop: 6 }}>Date : <strong>{displayImportDate(latestImportRecord(lastImportBatch, lastLingePdfImport))}</strong></div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                          <button type="button" style={styles.button} onClick={() => document.getElementById('linge-csv-upload')?.click()}>Importer CSV</button>
                          <input id="linge-csv-upload" type="file" accept=".csv,text/csv" onChange={handleCsvFile} style={{display:'none'}} />
                          <button type="button" style={styles.secondary} onClick={() => document.getElementById('linge-pdf-upload')?.click()}>Importer PDF</button>
                          <input id="linge-pdf-upload" type="file" accept=".pdf,application/pdf" onChange={handlePdfFile} style={{display:'none'}} />
                        </div>
                      </div>
                      <div className="ls-import-card" style={{ border: '1px solid var(--ls-border, #dbe3ec)', borderRadius: 14, padding: 16, background: 'var(--ls-card-soft, #f8fafc)', color: 'var(--ls-text, #102b46)' }}>
                        <h3 style={{ margin: '0 0 10px', color: '#183b5b' }}>Tapis</h3>
                        <div className="ls-muted">Dernier fichier : <strong>{latestImportRecord(lastTapisImportBatch, lastTapisPdfImport)?.file_name || latestImportRecord(lastTapisImportBatch, lastTapisPdfImport)?.filename || 'Aucun fichier importé'}</strong></div>
                        <div className="ls-muted" style={{ marginTop: 6 }}>Date : <strong>{displayImportDate(latestImportRecord(lastTapisImportBatch, lastTapisPdfImport))}</strong></div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                          <button type="button" style={styles.button} onClick={() => document.getElementById('tapis-csv-upload')?.click()}>Importer CSV</button>
                          <input id="tapis-csv-upload" type="file" accept=".csv,text/csv" onChange={handleTapisCsvFile} style={{display:'none'}} />
                          <button type="button" style={styles.secondary} onClick={() => document.getElementById('tapis-pdf-upload')?.click()}>Importer PDF</button>
                          <input id="tapis-pdf-upload" type="file" accept=".pdf,application/pdf" onChange={handleTapisPdfFile} style={{display:'none'}} />
                        </div>
                      </div>
                    </div>
                    <p className="ls-muted" style={{ marginBottom: 0, marginTop: 12 }}>Chaque bouton ouvre directement le sélecteur du fichier correspondant. Les aperçus et confirmations restent dans leurs sections respectives ci-dessous.</p>
                  </section>
                )}
                {isAdmin && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
                      gap: 16,
                      alignItems: 'stretch',
                    }}
                  >
                    <section
                      className="ls-panel"
                      style={{
                        height: '100%',
                        boxSizing: 'border-box',
                        borderColor: urgentNewRequests.length ? '#f2b84b' : '#e2e8f0',
                        borderWidth: urgentNewRequests.length ? 2 : 1,
                      }}
                    >
                      <h2 style={{ marginTop: 0, color: urgentNewRequests.length ? '#9a4b00' : '#102b46' }}>
                        🚨 Demandes urgentes — Matelas Europ Arina ({urgentNewRequests.length})
                      </h2>
                      {urgentNewRequests.length === 0 ? (
                        <p className="ls-muted">Aucune demande urgente pour le moment.</p>
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
                              <strong>{request.products?.name || 'Matelas Europ Arina'}</strong>
                              <div className="ls-muted">
                                {request.trader_name || 'Client'} · {new Date(request.created_at).toLocaleString('fr-FR')}
                              </div>
                            </div>
                            <strong>Quantité : {request.requested_quantity ?? 'À confirmer'}</strong>
                            <button style={styles.secondary} onClick={() => navigateTo('requests')}>Ouvrir</button>
                          </div>
                        ))
                      )}
                    </section>
                    <section className="ls-panel" style={{ height: '100%', boxSizing: 'border-box' }}>
                      <h2 style={{ marginTop: 0 }}>🔔 Demandes de réapprovisionnement</h2>
                      <p className="ls-muted">Les nouvelles demandes sont affichées en premier.</p>
                      {newRequests.length === 0 ? (
                        <p>Aucune nouvelle demande.</p>
                      ) : (
                        <>
                          <p><strong>{newRequests.length} nouvelle(s) demande(s)</strong></p>
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
                                <span className="ls-muted">— {request.trader_name || 'Trader'}</span>
                              </span>
                              <strong>
                                {request.request_type === 'need_item' || request.requested_quantity == null
                                  ? 'Quantité à confirmer'
                                  : `Qté : ${request.requested_quantity}`}
                              </strong>
                            </div>
                          ))}
                          <button style={styles.button} onClick={() => navigateTo('requests')}>Ouvrir les demandes</button>
                          <button style={{ ...styles.secondary, marginLeft: 8 }} onClick={copyNewRequests}>
                            Copier toutes les nouvelles demandes
                          </button>
                        </>
                      )}
                    </section>
                  </div>
                )}
                {isAdmin && (csvFileName || csvPreview.length > 0) && (
                  <section className="ls-panel">
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
                            onClick={() => importCsvToSupabase()}
                          >
                            Importer CSV — prix + historique
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
                    {isAdmin && (tapisCsvFileName || tapisCsvPreview.length > 0) && (
                      <section className="ls-panel" style={{ marginTop: 18 }}>
                        {tapisCsvFileName && <p><strong>Fichier Tapis :</strong> {tapisCsvFileName}</p>}
                        {tapisCsvPreview.length > 0 && <>
                          <p><strong>{tapisCsvPreview.length} lignes détectées.</strong> Aperçu des 5 premières lignes :</p>
                          <div className="ls-table-wrap">
                            <table className="ls-table">
                              <thead><tr>{Object.keys(tapisCsvPreview[0]).map((header) => <th style={styles.th} key={header}>{header}</th>)}</tr></thead>
                              <tbody>{tapisCsvPreview.slice(0, 5).map((row, index) => (
                                <tr key={index}>{Object.keys(tapisCsvPreview[0]).map((header) => <td style={styles.td} key={header}>{String(row[header] ?? '')}</td>)}</tr>
                              ))}</tbody>
                            </table>
                          </div>
                          <div className="ls-toolbar">
                            <button style={styles.button} onClick={importTapisCsvToSupabase}>
                              Importer CSV Tapis — prix + historique
                            </button>
                            <button style={styles.secondary} onClick={() => {
                              setTapisCsvPreview([]);
                              setTapisCsvFileName('');
                              setMessage('Aperçu CSV Tapis annulé.');
                            }}>Annuler</button>
                          </div>
                        </>}
                      </section>
                    )}
                    {(pdfFileName || pdfPreview.length > 0) && (
                    <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #d7dee7' }}>
                      {pdfFileName && <p><strong>Fichier PDF :</strong> {pdfFileName}</p>}
                      {pdfPreview.length > 0 && <>
                        <p><strong>{pdfPreview.length} lignes reconnues.</strong> Recherchez une référence ou une désignation pour vérifier la quantité avant confirmation.</p>
                        <ClearableSearchInput
                          type="search"
                          value={pdfSearch}
                          onChange={(event) => setPdfSearch(event.target.value)}
                          placeholder="Rechercher par référence ou désignation…"
                          aria-label="Rechercher dans l’aperçu PDF"
                          style={{...styles.input, width: '100%', marginBottom: 12}}
                        />
                        {(() => {
                          const query = pdfSearch.trim().toLocaleLowerCase();
                          const filteredRows = pdfPreview.filter((row) =>
                            !query || String(row.product_ref || '').toLocaleLowerCase().includes(query) ||
                            String(row.name || '').toLocaleLowerCase().includes(query)
                          );
                          const visibleRows = filteredRows.slice(0, 10);
                          return <>
                            <p>Affichage de {visibleRows.length} produit(s) sur {filteredRows.length} résultat(s) filtré(s), parmi {pdfPreview.length} références reconnues. L’aperçu est limité à 10 produits.</p>
                            <div className="ls-table-wrap"><table className="ls-table">
                              <thead><tr><th style={styles.th}>Désignation</th><th style={styles.th}>Quantité PDF</th></tr></thead>
                              <tbody>{visibleRows.map((row, index) => <tr key={row.product_ref + index}><td style={styles.td}>{row.name}</td><td style={{...styles.td, color: Number(row.quantity) < 0 ? '#b42318' : undefined}}>{row.quantity}</td></tr>)}</tbody>
                            </table></div>
                            {filteredRows.length === 0 && <p className="ls-muted">Aucun résultat. Vérifiez l’orthographe ou la référence.</p>}
                          </>;
                        })()}
                      </>}
                      {pdfPreview.length > 0 && (
                        <div className="ls-toolbar" style={{ marginTop: 12 }}>
                          <button style={styles.button} onClick={importPdfCurrentStock}>
                            Confirmer l’import PDF — quantités uniquement
                          </button>
                          <button style={styles.secondary} onClick={() => { setPdfPreview([]); setPdfSearch(''); setPdfFileName(''); setMessage('Aperçu PDF annulé.'); }}>
                            Annuler
                          </button>
                        </div>
                      )}
                    </div>
                    )}
                    {(tapisPdfFileName || tapisPdfPreview.length > 0) && (
                    <section className="ls-panel" style={{ marginTop: 18 }}>
                      {tapisPdfFileName && <p><strong>Fichier Tapis :</strong> {tapisPdfFileName}</p>}
                      {tapisPdfPreview.length > 0 && <>
                        <p><strong>{tapisPdfPreview.length} références reconnues.</strong> Vérifiez le code, la désignation et la quantité avant confirmation.</p>
                        <ClearableSearchInput
                          type="search"
                          value={tapisPdfSearch}
                          onChange={(event) => setTapisPdfSearch(event.target.value)}
                          placeholder="Rechercher une référence ou une désignation Tapis…"
                          aria-label="Rechercher dans l’aperçu PDF Tapis"
                          style={{ ...styles.input, width: '100%', marginBottom: 12 }}
                        />
                        {(() => {
                          const query = tapisPdfSearch.trim().toLocaleLowerCase();
                          const filteredRows = tapisPdfPreview.filter((row) =>
                            !query ||
                            String(row.product_ref || '').toLocaleLowerCase().includes(query) ||
                            String(row.name || '').toLocaleLowerCase().includes(query)
                          );
                          const visibleRows = filteredRows.slice(0, 10);
                          return <>
                            <p>Affichage de {visibleRows.length} produit(s) sur {filteredRows.length} résultat(s). L’aperçu est limité à 10 produits.</p>
                            <div className="ls-table-wrap">
                              <table className="ls-table">
                                <thead><tr>
                                  
                                  <th style={styles.th}>Désignation</th>
                                  <th style={styles.th}>Quantité PDF</th>
                                </tr></thead>
                                <tbody>{visibleRows.map((row, index) => (
                                  <tr key={row.product_ref + index}>
                                    
                                    <td style={styles.td}>{row.name}</td>
                                    <td style={{ ...styles.td, color: Number(row.quantity) < 0 ? '#b42318' : undefined }}>{row.quantity}</td>
                                  </tr>
                                ))}</tbody>
                              </table>
                            </div>
                            {filteredRows.length === 0 && <p className="ls-muted">Aucun résultat pour cette recherche.</p>}
                          </>;
                        })()}
                      </>}
                      {tapisPdfPreview.length > 0 && (
                        <div className="ls-toolbar" style={{ marginTop: 12 }}>
                          <button style={styles.button} onClick={importTapisPdfCurrentStock}>
                            Confirmer l’import PDF Tapis
                          </button>
                          <button
                            style={styles.secondary}
                            onClick={() => {
                              setTapisPdfPreview([]);
                              setTapisPdfSearch('');
                              setTapisPdfFileName('');
                              setMessage('Aperçu PDF Tapis annulé.');
                            }}
                          >Annuler</button>
                        </div>
                      )}
                    </section>
                    )}
                {negativeProducts.filter((product)=>matchesTableSearch(tableSearch, product.name, product.product_ref)).length > 0 && (
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
                            
                            <th style={styles.th}>Désignation</th>
                            <th style={styles.th}>Quantité</th>
                            <th style={styles.th}>Prix de gros</th>
                            <th style={styles.th}>Prix de détail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {negativeProducts.filter((product)=>matchesTableSearch(tableSearch, product.name, product.product_ref)).map((product) => (
                            <tr key={product.id}>
                              
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
                {negativeTapisProducts.filter((product)=>matchesTableSearch(tableSearch, product.name, product.product_ref)).length > 0 && (
                  <section className="ls-panel" style={{ marginTop: 16 }}>
                    <div className="ls-alert">
                      ⚠️ {negativeTapisProducts.length} produit(s) Tapis ont une quantité négative. Les quantités sont conservées telles qu’importées et doivent être vérifiées.
                    </div>
                    <div className="ls-table-wrap ls-force-table">
                      <table className="ls-table">
                        <thead><tr>
                          
                          <th style={styles.th}>Désignation</th>
                          <th style={styles.th}>Quantité</th>
                          <th style={styles.th}>Prix de gros</th>
                          <th style={styles.th}>Prix de détail</th>
                        </tr></thead>
                        <tbody>
                          {negativeTapisProducts.filter((product)=>matchesTableSearch(tableSearch, product.name, product.product_ref)).map((product) => (
                            <tr key={product.id}>
                              
                              <td style={styles.td}>{product.name}</td>
                              <td style={{...styles.td,color:'#b42318',fontWeight:800}}>{product.current_quantity}</td>
                              <td style={styles.td}>{product.wholesale_price ?? '—'} DA</td>
                              <td style={styles.td}>{product.retail_price ?? '—'} DA</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </>
            )}

            {activePage === 'chora-matelas' && (() => {
              const canShowMatelasZero = showArinaZeroStock && (isAdmin || Boolean(user?.profile?.can_view_zero_negative_products));
              const isArinaProduct = (product) => {
                const name = normalizeName(product.name);
                return name.includes('EUROPARINA') || (name.includes('EUROP') && name.includes('ARINA'));
              };
              const isAfrichaProduct = (product) => {
                const name = normalizeName(product.name);
                return name.includes('AFRICHASHOP') || (name.includes('AFRICHA') && name.includes('SHOP'));
              };
              const canShowProduct = (product, allowZero = false) =>
                product.is_active !== false &&
                (Number(product.current_quantity) > 0 || (allowZero ? canShowMatelasZero : isAdmin)) &&
                matchesTableSearch(searchTerm, product.name, product.product_ref);
              const sortItems = (items) => [...items].sort((a, b) => {
                const av = a[sortKey], bv = b[sortKey];
                const numeric = ['current_quantity', 'wholesale_price', 'retail_price'].includes(sortKey);
                const comparison = numeric
                  ? Number(av ?? 0) - Number(bv ?? 0)
                  : String(av ?? '').localeCompare(String(bv ?? ''), 'fr', { numeric: true, sensitivity: 'base' });
                return sortDirection === 'asc' ? comparison : -comparison;
              });
              const choraItems = sortItems(products.filter((product) => {
                const name = normalizeName(product.name);
                return (name.includes('CHORA') || name.includes('VOILAGE') || (name.includes('RIDEAU') && !name.includes('CUISINE'))) && canShowProduct(product);
              }));
              const arinaItems = sortItems(products.filter((product) => isArinaProduct(product) && canShowProduct(product, true)));
              const africhaItems = sortItems(products.filter((product) => isAfrichaProduct(product) && canShowProduct(product, true)));
              const renderCatalogTable = (items) => {
                const total = Math.max(1, Math.ceil(items.length / pageSize));
                const page = Math.min(currentPage, total);
                const visible = items.slice((page - 1) * pageSize, page * pageSize);
                return (
                  <>
                    <div className="ls-muted" style={{margin:'8px 0 12px'}}>{items.length.toLocaleString('fr-FR')} produit(s)</div>
                    <div className="ls-toolbar">
                      <ClearableSearchInput className="ls-search" style={styles.field} value={searchTerm} onChange={(event)=>{setSearchTerm(event.target.value);setCurrentPage(1);}} placeholder="Rechercher par désignation…" />
                      <label className="ls-muted">Lignes par page{' '}
                        <select style={{...styles.field,width:'auto'}} value={pageSize} onChange={(event)=>{setPageSize(Number(event.target.value));setCurrentPage(1);}}>
                          {[10,20,100].map((size)=><option key={size} value={size}>{size}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="ls-table-wrap"><table className="ls-table">
                      <thead><tr>
                        
                        <th style={styles.th}><button onClick={()=>changeSort('name')}>{sortLabel('name','Désignation')}</button></th>
                        <th style={styles.th}><button onClick={()=>changeSort('current_quantity')}>{sortLabel('current_quantity','Quantité')}</button></th>
                        <th style={styles.th}><button onClick={()=>changeSort('wholesale_price')}>{sortLabel('wholesale_price','Prix de gros')}</button></th>
                        <th style={styles.th}><button onClick={()=>changeSort('retail_price')}>{sortLabel('retail_price','Prix de détail')}</button></th>
                        <th style={styles.th}>Action</th>
                      </tr></thead>
                      <tbody>
                        {visible.length ? visible.map((product)=><tr key={product.id}>
                          
                          <td style={styles.td}><span style={{display:'inline-flex',alignItems:'center',gap:8}}>
                            {photoFor(product.id) && <img src={photoFor(product.id)} alt="" onClick={()=>setPhotoPreview({url:photoFor(product.id),name:product.name})} style={{width:38,height:38,objectFit:'cover',borderRadius:6,cursor:'zoom-in'}}/>}
                            {product.name}
                          </span></td>
                          <td style={{...styles.td,color:Number(product.current_quantity)<0?'#b42318':'#102b46',fontWeight:800}}>{isAdmin||showTraderQuantities?product.current_quantity:Number(product.current_quantity)<=0?'Rupture':'Disponible'}</td>
                          <td style={styles.td}>{product.wholesale_price??'—'} DA</td>
                          <td style={styles.td}>{product.retail_price??'—'} DA</td>
                          <td style={styles.td}>{productActions(product)}</td>
                        </tr>) : <tr><td colSpan={5} style={{...styles.td,textAlign:'center'}}>Aucun produit trouvé.</td></tr>}
                      </tbody>
                    </table></div>
                    <div className="ls-pagination"><span className="ls-muted">Page {page} sur {total}</span><div className="ls-toolbar" style={{margin:0}}>
                      <button style={styles.secondary} disabled={page<=1} onClick={()=>setCurrentPage((n)=>Math.max(1,n-1))}>← Précédent</button>
                      <button style={styles.secondary} disabled={page>=total} onClick={()=>setCurrentPage((n)=>Math.min(total,n+1))}>Suivant →</button>
                    </div></div>
                  </>
                );
              };
              return (
                <section className="ls-panel">
                  <h2 style={{marginTop:0}}>Chora & Matelas</h2>
                  <p className="ls-muted">Ouvrez la rubrique souhaitée pour afficher son tableau.</p>
                  <details style={{border:'1px solid #e2e8f0',borderRadius:12,padding:14,marginBottom:14}}>
                    <summary style={{cursor:'pointer',fontWeight:800,fontSize:16}}>Chora / Voilage / Rideau <span className="ls-muted">({choraItems.length})</span></summary>
                    {renderCatalogTable(choraItems)}
                  </details>
                  <details style={{border:'1px solid #e2e8f0',borderRadius:12,padding:14}}>
                    <summary style={{cursor:'pointer',fontWeight:800,fontSize:16}}>Matelas Europ Arina & Africha Shop <span className="ls-muted">({arinaItems.length + africhaItems.length})</span></summary>
                    {isAdmin || user?.profile?.can_view_zero_negative_products ? (
                      <label className="ls-muted" style={{display:'flex',alignItems:'center',gap:6,marginTop:12}}>
                        <input type="checkbox" checked={showArinaZeroStock} onChange={(event)=>{setShowArinaZeroStock(event.target.checked);setCurrentPage(1);}} />
                        Afficher les Matelas à quantité 0 ou négative
                      </label>
                    ) : null}
                    <h3 style={{marginTop:18}}>Europ Arina</h3>
                    {renderCatalogTable(arinaItems)}
                    <h3 style={{marginTop:22}}>Africha Shop</h3>
                    {renderCatalogTable(africhaItems)}
                  </details>
                </section>
              );
            })()}

            {['products'].includes(activePage) && (
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
                          ? 'Europ Arina'
                          : 'Chora / Voilage / Rideau'
                        : activePage === 'products'
                        ? 'Produits en stock'
                        : activePage === 'arina'
                        ? 'Europ Arina + Africha Shop'
                        : 'Chora / Voilage / Rideau'}
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
                  {activePage === 'products' && <button type="button" style={styles.secondary} onClick={() => { setScannerStatus(''); setScannerTarget('products'); }}>Scanner QR</button>}
                  {activePage === 'arina' && (
                    <label className="ls-muted" style={{display:'flex',alignItems:'center',gap:6,fontWeight:700}}>
                      <input
                        type="checkbox"
                        checked={showArinaZeroStock && (isAdmin || Boolean(user?.profile?.can_view_zero_negative_products))}
                        disabled={!isAdmin && !user?.profile?.can_view_zero_negative_products}
                        onChange={(event) => { setShowArinaZeroStock(event.target.checked); setCurrentPage(1); }}
                      />
                      Afficher les Matelas à quantité 0 ou négative
                    </label>
                  )}
                  {scannerTarget === 'products' && <div className="ls-panel" style={{flexBasis:'100%',border:'1px solid #94a3b8'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}><strong>Scanner QR — Tous les produits</strong><button type="button" style={styles.secondary} onClick={() => setScannerTarget(null)}>Fermer</button></div><video ref={scannerVideoRef} playsInline muted style={{display:'block',width:'100%',maxWidth:420,maxHeight:300,objectFit:'cover',margin:'12px auto',background:'#111827',borderRadius:10}}/><p className="ls-muted">{scannerStatus || 'Démarrage de la caméra…'}</p></div>}
                  <ClearableSearchInput
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
                                    <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
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
                        {[10, 20, 100].map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
                <div className="ls-table-wrap">
                  <table className={`ls-table ${activePage === 'products' && ['trader', 'viewer'].includes(String(user?.profile?.role || '').trim().toLowerCase()) ? 'ls-products-readonly-table' : ''}`} style={activePage === 'products' && ['trader', 'viewer'].includes(String(user?.profile?.role || '').trim().toLowerCase()) ? { tableLayout: 'fixed', minWidth: 0, fontSize: 14 } : undefined}>
                    {activePage === 'products' && ['trader', 'viewer'].includes(String(user?.profile?.role || '').trim().toLowerCase()) && <colgroup><col style={{width:'52%'}}/><col style={{width:'10%'}}/><col style={{width:'19%'}}/><col style={{width:'19%'}}/></colgroup>}
                    <thead>
                      <tr>
                        
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
                        {!(activePage === 'products' && ['trader', 'viewer'].includes(String(user?.profile?.role || '').trim().toLowerCase())) && <th style={styles.th}>
                          {language === 'ar' ? 'إجراء' : 'Action'}
                        </th>}
                      </tr>
                    </thead>
                    <tbody>{productTableRows()}</tbody>
                  </table>
                </div>
                {activePage === 'arina' && <section style={{marginTop:24}}>
                  <h2 style={{marginTop:0}}>Africha Shop</h2>
                  <div className="ls-muted" style={{marginBottom:10}}>{africhaSortedProducts.length} produit(s)</div>
                  <div className="ls-table-wrap"><table className="ls-table"><thead><tr><th style={styles.th}><button onClick={()=>changeSort('name')}>Désignation</button></th><th style={styles.th}><button onClick={()=>changeSort('current_quantity')}>Quantité</button></th><th style={styles.th}><button onClick={()=>changeSort('wholesale_price')}>Prix de gros</button></th><th style={styles.th}><button onClick={()=>changeSort('retail_price')}>Prix de détail</button></th><th style={styles.th}>Action</th></tr></thead><tbody>{africhaPageProducts.length ? africhaPageProducts.map((product)=><tr key={product.id}><td style={styles.td}><span style={{display:'inline-flex',alignItems:'center',gap:8}}>{product.name}</span></td><td style={styles.td}>{isAdmin||showTraderQuantities?product.current_quantity:Number(product.current_quantity)<=0?'Rupture':'Disponible'}</td><td style={styles.td}>{product.wholesale_price??'—'} DA</td><td style={styles.td}>{product.retail_price??'—'} DA</td><td style={styles.td}>{productActions(product)}</td></tr>):<tr><td colSpan={5} style={styles.td}>Aucun produit Africha Shop trouvé.</td></tr>}</tbody></table></div>
                  <div className="ls-pagination"><span className="ls-muted">Page {Math.min(currentPage,africhaTotalPages)} sur {africhaTotalPages}</span><div className="ls-toolbar" style={{margin:0}}><button style={styles.secondary} disabled={currentPage<=1} onClick={()=>setCurrentPage((n)=>Math.max(1,n-1))}>← Précédent</button><button style={styles.secondary} disabled={currentPage>=africhaTotalPages} onClick={()=>setCurrentPage((n)=>Math.min(africhaTotalPages,n+1))}>Suivant →</button></div></div>
                </section>}
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
                      <div className="ls-toolbar"><ClearableSearchInput className="ls-search" style={styles.field} value={tableSearch} onChange={(event)=>setTableSearch(event.target.value)} placeholder="Rechercher un produit négatif…" /></div>
                      <div className="ls-alert">
                        Les quantités négatives sont conservées telles
                        qu’importées. Vérifiez ces produits.
                      </div>
                      <div className="ls-table-wrap ls-force-table">
                        <table className="ls-table">
                          <thead>
                            <tr>
                              
                              <th style={styles.th}>Désignation</th>
                              <th style={styles.th}>Quantité</th>
                              <th style={styles.th}>Prix de gros</th>
                              <th style={styles.th}>Prix de détail</th>
                            </tr>
                          </thead>
                          <tbody>
                            {negativeProducts.map((product) => (
                              <tr key={product.id}>
                                
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
                        Rechercher un produit à photographier
                      </label>
                      <ClearableSearchInput
                        style={styles.field}
                        value={photoProductSearch}
                        onChange={(event) => {
                          setPhotoProductSearch(event.target.value);
                          setPhotoProductId('');
                        }}
                        placeholder="Tapez le nom ou la référence du produit…"
                      />
                      {photoProductSearch.trim() && (
                        <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto', border: '1px solid #dbe3ec', borderRadius: 8, background: 'white' }}>
                          {products
                            .filter((product) => productMatchesSearch(product, photoProductSearch))
                            .slice(0, 30)
                            .map((product) => (
                              <button
                                key={product.id}
                                type="button"
                                onClick={() => {
                                  setPhotoProductId(product.id);
                                  setPhotoProductSearch(`${product.product_ref || ''} — ${product.name || ''}`);
                                }}
                                style={{ display: 'block', width: '100%', padding: '10px 12px', border: 0, borderBottom: '1px solid #edf1f5', background: photoProductId === product.id ? '#eaf2ff' : 'white', color: '#102b46', textAlign: 'left', cursor: 'pointer' }}
                              >
                                <strong>{product.name}</strong>
                                <div className="ls-muted">{product.product_ref || 'Sans référence'}</div>
                              </button>
                            ))}
                          {products.filter((product) => productMatchesSearch(product, photoProductSearch)).length === 0 && (
                            <p className="ls-muted" style={{ padding: 10, margin: 0 }}>Aucun produit trouvé.</p>
                          )}
                        </div>
                      )}
                      {photoProductId && (
                        <p className="ls-muted" style={{ margin: '8px 0 0' }}>Produit sélectionné : {products.find((product) => product.id === photoProductId)?.name || ''}</p>
                      )}
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
                <ClearableSearchInput style={{...styles.field,margin:'14px 0'}} value={photoSearch} onChange={(event)=>setPhotoSearch(event.target.value)} placeholder="Rechercher par désignation ou référence… (mots dans n’importe quel ordre)" />
                <div className="ls-photo-grid">
                  {productPhotos.filter((photo)=>{const product=products.find((item)=>item.id===photo.product_id)||hiddenProducts.find((item)=>item.id===photo.product_id);return product && productMatchesSearch(product,photoSearch);}).map((photo) => {
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
                          onClick={() => setPhotoPreview({url:photo.photo_url,name:product?.name || 'Produit'})}
                         
                          style={{cursor:'zoom-in'}}
                        />
                        <strong>{product?.name || 'Produit'}</strong>
                        <div className="ls-muted">
                          
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
                        {isAdmin && <div className="ls-toolbar"><label style={styles.secondary}>Changer la photo<input type="file" accept="image/*" style={{display:'none'}} onChange={(event)=>{const f=event.target.files?.[0];if(f && product) uploadProductPhoto(f,product);event.target.value='';}} /></label><button style={styles.secondary} onClick={()=>deleteProductPhoto(photo)}>Supprimer la photo</button></div>}
                      </article>
                    );
                  })}
                </div>
                {productPhotos.length === 0 && (
                  <p className="ls-muted">
                    Aucune photo enregistrée pour le moment.
                  </p>
                )}
                {productPhotos.length > 0 && !productPhotos.some((photo)=>{const product=products.find((item)=>item.id===photo.product_id)||hiddenProducts.find((item)=>item.id===photo.product_id);return product && productMatchesSearch(product,photoSearch);}) && (
                  <p className="ls-muted">Aucun produit ne correspond à cette recherche.</p>
                )}
              </section>
            )}

            {activePage === 'requests' && canViewPage('requests') && (
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

            {activePage === 'history' && canViewPage('history') && (
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



            {activePage === 'tapis' && isAdmin && (
              <section className="ls-panel">
                <h2 style={{marginTop:0}}>Catalogue des tickets Tapis</h2>
                <p className="ls-muted">Choisissez le modèle une seule fois, puis scannez ses tickets à la suite. Le modèle reste sélectionné après chaque enregistrement.</p>
                <label style={{display:'grid',gap:5,fontWeight:600,maxWidth:420,marginBottom:12}}>Nom du modèle / المودال
                  <input style={styles.field} value={ticketModel} onChange={e=>setTicketModel(e.target.value)} placeholder="مثال: NOMADE" />
                </label>
                <button type="button" style={styles.button} onClick={()=>ticketFileRef.current?.click()} disabled={ticketBusy}>{ticketBusy?'Lecture en cours…':'🖼️ Choisir une image / prendre une photo'}</button>
                <input ref={ticketFileRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" style={{display:'none'}} onChange={e=>readTapisTicket(e.target.files?.[0])}/>
                {ticketPhoto && <img src={ticketPhoto} alt="Ticket photographié" style={{display:'block',width:'100%',maxWidth:340,maxHeight:260,objectFit:'contain',marginTop:12,borderRadius:10}}/>}
                {ticketMessage && <p className="ls-message" role="status">{ticketMessage}</p>}
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginTop:14}}>
                  { [['type','Type'],['denomination','Dénomination'],['dimension','Dimension'],['dessin','Dessin'],['couleur','Couleur'],['code_barres','N° vertical à côté du QR']].map(([k,label])=><label key={k} style={{display:'grid',gap:5,fontWeight:600}}>{label}<input style={styles.field} value={ticketDraft[k]} onChange={e=>setTicketDraft(v=>({...v,[k]:e.target.value}))}/></label>)}
                </div>
                <div style={{display:'flex',gap:10,marginTop:14,flexWrap:'wrap'}}><button type="button" style={styles.button} onClick={saveTapisTicket}>Valider et enregistrer</button><button type="button" style={styles.secondary} onClick={()=>{if(ticketPhoto && ticketPhoto.startsWith('blob:')) URL.revokeObjectURL(ticketPhoto);setTicketDraft({type:'',denomination:'',dimension:'',dessin:'',couleur:'',code_barres:''});setTicketPhoto('');setTicketMessage('');if(ticketFileRef.current)ticketFileRef.current.value='';}}>Effacer</button></div>
                <h3 style={{marginTop:24}}>Tickets enregistrés ({tapisTickets.length})</h3>
                <div style={{overflowX:'auto'}}><table className="ls-table"><thead><tr>{['Type','Dénomination','Dimension','Dessin','Couleur','N° vertical'].map(x=><th style={styles.th} key={x}>{x}</th>)}</tr></thead><tbody>{tapisTickets.map(x=><tr key={x.id}>{[x.type,x.denomination,x.dimension,x.dessin,x.couleur,x.code_barres].map((v,i)=><td style={styles.td} key={i}>{v}</td>)}</tr>)}</tbody></table></div>
              </section>
            )}

            {activePage === 'mosque-simulation' && isAdmin && (<MosqueSimulation tapisProducts={[...new Map([...catalogProducts.filter(p => p.catalog_source === 'tapis_products'), ...mosqueTapisProducts].map(p => [String(p.id), p])).values()]} />)}

            {activePage === 'tapis-analysis' && canViewPage('tapis-analysis') && (
              <section className="ls-panel">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                  <div>
                    <h2 style={{marginTop:0,marginBottom:6}}>Suggestions de réapprovisionnement Tapis</h2>
                    <p className="ls-muted" style={{marginTop:0}}>
                      Analyse indépendante basée sur le stock du dernier PDF Tapis et l’historique mensuel Tapis. Les stocks négatifs, les stocks nuls avec sorties et les produits estimés à moins de 2 jours sont affichés.
                    </p>
                  </div>
                </div>
                {(() => {
                  const negativeCount = tapisSuggestedProducts.filter(p => Number(p.current_quantity) < 0).length;
                  const zeroCount = tapisSuggestedProducts.filter(p => Number(p.current_quantity) === 0).length;
                  const positiveCount = tapisSuggestedProducts.filter(p => Number(p.current_quantity) > 0).length;
                  return (
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:12,margin:'12px 0 18px'}}>
                      <div style={{padding:14,border:'1px solid #e2e8f0',borderRadius:12,background:'var(--ls-card, #fff)'}}><div className="ls-muted">Total suggestions</div><strong style={{fontSize:28}}>{tapisSuggestedProducts.length}</strong></div>
                      <div style={{padding:14,border:'1px solid #e2e8f0',borderRadius:12,background:'var(--ls-card, #fff)'}}><div className="ls-muted">Stock négatif</div><strong style={{fontSize:28,color:'#b42318'}}>{negativeCount}</strong></div>
                      <div style={{padding:14,border:'1px solid #e2e8f0',borderRadius:12,background:'var(--ls-card, #fff)'}}><div className="ls-muted">Stock zéro avec mouvement</div><strong style={{fontSize:28}}>{zeroCount}</strong></div>
                      <div style={{padding:14,border:'1px solid #e2e8f0',borderRadius:12,background:'var(--ls-card, #fff)'}}><div className="ls-muted">Stock positif urgent</div><strong style={{fontSize:28}}>{positiveCount}</strong></div>
                    </div>
                  );
                })()}
                <div className="ls-toolbar" style={{flexWrap:'wrap',gap:8}}>
                  <button style={{...styles.secondary,padding:'6px 11px',fontSize:12}} onClick={loadTapisSuggestedProducts} disabled={tapisSuggestionsLoading}>Actualiser</button>
                  <button style={{...styles.secondary,padding:'6px 11px',fontSize:12}} onClick={hideSelectedTapisSuggestions}>Masquer</button>
                  <button style={{...styles.secondary,padding:'6px 11px',fontSize:12}} onClick={async()=>{const names=tapisSuggestedProducts.filter(p=>selectedTapisSuggestions.includes(p.id)).map(p=>p.name).filter(Boolean);if(!names.length){window.alert('Sélectionnez au moins un produit.');return;}const copied=names.join('\n');try{await navigator.clipboard.writeText(copied);window.alert(names.length+' désignation(s) copiée(s).');}catch(error){window.prompt('Copiez les désignations :',copied);}}}>Copier ({selectedTapisSuggestions.length})</button>
                  <button style={{...styles.secondary,padding:'6px 11px',fontSize:12}} onClick={()=>setSelectedTapisSuggestions([])}>Désélectionner</button>
                  <label className="ls-muted">Lignes par page <select style={styles.field} value={tapisAnalysisPageSize} onChange={event=>{setTapisAnalysisPageSize(Number(event.target.value));setTapisAnalysisPage(1);}}>{[10,20,100].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
                </div>
                <div className="ls-toolbar" style={{marginTop:6}}><ClearableSearchInput className="ls-search" style={styles.field} value={tapisAnalysisSearch} onChange={event=>{setTapisAnalysisSearch(event.target.value);setTapisAnalysisPage(1);}} placeholder="Rechercher une référence ou désignation Tapis…" /></div>
                {(() => {
                  const filtered=tapisSuggestedProducts.filter(p=>matchesTableSearch(tapisAnalysisSearch,p.name,p.product_ref));
                  const numericKeys=['current_quantity','average_daily_decrease','days_remaining','suggested_order_quantity'];
                  const sorted=[...filtered].sort((a,b)=>{
                    const av=a[tapisAnalysisSortKey],bv=b[tapisAnalysisSortKey];
                    const c=numericKeys.includes(tapisAnalysisSortKey)
                      ? (av==null?Number.POSITIVE_INFINITY:Number(av))-(bv==null?Number.POSITIVE_INFINITY:Number(bv))
                      : String(av??'').localeCompare(String(bv??''),'fr',{numeric:true,sensitivity:'base'});
                    return tapisAnalysisSortDirection==='asc'?c:-c;
                  });
                  const pages=Math.max(1,Math.ceil(sorted.length/tapisAnalysisPageSize));
                  const safe=Math.min(tapisAnalysisPage,pages);
                  const rows=sorted.slice((safe-1)*tapisAnalysisPageSize,safe*tapisAnalysisPageSize);
                  return <>
                    {tapisSuggestionsLoading ? <p>Chargement des suggestions Tapis…</p> : filtered.length===0 ? (
                      <p>Aucune suggestion Tapis à afficher. Cliquez sur Actualiser.</p>
                    ) : (
                      <div className="ls-table-wrap">
                        <table className="ls-table">
                          <thead><tr>
                            <th style={styles.th}>Sélection</th>
                            
                            <th style={styles.th}><button style={tableSortButtonStyle} onClick={()=>{setTapisAnalysisSortKey('name');setTapisAnalysisSortDirection(d=>tapisAnalysisSortKey==='name'?(d==='asc'?'desc':'asc'):'asc');setTapisAnalysisPage(1);}}>Désignation {tapisAnalysisSortKey==='name'?(tapisAnalysisSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button style={tableSortButtonStyle} onClick={()=>{setTapisAnalysisSortKey('current_quantity');setTapisAnalysisSortDirection(d=>tapisAnalysisSortKey==='current_quantity'?(d==='asc'?'desc':'asc'):'asc');setTapisAnalysisPage(1);}}>Quantité PDF actuelle {tapisAnalysisSortKey==='current_quantity'?(tapisAnalysisSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button style={tableSortButtonStyle} onClick={()=>{setTapisAnalysisSortKey('average_daily_decrease');setTapisAnalysisSortDirection(d=>tapisAnalysisSortKey==='average_daily_decrease'?(d==='asc'?'desc':'asc'):'asc');setTapisAnalysisPage(1);}}>Sortie moyenne / jour {tapisAnalysisSortKey==='average_daily_decrease'?(tapisAnalysisSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button style={tableSortButtonStyle} onClick={()=>{setTapisAnalysisSortKey('days_remaining');setTapisAnalysisSortDirection(d=>tapisAnalysisSortKey==='days_remaining'?(d==='asc'?'desc':'asc'):'asc');setTapisAnalysisPage(1);}}>Jours restants estimés {tapisAnalysisSortKey==='days_remaining'?(tapisAnalysisSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button style={tableSortButtonStyle} onClick={()=>{setTapisAnalysisSortKey('suggested_order_quantity');setTapisAnalysisSortDirection(d=>tapisAnalysisSortKey==='suggested_order_quantity'?(d==='asc'?'desc':'asc'):'asc');setTapisAnalysisPage(1);}}>Quantité à commander {tapisAnalysisSortKey==='suggested_order_quantity'?(tapisAnalysisSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button style={tableSortButtonStyle} onClick={()=>{setTapisAnalysisSortKey('last_snapshot_date');setTapisAnalysisSortDirection(d=>tapisAnalysisSortKey==='last_snapshot_date'?(d==='asc'?'desc':'asc'):'asc');setTapisAnalysisPage(1);}}>Date du dernier relevé {tapisAnalysisSortKey==='last_snapshot_date'?(tapisAnalysisSortDirection==='asc'?'▲':'▼'):''}</button></th>
                          </tr></thead>
                          <tbody>{rows.map(product=>(
                            <tr key={product.id || product.product_ref}>
                              <td style={styles.td}><input type="checkbox" checked={selectedTapisSuggestions.includes(product.id)} onChange={event=>setSelectedTapisSuggestions(current=>event.target.checked?[...current,product.id]:current.filter(id=>id!==product.id))}/></td>
                              
                              <td style={styles.td}>{product.name || '—'}</td>
                              <td style={{...styles.td,fontWeight:700,color:Number(product.current_quantity)<0?'#b42318':undefined}}>{product.current_quantity ?? '—'}</td>
                              <td style={styles.td}>{product.average_daily_decrease ?? '—'}</td>
                              <td style={{...styles.td,color:Number(product.current_quantity)<=0?'#b42318':undefined}}>{Number(product.current_quantity)<=0?'Stock négatif / nul':product.days_remaining==null?'Non estimé':product.days_remaining+' jours'}</td>
                              <td style={styles.td}>{product.suggested_order_quantity ?? '—'}</td>
                              <td style={styles.td}>{product.last_snapshot_date || '—'}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                    <div className="ls-pagination">
                      <span className="ls-muted">Page {safe} sur {pages} · {filtered.length} produit(s)</span>
                      <div className="ls-toolbar" style={{margin:0}}>
                        <button style={styles.secondary} disabled={safe<=1} onClick={()=>setTapisAnalysisPage(p=>Math.max(1,p-1))}>← Précédent</button>
                        <button style={styles.secondary} disabled={safe>=pages} onClick={()=>setTapisAnalysisPage(p=>Math.min(pages,p+1))}>Suivant →</button>
                      </div>
                    </div>
                  </>;
                })()}
                <div
                  style={{
                    marginTop: 28,
                    paddingTop: 22,
                    borderTop: '2px solid #e2e8f0',
                  }}
                >
                  <h2 style={{ marginTop: 0 }}>
                    Produits Tapis dont le stock a diminué
                  </h2>
                  <p className="ls-muted">
                    Comparaison du dernier PDF Tapis importé avec le PDF de référence
                    selon la période choisie. Seuls les produits dont la quantité a baissé sont affichés.
                  </p>
                  <div className="ls-toolbar" style={{flexWrap:'wrap',gap:8}}>
                    <button style={{...styles.secondary,padding:'6px 11px',fontSize:12}} onClick={loadTapisStockDecreaseAnalysis} disabled={tapisStockDecreaseLoading}>Actualiser</button>
                    <button style={{...styles.secondary,padding:'6px 11px',fontSize:12}} onClick={hideSelectedTapisStockDecrease}>Masquer</button>
                    <button style={{...styles.secondary,padding:'6px 11px',fontSize:12}} onClick={async()=>{const names=tapisStockDecreaseProducts.filter(p=>selectedTapisStockDecrease.includes(p.product_id)).map(p=>p.product_name).filter(Boolean);if(!names.length){window.alert('Sélectionnez au moins un produit.');return;}const copied=names.join('\n');try{await navigator.clipboard.writeText(copied);window.alert(names.length+' désignation(s) copiée(s).');}catch(error){window.prompt('Copiez les désignations :',copied);}}}>Copier ({selectedTapisStockDecrease.length})</button>
                    <button style={{...styles.secondary,padding:'6px 11px',fontSize:12}} onClick={()=>setSelectedTapisStockDecrease([])}>Désélectionner</button>
                    <label className="ls-muted">Lignes par page <select style={styles.field} value={tapisDecreasePageSize} onChange={event=>{setTapisDecreasePageSize(Number(event.target.value));setTapisDecreasePage(1);}}>{[10,20,100].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
                    <label className="ls-muted">Comparer avec le PDF d’il y a (jours) <input type="number" min="1" max="3650" step="1" value={tapisDecreaseDays} onChange={event=>{setTapisDecreaseDays(Math.max(1,Math.min(3650,Number(event.target.value)||1)));setTapisDecreasePage(1);}} style={{...styles.field,width:90,marginLeft:6}} /></label>
                    <span className="ls-muted">{tapisStockDecreaseProducts.length} produit(s) en baisse</span>
                  </div>
                  <div className="ls-toolbar" style={{marginTop:6}}><ClearableSearchInput className="ls-search" style={styles.field} value={tapisDecreaseSearch} onChange={event=>{setTapisDecreaseSearch(event.target.value);setTapisDecreasePage(1);}} placeholder="Rechercher référence ou désignation…" /></div>
                  {tapisStockDecreaseLoading ? (
                    <p>Chargement de l’analyse des baisses Tapis…</p>
                  ) : tapisStockDecreaseProducts.length === 0 ? (
                    <p>
                      Aucune baisse trouvée entre le dernier PDF Tapis et le PDF de référence choisi, ou cliquez sur « Actualiser les baisses PDF Tapis ».
                    </p>
                  ) : (
                    <>
                    {(() => { const filtered=tapisStockDecreaseProducts.filter(product=>matchesTableSearch(tapisDecreaseSearch,product.product_name,product.product_ref)); const sorted=[...filtered].sort((a,b)=>{const av=a[tapisDecreaseSortKey],bv=b[tapisDecreaseSortKey];const numeric=['previous_quantity','current_quantity','quantity_decreased','days_between'].includes(tapisDecreaseSortKey);const c=numeric?(Number(av)||0)-(Number(bv)||0):String(av??'').localeCompare(String(bv??''),'fr',{numeric:true,sensitivity:'base'});return tapisDecreaseSortDirection==='asc'?c:-c;});const pages=Math.max(1,Math.ceil(sorted.length/tapisDecreasePageSize));const safePage=Math.min(tapisDecreasePage,pages);const rows=sorted.slice((safePage-1)*tapisDecreasePageSize,safePage*tapisDecreasePageSize);return <>
                    <div className="ls-table-wrap">
                      <table className="ls-table">
                        <thead>
                          <tr>
                            <th style={styles.th}>Sélection</th>
                            
                            <th style={styles.th}><button style={tableSortButtonStyle} onClick={()=>{setTapisDecreaseSortKey('product_name');setTapisDecreaseSortDirection(d=>tapisDecreaseSortKey==='product_name'?(d==='asc'?'desc':'asc'):'asc');setTapisDecreasePage(1);}}>Désignation {tapisDecreaseSortKey==='product_name'?(tapisDecreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button style={tableSortButtonStyle} onClick={()=>{setTapisDecreaseSortKey('previous_quantity');setTapisDecreaseSortDirection(d=>tapisDecreaseSortKey==='previous_quantity'?(d==='asc'?'desc':'asc'):'asc');setTapisDecreasePage(1);}}>Quantité précédente {tapisDecreaseSortKey==='previous_quantity'?(tapisDecreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button style={tableSortButtonStyle} onClick={()=>{setTapisDecreaseSortKey('current_quantity');setTapisDecreaseSortDirection(d=>tapisDecreaseSortKey==='current_quantity'?(d==='asc'?'desc':'asc'):'asc');setTapisDecreasePage(1);}}>Quantité actuelle {tapisDecreaseSortKey==='current_quantity'?(tapisDecreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button style={tableSortButtonStyle} onClick={()=>{setTapisDecreaseSortKey('quantity_decreased');setTapisDecreaseSortDirection(d=>tapisDecreaseSortKey==='quantity_decreased'?(d==='asc'?'desc':'asc'):'asc');setTapisDecreasePage(1);}}>Baisse de quantité {tapisDecreaseSortKey==='quantity_decreased'?(tapisDecreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button style={tableSortButtonStyle} onClick={()=>{setTapisDecreaseSortKey('previous_date');setTapisDecreaseSortDirection(d=>tapisDecreaseSortKey==='previous_date'?(d==='asc'?'desc':'asc'):'asc');setTapisDecreasePage(1);}}>Date précédente {tapisDecreaseSortKey==='previous_date'?(tapisDecreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button style={tableSortButtonStyle} onClick={()=>{setTapisDecreaseSortKey('latest_snapshot_date');setTapisDecreaseSortDirection(d=>tapisDecreaseSortKey==='latest_snapshot_date'?(d==='asc'?'desc':'asc'):'asc');setTapisDecreasePage(1);}}>Dernière date {tapisDecreaseSortKey==='latest_snapshot_date'?(tapisDecreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button style={tableSortButtonStyle} onClick={()=>{setTapisDecreaseSortKey('days_between');setTapisDecreaseSortDirection(d=>tapisDecreaseSortKey==='days_between'?(d==='asc'?'desc':'asc'):'asc');setTapisDecreasePage(1);}}>Jours entre les fichiers {tapisDecreaseSortKey==='days_between'?(tapisDecreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((product) => (
                            <tr
                              key={`${product.product_id}-${product.previous_date}-${product.latest_snapshot_date}`}
                            >
                              <td style={styles.td}>
                                <input
                                  type="checkbox"
                                  checked={selectedTapisStockDecrease.includes(product.product_id)}
                                  onChange={(event) =>
                                    setSelectedTapisStockDecrease((current) =>
                                      event.target.checked
                                        ? [...current, product.product_id]
                                        : current.filter((id) => id !== product.product_id)
                                    )
                                  }
                                />
                              </td>
                              
                              <td className="stock-decrease-designation" style={styles.td}>{product.product_name || '—'}</td>
                              <td style={styles.td}>
                                {product.previous_quantity ?? '—'}
                              </td>
                              <td style={styles.td}>
                                {product.current_quantity ?? '—'}
                              </td>
                              <td
                                style={{
                                  ...styles.td,
                                  color: '#b42318',
                                  fontWeight: 800,
                                }}
                              >
                                −{product.quantity_decreased}
                              </td>
                              <td style={styles.td}>
                                {product.previous_date || '—'}
                              </td>
                              <td style={styles.td}>
                                {product.latest_snapshot_date || '—'}
                              </td>
                              <td style={styles.td}>
                                {product.days_between ?? '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="ls-pagination"><span className="ls-muted">Page {safePage} sur {pages} · {filtered.length} produit(s)</span><div className="ls-toolbar" style={{margin:0}}><button style={styles.secondary} disabled={safePage<=1} onClick={()=>setTapisDecreasePage(p=>Math.max(1,p-1))}>← Précédent</button><button style={styles.secondary} disabled={safePage>=pages} onClick={()=>setTapisDecreasePage(p=>Math.min(pages,p+1))}>Suivant →</button></div></div>
                    </>; })()}
                    </>
                  )}
                </div>
              </section>
            )}

            {activePage === 'analysis' && canViewPage('analysis') && (
              <section className="ls-panel">
                <h2 style={{ marginTop: 0 }}>
                  Suggestions de réapprovisionnement urgent
                </h2>
                <div className="ls-toolbar" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <button style={{...styles.secondary,padding:'6px 11px',fontSize:12}} onClick={loadSuggestedProducts}>Actualiser</button>
                  <button style={{...styles.button,padding:'6px 11px',fontSize:12}} onClick={hideSelectedSuggestions}>Masquer</button>
                  <button
                    style={{...styles.secondary,padding:'6px 11px',fontSize:12}}
                    onClick={async () => {
                      const names = suggestedProducts
                        .filter((product) => selectedSuggestions.includes(product.id))
                        .map((product) => product.name)
                        .filter(Boolean);
                      if (!names.length) {
                        window.alert('Sélectionnez au moins un produit.');
                        return;
                      }
                      const textToCopy = names.join('\n');
                      try {
                        await navigator.clipboard.writeText(textToCopy);
                        window.alert(`${names.length} désignation(s) copiée(s).`);
                      } catch (error) {
                        window.prompt('Copiez les désignations :', textToCopy);
                      }
                    }}
                  >Copier ({selectedSuggestions.length})</button>
                  <button style={{...styles.secondary,padding:'6px 11px',fontSize:12}} onClick={() => setSelectedSuggestions([])}>Désélectionner</button>
                  <label className="ls-muted" style={{display:'flex',alignItems:'center',gap:6}}>
                    Lignes par page
                    <select style={{...styles.field,width:'auto'}} value={analysisPageSize} onChange={(event)=>{setAnalysisPageSize(Number(event.target.value));setAnalysisPage(1);}}>
                      {[10,20,100].map(n=><option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                </div>
                <div className="ls-toolbar" style={{flexWrap:'wrap'}}>
                  <ClearableSearchInput className="ls-search" style={styles.field} value={analysisSearch} onChange={(event)=>{setAnalysisSearch(event.target.value);setAnalysisPage(1);}} placeholder="Rechercher dans les suggestions…" />
                </div>
                {(() => { const filtered = suggestedProducts.filter(p=>matchesTableSearch(analysisSearch,p.name,p.product_ref)); const sorted = [...filtered].sort((a,b)=>{const av=a[analysisSortKey],bv=b[analysisSortKey]; const numeric=['current_quantity','average_daily_decrease','days_remaining','suggested_order_quantity'].includes(analysisSortKey); let c=numeric?(av==null?Number.POSITIVE_INFINITY:Number(av))-(bv==null?Number.POSITIVE_INFINITY:Number(bv)):String(av??'').localeCompare(String(bv??''),'fr',{numeric:true,sensitivity:'base'}); return analysisSortDirection==='asc'?c:-c;}); const pages=Math.max(1,Math.ceil(sorted.length/analysisPageSize)); const safe=Math.min(analysisPage,pages); const rows=sorted.slice((safe-1)*analysisPageSize,safe*analysisPageSize); return <>
                {filtered.length === 0 ? (
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
                          
                          <th style={styles.th}><button onClick={()=>{setAnalysisSortDirection(analysisSortKey==='name'&&analysisSortDirection==='asc'?'desc':'asc');setAnalysisSortKey('name');setAnalysisPage(1);}}>Désignation {analysisSortKey==='name'?(analysisSortDirection==='asc'?'▲':'▼'):''}</button></th>
                          <th style={styles.th}><button onClick={()=>{setAnalysisSortDirection(analysisSortKey==='current_quantity'&&analysisSortDirection==='asc'?'desc':'asc');setAnalysisSortKey('current_quantity');setAnalysisPage(1);}}>Dernière quantité CSV {analysisSortKey==='current_quantity'?(analysisSortDirection==='asc'?'▲':'▼'):''}</button></th>
                          <th style={styles.th}><button onClick={()=>{setAnalysisSortDirection(analysisSortKey==='average_daily_decrease'&&analysisSortDirection==='asc'?'desc':'asc');setAnalysisSortKey('average_daily_decrease');setAnalysisPage(1);}}>Baisse moyenne / jour {analysisSortKey==='average_daily_decrease'?(analysisSortDirection==='asc'?'▲':'▼'):''}</button></th>
                          <th style={styles.th}><button onClick={()=>{setAnalysisSortDirection(analysisSortKey==='days_remaining'&&analysisSortDirection==='asc'?'desc':'asc');setAnalysisSortKey('days_remaining');setAnalysisPage(1);}}>Jours restants estimés {analysisSortKey==='days_remaining'?(analysisSortDirection==='asc'?'▲':'▼'):''}</button></th>
                          <th style={styles.th}><button onClick={()=>{setAnalysisSortDirection(analysisSortKey==='suggested_order_quantity'&&analysisSortDirection==='asc'?'desc':'asc');setAnalysisSortKey('suggested_order_quantity');setAnalysisPage(1);}}>Quantité à commander {analysisSortKey==='suggested_order_quantity'?(analysisSortDirection==='asc'?'▲':'▼'):''}</button></th>
                          <th style={styles.th}><button onClick={()=>{setAnalysisSortDirection(analysisSortKey==='last_snapshot_date'&&analysisSortDirection==='asc'?'desc':'asc');setAnalysisSortKey('last_snapshot_date');setAnalysisPage(1);}}>Date du dernier relevé {analysisSortKey==='last_snapshot_date'?(analysisSortDirection==='asc'?'▲':'▼'):''}</button></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((product) => (
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
                <div className="ls-pagination"><span className="ls-muted">Page {Math.min(analysisPage, Math.max(1, Math.ceil(suggestedProducts.filter(p=>matchesTableSearch(analysisSearch,p.name,p.product_ref)).length/analysisPageSize)))} sur {Math.max(1, Math.ceil(suggestedProducts.filter(p=>matchesTableSearch(analysisSearch,p.name,p.product_ref)).length/analysisPageSize))}</span><div className="ls-toolbar" style={{margin:0}}><button style={styles.secondary} disabled={analysisPage<=1} onClick={()=>setAnalysisPage(p=>Math.max(1,p-1))}>← Précédent</button><button style={styles.secondary} disabled={analysisPage>=Math.max(1,Math.ceil(suggestedProducts.filter(p=>matchesTableSearch(analysisSearch,p.name,p.product_ref)).length/analysisPageSize))} onClick={()=>setAnalysisPage(p=>Math.min(Math.max(1,Math.ceil(suggestedProducts.filter(p=>matchesTableSearch(analysisSearch,p.name,p.product_ref)).length/analysisPageSize)),p+1))}>Suivant →</button></div></div>
                </>; })()}

                <div
                  style={{
                    marginTop: 28,
                    paddingTop: 22,
                    borderTop: '2px solid #e2e8f0',
                  }}
                >
                  <h2 style={{ marginTop: 0 }}>
                    Produits dont le stock a diminué
                  </h2>
                  <p className="ls-muted">
                    Comparaison du dernier PDF importé avec le PDF de référence
                    selon la période choisie. Seuls les produits dont la quantité a baissé sont affichés.
                  </p>
                  <div className="ls-toolbar" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                    <label className="ls-muted">Comparer avec le PDF d’il y a (jours)
                      <input type="number" min="1" max="3650" step="1" value={decreaseDays}
                        onChange={(event)=>{setDecreaseDays(Math.max(1, Math.min(3650, Number(event.target.value) || 1)));setDecreasePage(1);}}
                        style={{...styles.field,width:90,marginLeft:6}} />
                    </label>
                    <button style={{...styles.secondary,padding:'6px 11px',fontSize:12}} onClick={loadStockDecreaseAnalysis} disabled={stockDecreaseLoading}>
                      {stockDecreaseLoading ? 'Actualisation…' : 'Actualiser'}
                    </button>
                    <button style={{...styles.button,padding:'6px 11px',fontSize:12}} onClick={hideSelectedStockDecrease}>Masquer</button>
                    <button style={{...styles.secondary,padding:'6px 11px',fontSize:12}} onClick={async () => {
                      const names = stockDecreaseProducts
                        .filter((product) => selectedStockDecrease.includes(product.product_id))
                        .map((product) => product.product_name).filter(Boolean);
                      if (!names.length) { window.alert('Sélectionnez au moins un produit.'); return; }
                      const textToCopy = names.join('\n');
                      try { await navigator.clipboard.writeText(textToCopy); window.alert(`${names.length} désignation(s) copiée(s).`); }
                      catch (error) { window.prompt('Copiez les désignations :', textToCopy); }
                    }}>Copier ({selectedStockDecrease.length})</button>
                    <button style={{...styles.secondary,padding:'6px 11px',fontSize:12}} onClick={() => setSelectedStockDecrease([])}>Désélectionner</button>
                    <label className="ls-muted" style={{display:'flex',alignItems:'center',gap:6}}>
                      Lignes par page
                      <select style={{...styles.field,width:'auto'}} value={decreasePageSize} onChange={(event)=>{setDecreasePageSize(Number(event.target.value));setDecreasePage(1);}}>
                        {[10,20,100].map(n=><option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <span className="ls-muted">
                      {stockDecreaseProducts.length} produit(s) en baisse
                      {stockDecreaseProducts.length > 0 ? ` — période : ${stockDecreaseProducts[0].previous_date} → ${stockDecreaseProducts[0].latest_snapshot_date} (${stockDecreaseProducts[0].days_between} jour(s))` : ''}
                    </span>
                  </div>
                  <div className="ls-toolbar" style={{flexWrap:'wrap'}}>
                    <ClearableSearchInput className="ls-search" style={styles.field} value={decreaseSearch} onChange={(event)=>{setDecreaseSearch(event.target.value);setDecreasePage(1);}} placeholder="Rechercher référence ou désignation…" />
                  </div>

                  {stockDecreaseLoading ? (
                    <p>Chargement de l’analyse des baisses…</p>
                  ) : stockDecreaseProducts.length === 0 ? (
                    <p>
                      Aucune baisse trouvée entre le dernier PDF et le PDF de référence choisi, ou cliquez sur « Actualiser les baisses PDF ».
                    </p>
                  ) : (
                    <>
                    {(() => { const filtered=stockDecreaseProducts.filter(product=>matchesTableSearch(decreaseSearch,product.product_name,product.product_ref)); const sorted=[...filtered].sort((a,b)=>{const av=a[decreaseSortKey],bv=b[decreaseSortKey];const numeric=['previous_quantity','current_quantity','quantity_decreased','days_between'].includes(decreaseSortKey);const c=numeric?(Number(av)||0)-(Number(bv)||0):String(av??'').localeCompare(String(bv??''),'fr',{numeric:true,sensitivity:'base'});return decreaseSortDirection==='asc'?c:-c;});const pages=Math.max(1,Math.ceil(sorted.length/decreasePageSize));const safePage=Math.min(decreasePage,pages);const rows=sorted.slice((safePage-1)*decreasePageSize,safePage*decreasePageSize);return <>
                    <div className="ls-table-wrap">
                      <table className="ls-table stock-decrease-table">
                        <thead>
                          <tr>
                            <th style={styles.th}>Sélection</th>
                            
                            <th style={styles.th}><button onClick={()=>{setDecreaseSortDirection(decreaseSortKey==='product_name'&&decreaseSortDirection==='asc'?'desc':'asc');setDecreaseSortKey('product_name');setDecreasePage(1);}}>Désignation {decreaseSortKey==='product_name'?(decreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button onClick={()=>{setDecreaseSortDirection(decreaseSortKey==='previous_quantity'&&decreaseSortDirection==='asc'?'desc':'asc');setDecreaseSortKey('previous_quantity');setDecreasePage(1);}}>Quantité précédente {decreaseSortKey==='previous_quantity'?(decreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button onClick={()=>{setDecreaseSortDirection(decreaseSortKey==='current_quantity'&&decreaseSortDirection==='asc'?'desc':'asc');setDecreaseSortKey('current_quantity');setDecreasePage(1);}}>Quantité actuelle {decreaseSortKey==='current_quantity'?(decreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button onClick={()=>{setDecreaseSortDirection(decreaseSortKey==='quantity_decreased'&&decreaseSortDirection==='asc'?'desc':'asc');setDecreaseSortKey('quantity_decreased');setDecreasePage(1);}}>Baisse de quantité {decreaseSortKey==='quantity_decreased'?(decreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button onClick={()=>{setDecreaseSortDirection(decreaseSortKey==='previous_date'&&decreaseSortDirection==='asc'?'desc':'asc');setDecreaseSortKey('previous_date');setDecreasePage(1);}}>Date précédente {decreaseSortKey==='previous_date'?(decreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button onClick={()=>{setDecreaseSortDirection(decreaseSortKey==='latest_snapshot_date'&&decreaseSortDirection==='asc'?'desc':'asc');setDecreaseSortKey('latest_snapshot_date');setDecreasePage(1);}}>Dernière date {decreaseSortKey==='latest_snapshot_date'?(decreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                            <th style={styles.th}><button onClick={()=>{setDecreaseSortDirection(decreaseSortKey==='days_between'&&decreaseSortDirection==='asc'?'desc':'asc');setDecreaseSortKey('days_between');setDecreasePage(1);}}>Jours entre les fichiers {decreaseSortKey==='days_between'?(decreaseSortDirection==='asc'?'▲':'▼'):''}</button></th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((product) => (
                            <tr
                              key={`${product.product_id}-${product.previous_date}-${product.latest_snapshot_date}`}
                            >
                              <td style={styles.td}>
                                <input
                                  type="checkbox"
                                  checked={selectedStockDecrease.includes(product.product_id)}
                                  onChange={(event) =>
                                    setSelectedStockDecrease((current) =>
                                      event.target.checked
                                        ? [...current, product.product_id]
                                        : current.filter((id) => id !== product.product_id)
                                    )
                                  }
                                />
                              </td>
                              
                              <td style={styles.td}>{product.product_name || '—'}</td>
                              <td style={styles.td}>
                                {product.previous_quantity ?? '—'}
                              </td>
                              <td style={styles.td}>
                                {product.current_quantity ?? '—'}
                              </td>
                              <td
                                style={{
                                  ...styles.td,
                                  color: '#b42318',
                                  fontWeight: 800,
                                }}
                              >
                                −{product.quantity_decreased}
                              </td>
                              <td style={styles.td}>
                                {product.previous_date || '—'}
                              </td>
                              <td style={styles.td}>
                                {product.latest_snapshot_date || '—'}
                              </td>
                              <td style={styles.td}>
                                {product.days_between ?? '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="ls-pagination"><span className="ls-muted">Page {safePage} sur {pages} · {filtered.length} produit(s)</span><div className="ls-toolbar" style={{margin:0}}><button style={styles.secondary} disabled={safePage<=1} onClick={()=>setDecreasePage(p=>Math.max(1,p-1))}>← Précédent</button><button style={styles.secondary} disabled={safePage>=pages} onClick={()=>setDecreasePage(p=>Math.min(pages,p+1))}>Suivant →</button></div></div>
                    </>; })()}
                    </>
                  )}
                </div>
              </section>
            )}

            {activePage === 'hidden' && canViewPage('hidden') && (
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
                <div className="ls-toolbar" style={{flexWrap:'wrap'}}>
                  <ClearableSearchInput className="ls-search" style={styles.field} value={hiddenSearch} onChange={(event)=>{setHiddenSearch(event.target.value);setHiddenPage(1);}} placeholder="Rechercher un produit masqué…" />
                  <label className="ls-muted">Lignes par page <select style={styles.field} value={hiddenPageSize} onChange={(event)=>{setHiddenPageSize(Number(event.target.value));setHiddenPage(1);}}>{[10,20,100].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
                  <label className="ls-muted">Trier par <select style={styles.field} value={hiddenSortKey} onChange={(event)=>{setHiddenSortKey(event.target.value);setHiddenPage(1);}}><option value="name">Désignation</option><option value="current_quantity">Quantité</option></select></label>
                  <button style={styles.secondary} onClick={()=>{setHiddenSortDirection(d=>d==='asc'?'desc':'asc');setHiddenPage(1);}}>{hiddenSortDirection==='asc'?'Croissant ▲':'Décroissant ▼'}</button>
                </div>
                {(() => {const filtered=hiddenProducts.filter(product=>matchesTableSearch(hiddenSearch,product.name,product.product_ref));const sorted=[...filtered].sort((a,b)=>{const av=a[hiddenSortKey],bv=b[hiddenSortKey];const c=hiddenSortKey==='current_quantity'?(Number(av)||0)-(Number(bv)||0):String(av??'').localeCompare(String(bv??''),'fr',{numeric:true,sensitivity:'base'});return hiddenSortDirection==='asc'?c:-c;});const pages=Math.max(1,Math.ceil(sorted.length/hiddenPageSize));const safe=Math.min(hiddenPage,pages);const rows=sorted.slice((safe-1)*hiddenPageSize,safe*hiddenPageSize);return <>
                {filtered.length === 0 ? (
                  <p>Aucun produit masqué.</p>
                ) : (
                  <div className="ls-table-wrap">
                    <table className="ls-table">
                      <thead>
                        <tr>
                          
                          <th style={styles.th}>Désignation</th>
                          <th style={styles.th}>Quantité</th>
                          <th style={styles.th}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((product) => (
                          <tr key={product.id}>
                            
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
                <div className="ls-pagination"><span className="ls-muted">Page {safe} sur {pages} · {filtered.length} produit(s)</span><div className="ls-toolbar" style={{margin:0}}><button style={styles.secondary} disabled={safe<=1} onClick={()=>setHiddenPage(p=>Math.max(1,p-1))}>← Précédent</button><button style={styles.secondary} disabled={safe>=pages} onClick={()=>setHiddenPage(p=>Math.min(pages,p+1))}>Suivant →</button></div></div>
                </>;})()}
              </section>
            )}


            {activePage === 'sales' && canViewPage('sales') && (
              <section className="ls-panel">
                <h2>Bon de vente</h2>
                <div className="ls-toolbar"><button type="button" style={styles.secondary} onClick={() => { setScannerStatus(''); setScannerTarget('sales'); }}>Scanner QR pour ajouter un produit</button></div>
                {scannerTarget === 'sales' && <div className="ls-panel" style={{marginTop:10,border:'1px solid #94a3b8'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}><strong>Scanner QR — Bon de vente</strong><button type="button" style={styles.secondary} onClick={() => setScannerTarget(null)}>Fermer</button></div><video ref={scannerVideoRef} playsInline muted style={{display:'block',width:'100%',maxWidth:420,maxHeight:300,objectFit:'cover',margin:'12px auto',background:'#111827',borderRadius:10}}/><p className="ls-muted">{scannerStatus || 'Démarrage de la caméra…'}</p></div>}
                <label style={{display:'block',fontWeight:700,marginBottom:6}}>Nom du client</label>
                <input style={styles.field} value={salesCustomer} onChange={(e)=>setSalesCustomer(e.target.value)} placeholder="Nom du client" />
                <div style={{marginTop:14}}>
                  <ClearableSearchInput style={styles.field} value={salesSearch} onChange={(e)=>setSalesSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'){e.preventDefault();const first=catalogProducts.find(p=>productMatchesSearch(p,salesSearch));if(first)addSalesLine(first,salesAddQuantities[`${first.catalog_source}:${first.id}`] ?? 1);}}} placeholder="Rechercher par désignation ou référence… (Entrée pour ajouter le premier résultat)" />
                  {salesSearch.trim() && <div className="ls-table-wrap ls-force-table" style={{marginTop:10}}>
                    <table className="ls-table label-picker-table sales-search-table">
                      <colgroup><col style={{width:"38%"}}/><col style={{width:"24%"}}/><col style={{width:"22%"}}/><col style={{width:"16%"}}/></colgroup>
                      <thead><tr><th style={styles.th}>Désignation</th><th style={styles.th}>Prix de gros</th><th style={styles.th}>Quantité</th><th style={styles.th}>Action</th></tr></thead>
                      <tbody>{catalogProducts.filter(p=>productMatchesSearch(p,salesSearch)).slice(0,20).map(p=><tr key={`${p.catalog_source}:${p.id}`}>
                        <td style={styles.td}><strong>{p.name}</strong>{p.catalog_source==='tapis_products' ? <small style={{display:"block",color:"#64748b"}}>Tapis</small> : null}</td>
                        <td style={styles.td}>{Number(p.wholesale_price||0).toFixed(2)} DA</td>
                        <td style={styles.td}><div className="label-qty-control"><input type="number" min="0.01" step="any" aria-label={`Quantité à ajouter pour ${p.name}`} style={{...styles.field,width:82}} value={salesAddQuantities[`${p.catalog_source}:${p.id}`] ?? '1'} onChange={e=>setSalesAddQuantities(current=>({...current,[`${p.catalog_source}:${p.id}`]:e.target.value}))}/><button type="button" className="label-qty-plus" aria-label="Augmenter la quantité" onClick={()=>setSalesAddQuantities(current=>({...current,[`${p.catalog_source}:${p.id}`]:String((Number(current[`${p.catalog_source}:${p.id}`]||1)||1)+1)}))}>+</button></div></td>
                        <td style={styles.td}><button type="button" style={styles.button} onClick={()=>addSalesLine(p,salesAddQuantities[`${p.catalog_source}:${p.id}`] ?? 1)}>Ajouter</button></td>
                      </tr>)}
                      {catalogProducts.filter(p=>productMatchesSearch(p,salesSearch)).length===0 && <tr><td style={styles.td} colSpan={4}>Aucun produit trouvé.</td></tr>}</tbody>
                    </table>
                  </div>}
                </div>
                {salesLines.length > 0 ? <div className="ls-table-wrap ls-force-table" style={{marginTop:16}}><table className="ls-table sales-lines-table"><colgroup><col style={{width:"34%"}}/><col style={{width:"16%"}}/><col style={{width:"18%"}}/><col style={{width:"18%"}}/><col style={{width:"14%"}}/></colgroup><thead><tr><th style={styles.th}>Désignation</th><th style={styles.th}>Quantité</th><th style={styles.th}>Prix de gros</th><th style={styles.th}>Total</th><th style={styles.th}>Action</th></tr></thead><tbody>{salesLines.map(line=><tr key={`${line.catalog_source}:${line.id}`}><td style={styles.td}><div style={{display:'flex',alignItems:'center',gap:8}}>{line.catalog_source !== 'tapis_products' && photoFor(line.id) ? <img src={photoFor(line.id)} alt="" style={{width:38,height:38,objectFit:'cover',borderRadius:6,flexShrink:0}} /> : null}<span>{line.name}{line.catalog_source === 'tapis_products' ? <small style={{marginInlineStart:7,color:'#64748b'}}>Tapis</small> : null}</span></div></td><td style={styles.td}><div className="label-qty-control"><input type="number" min="0.01" step="any" style={{...styles.field,width:100}} value={line.quantity} onChange={(e)=>setSalesLines(cur=>cur.map(x=>x.id===line.id && x.catalog_source===line.catalog_source?{...x,quantity:Math.max(0,Number(e.target.value)||0)}:x))}/><button type="button" className="label-qty-plus" aria-label="Augmenter la quantité" onClick={()=>setSalesLines(cur=>cur.map(x=>x.id===line.id && x.catalog_source===line.catalog_source?{...x,quantity:(Number(x.quantity)||0)+1}:x))}>+</button></div></td><td style={styles.td}>{Number(line.wholesale_price||0).toFixed(2)} DA</td><td style={styles.td}>{(Number(line.quantity||0)*Number(line.wholesale_price||0)).toFixed(2)} DA</td><td style={styles.td}><button style={styles.secondary} onClick={()=>setSalesLines(cur=>cur.filter(x=>!(x.id===line.id && x.catalog_source===line.catalog_source)))}>Retirer</button></td></tr>)}</tbody></table></div> : <p className="ls-muted">Aucun produit ajouté.</p>}
                <h3 style={{textAlign:'right'}}>Total : {salesTotal.toFixed(2)} DA</h3>
                <button style={styles.button} disabled={pdfBusy || salesLines.length===0} onClick={()=>makePdf('invoice','download')}>{pdfBusy?'Enregistrement…':'Enregistrer et télécharger PDF'}</button>
                <button style={{...styles.secondary,marginLeft:8}} disabled={pdfBusy || salesLines.length===0} onClick={()=>makePdf('invoice','share')}>{pdfBusy?'Préparation…':'Enregistrer et partager PDF'}</button>
                <button style={{...styles.secondary,marginLeft:8,marginTop:8}} onClick={()=>{setSalesCustomer('');setSalesLines([]);setSalesSearch('');setSalesAddQuantities({});}}>Nouveau bon</button>
                <h3 style={{marginTop:28}}>Mes bons de vente / Historique</h3>
                {documentsLoading ? <p className="ls-muted">Chargement de l’historique…</p> : savedPdfDocuments.filter(d=>d.doc_type==='invoice').length===0 ? <p className="ls-muted">Aucun bon enregistré.</p> : <><div className="ls-toolbar" style={{marginBottom:10}}><label style={{display:'inline-flex',alignItems:'center',gap:6}}><input type="checkbox" checked={savedPdfDocuments.filter(d=>d.doc_type==='invoice').length>0 && selectedInvoiceDocuments.length===savedPdfDocuments.filter(d=>d.doc_type==='invoice').length} onChange={e=>setSelectedInvoiceDocuments(e.target.checked?savedPdfDocuments.filter(d=>d.doc_type==='invoice').map(d=>d.id):[])} /> Tout sélectionner</label><button type="button" style={styles.secondary} disabled={!selectedInvoiceDocuments.length} onClick={()=>deleteSelectedPdfDocuments('invoice',selectedInvoiceDocuments,setSelectedInvoiceDocuments)}>Supprimer la sélection ({selectedInvoiceDocuments.length})</button></div><div className="ls-table-wrap"><table className="ls-table"><thead><tr><th style={styles.th}>Choix</th><th style={styles.th}>Date</th><th style={styles.th}>Client</th><th style={styles.th}>Total</th><th style={styles.th}>Produits</th><th style={styles.th}>Consulter</th><th style={styles.th}>Action</th></tr></thead><tbody>{savedPdfDocuments.filter(d=>d.doc_type==='invoice').map(d=><tr key={d.id}><td style={styles.td}><input type="checkbox" checked={selectedInvoiceDocuments.includes(d.id)} onChange={e=>setSelectedInvoiceDocuments(current=>e.target.checked?[...current,d.id]:current.filter(id=>id!==d.id))} /></td><td style={styles.td}>{d.document_date}</td><td style={styles.td}>{d.customer_name || '—'}</td><td style={styles.td}>{Number(d.total||0).toFixed(2)} DA</td><td style={styles.td}>{Array.isArray(d.items)?d.items.length:0}</td><td style={styles.td}><details><summary style={{cursor:'pointer',fontWeight:700}}>Voir le bon</summary><div style={{minWidth:220,paddingTop:8}}><div>Client : {d.customer_name || '—'}</div>{(Array.isArray(d.items)?d.items:[]).map((item,index)=><div key={item.product_id || index} style={{padding:'6px 0',borderBottom:'1px solid #e5eaf0'}}><strong>{item.name}</strong><div className="ls-muted">{item.quantity} × {Number(item.unit_price||0).toFixed(2)} DA = {Number(item.line_total||0).toFixed(2)} DA</div></div>)}<strong>Total : {Number(d.total||0).toFixed(2)} DA</strong></div></details></td><td style={styles.td}><button type="button" style={styles.secondary} onClick={()=>deleteSavedPdfDocument(d.id)}>Supprimer</button></td></tr>)}</tbody></table></div></>}
              </section>
            )}


            {activePage === 'barcode' && canViewPage('barcode') && (
              <section className="ls-panel">
                <h2>Code à barre — Étiquettes QR</h2>
                <p className="ls-muted">Le QR contient le numéro Logicom de REFERENCE 1. Linge et Tapis sont recherchés ensemble sans fusionner leurs tables.</p>
                <h3 style={{marginTop:20}}>1. Ajouter des produits</h3>
                <ClearableSearchInput style={{...styles.field,marginTop:4}} value={barcodeSearch} onChange={(e)=>setBarcodeSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'){e.preventDefault();const first=catalogProducts.find(p=>productMatchesSearch(p,barcodeSearch)&&String(p.reference_1||'').trim());if(first)addBarcodeLine(first,barcodeAddQuantities[`${first.catalog_source}:${first.id}`] ?? 1);}}} placeholder="Rechercher par désignation, référence ou numéro Logicom…" />
                {barcodeSearch.trim() && <div className="ls-table-wrap" style={{marginTop:10}}><table className="ls-table barcode-picker-table"><colgroup><col style={{width:"43%"}}/><col style={{width:"24%"}}/><col style={{width:"19%"}}/><col style={{width:"14%"}}/></colgroup><thead><tr><th style={styles.th}>Désignation</th><th style={styles.th}>Famille</th><th style={styles.th}>Nombre</th><th style={styles.th}>Action</th></tr></thead><tbody>
                  {catalogProducts.filter(p=>productMatchesSearch(p,barcodeSearch)).slice(0,30).map(p=><tr key={`${p.catalog_source}:${p.id}`}><td style={styles.td}><strong>{p.name}</strong></td><td style={styles.td}>{p.catalog_source==='tapis_products'?'Tapis':'Catalogue principal'}</td><td style={styles.td}><div className="label-qty-control"><input type="number" min="1" max="500" step="1" style={{...styles.field,width:90}} value={barcodeAddQuantities[`${p.catalog_source}:${p.id}`] ?? '1'} onChange={e=>setBarcodeAddQuantities(current=>({...current,[`${p.catalog_source}:${p.id}`]:e.target.value}))}/><button type="button" className="label-qty-plus" aria-label="Augmenter le nombre" onClick={()=>setBarcodeAddQuantities(current=>({...current,[`${p.catalog_source}:${p.id}`]:String(Math.min(500,Math.max(1,Number(current[`${p.catalog_source}:${p.id}`]||1))+1))}))}>+</button></div></td><td style={styles.td}><button type="button" style={styles.button} disabled={!p.reference_1} onClick={()=>addBarcodeLine(p,barcodeAddQuantities[`${p.catalog_source}:${p.id}`] ?? 1)}>Ajouter</button></td></tr>)}
                  {catalogProducts.filter(p=>productMatchesSearch(p,barcodeSearch)).length===0 && <tr><td style={styles.td} colSpan={4}>Aucun produit trouvé.</td></tr>}
                </tbody></table></div>}
                <h3 style={{marginTop:24}}>2. Produits choisis ({barcodeLines.length})</h3>
                {barcodeLines.length===0 ? <p className="ls-muted">Aucun produit ajouté.</p> : <div className="ls-table-wrap"><table className="ls-table barcode-picker-table"><colgroup><col style={{width:"48%"}}/><col style={{width:"32%"}}/><col style={{width:"20%"}}/></colgroup><thead><tr><th style={styles.th}>Désignation</th><th style={styles.th}>Nombre d’étiquettes</th><th style={styles.th}>Action</th></tr></thead><tbody>{barcodeLines.map(line=><tr key={`${line.catalog_source}:${line.id}`}><td style={styles.td}>{line.name}</td><td style={styles.td}><div className="label-qty-control"><input type="number" min="1" max="500" step="1" style={{...styles.field,width:110}} value={line.quantity} onChange={e=>updateBarcodeLineQuantity(line,e.target.value)}/><button type="button" className="label-qty-plus" aria-label="Augmenter le nombre d’étiquettes" onClick={()=>updateBarcodeLineQuantity(line,Math.min(500,Math.max(1,Number(line.quantity)||1)+1))}>+</button></div></td><td style={styles.td}><button type="button" style={styles.secondary} onClick={()=>setBarcodeLines(current=>current.filter(item=>!(String(item.id)===String(line.id)&&item.catalog_source===line.catalog_source)))}>Retirer</button></td></tr>)}</tbody></table></div>}
                <p className="ls-muted">Dimensions selon Paramètres → Dimensions des documents PDF. QR à gauche, désignation à droite. Limite : 500 étiquettes par PDF.</p>
                <div className="ls-toolbar"><button type="button" style={styles.button} disabled={pdfBusy||barcodeLines.length===0||barcodeLines.reduce((sum,line)=>sum+Math.max(0,Number(line.quantity)||0),0)>500} onClick={makeBarcodePdf}>{pdfBusy?'Préparation…':'Générer et télécharger le PDF QR'}</button><button type="button" style={styles.secondary} onClick={()=>{setBarcodeLines([]);setBarcodeSearch('');setBarcodeAddQuantities({});}}>Vider la sélection</button></div>
              </section>
            )}

            {activePage === 'labels' && canViewPage('labels') && (
              <section className="ls-panel">
                <h2>Étiquettes prix</h2>
                <h3 style={{marginTop:22}}>1. Ajouter des produits</h3>
                <label style={{display:'inline-flex',alignItems:'center',gap:7,margin:'8px 0 10px',fontWeight:600}}><input type="checkbox" checked={hideLabelPrice} onChange={(e)=>setHideLabelPrice(e.target.checked)} /> Masquer prix</label>
                <ClearableSearchInput style={{...styles.field,marginTop:4}} value={labelSearch} onChange={(e)=>setLabelSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'){e.preventDefault();const first=catalogProducts.find(p=>productMatchesSearch(p,labelSearch));if(first)addLabelLine(first,labelAddQuantities[`${first.catalog_source}:${first.id}`] ?? 1);}}} placeholder="Rechercher par désignation ou référence… (Entrée pour ajouter le premier résultat)" />
                {labelSearch.trim() && (
                  <div className="ls-table-wrap ls-force-table" style={{marginTop:10}}>
                    <table className="ls-table label-picker-table">
                      <colgroup>{hideLabelPrice ? <><col style={{width:'34%'}}/><col style={{width:'33%'}}/><col style={{width:'33%'}}/></> : <><col style={{width:'34%'}}/><col style={{width:'19%'}}/><col style={{width:'27%'}}/><col style={{width:'20%'}}/></>}</colgroup>
                      <thead><tr><th style={styles.th}>Désignation</th>{!hideLabelPrice && <th style={styles.th}>Prix détail</th>}<th style={styles.th}>Quantité</th><th style={styles.th}>Action</th></tr></thead>
                      <tbody>
                        {catalogProducts.filter(p=>productMatchesSearch(p, labelSearch)).slice(0,30).map(p=>(
                          <tr key={`${p.catalog_source}:${p.id}`}>
                            <td style={styles.td}><strong>{p.name}{p.catalog_source === 'tapis_products' ? <small style={{marginInlineStart:7,color:'#64748b'}}>Tapis</small> : null}</strong></td>
                            {!hideLabelPrice && <td style={styles.td}>{Number(p.retail_price||0).toFixed(2)} DA</td>}
                            <td style={styles.td}><div className="label-qty-control"><input type="number" min="1" max="500" step="1" aria-label={`Nombre d’étiquettes à ajouter pour ${p.name}`} style={{...styles.field,width:90}} value={labelAddQuantities[`${p.catalog_source}:${p.id}`] ?? '1'} onChange={(e)=>setLabelAddQuantities(current=>({...current,[`${p.catalog_source}:${p.id}`]:e.target.value}))} /><button type="button" className="label-qty-plus" aria-label={`Augmenter la quantité pour ${p.name}`} onClick={()=>setLabelAddQuantities(current=>({...current,[`${p.catalog_source}:${p.id}`]:String(Math.min(500,Math.max(1,Number(current[`${p.catalog_source}:${p.id}`]||1))+1))}))}>+</button></div></td>
                            <td style={styles.td}><button type="button" style={styles.button} onClick={()=>addLabelLine(p,labelAddQuantities[`${p.catalog_source}:${p.id}`] ?? 1)}>Ajouter</button></td>
                          </tr>
                        ))}
                        {catalogProducts.filter(p=>productMatchesSearch(p, labelSearch)).length===0 && <tr><td style={styles.td} colSpan={hideLabelPrice ? 3 : 4}>Aucun produit trouvé.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
                {labelLines.length > 0 && (
                  <div className="ls-table-wrap ls-force-table" style={{marginTop:16}}>
                    <table className="ls-table label-picker-table">
                      <colgroup>{hideLabelPrice ? <><col style={{width:'34%'}}/><col style={{width:'33%'}}/><col style={{width:'33%'}}/></> : <><col style={{width:'34%'}}/><col style={{width:'19%'}}/><col style={{width:'27%'}}/><col style={{width:'20%'}}/></>}</colgroup>
                      <thead><tr><th style={styles.th}>Désignation</th>{!hideLabelPrice && <th style={styles.th}>Prix détail</th>}<th style={styles.th}>Quantité</th><th style={styles.th}>Action</th></tr></thead>
                      <tbody>
                        {labelLines.map(line=>(
                          <tr key={`${line.catalog_source}:${line.id}`}>
                            <td style={styles.td}><strong>{line.name}</strong></td>
                            {!hideLabelPrice && <td style={styles.td}>{Number(line.retail_price||0).toFixed(2)} DA</td>}
                            <td style={styles.td}><div className="label-qty-control"><input type="number" min="1" max="500" step="1" aria-label={`Nombre d’étiquettes pour ${line.name}`} style={{...styles.field,width:90}} value={line.quantity} onChange={e=>updateLabelLineQuantity(line,e.target.value)} /><button type="button" className="label-qty-plus" aria-label={`Augmenter la quantité pour ${line.name}`} onClick={()=>updateLabelLineQuantity(line,Math.min(500,Number(line.quantity||0)+1))}>+</button></div></td>
                            <td style={styles.td}><button type="button" style={styles.secondary} onClick={()=>setLabelLines(current=>current.filter(item=>!(String(item.id)===String(line.id)&&item.catalog_source===line.catalog_source)))}>Retirer</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="ls-toolbar">
                  <button style={styles.button} disabled={pdfBusy || labelLines.length===0 || labelLines.reduce((sum,line)=>sum+Math.max(0,Number(line.quantity)||0),0)>500} onClick={()=>makePdf('labels','download')}>{pdfBusy?'Enregistrement…':'Enregistrer et télécharger PDF'}</button>
                  <button style={styles.secondary} disabled={pdfBusy || labelLines.length===0 || labelLines.reduce((sum,line)=>sum+Math.max(0,Number(line.quantity)||0),0)>500} onClick={()=>makePdf('labels','share')}>{pdfBusy?'Préparation…':'Enregistrer et partager PDF'}</button>
                  <button type="button" style={styles.secondary} disabled={pdfBusy || (labelLines.length===0 && !labelDocumentTitle && !labelSearch)} onClick={()=>{setLabelLines([]);setLabelSearch('');setLabelDocumentTitle('');setLabelAddQuantities({});}}>Nouveau document</button>
                </div>
                <div style={{marginTop:30,paddingTop:20,borderTop:'1px solid #dbe3ec'}}>
                  <h2>Prix couloir</h2>
                  <p className="ls-muted">Étiquettes carrées 100 × 100 mm. Nom du produit, largeur extraite de la désignation et prix extrait de DETAIL.</p>
                  <ClearableSearchInput style={{...styles.field,marginTop:4}} value={couloirSearch} onChange={(e)=>setCouloirSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'){e.preventDefault();const first=catalogProducts.find(p=>productMatchesSearch(p,couloirSearch));if(first)addCouloirLine(first,1);}}} placeholder="Rechercher un produit couloir…"/>
                  {couloirSearch.trim() && <div className="ls-table-wrap ls-force-table" style={{marginTop:10}}><table className="ls-table"><colgroup><col style={{width:'48%'}}/><col style={{width:'32%'}}/><col style={{width:'20%'}}/></colgroup><thead><tr><th style={styles.th}>Désignation</th><th style={styles.th}>Quantité</th><th style={styles.th}>Action</th></tr></thead><tbody>
                    {/* Prix couloir search table: Désignation, Quantité, Action */}
                  {catalogProducts.filter(p=>productMatchesSearch(p,couloirSearch)).slice(0,30).map(p=><tr key={`${p.catalog_source}:${p.id}`}><td style={styles.td}><strong>{p.name}{p.catalog_source==='tapis_products'?<small style={{marginInlineStart:7,color:'#64748b'}}>Tapis</small>:null}</strong></td><td style={styles.td}><div className="label-qty-control"><input type="number" min="1" max="500" step="1" aria-label={`Quantité à ajouter pour ${p.name}`} style={{...styles.field,width:90}} value={couloirAddQuantities[`${p.catalog_source}:${p.id}`] ?? '1'} onChange={e=>setCouloirAddQuantities(current=>({...current,[`${p.catalog_source}:${p.id}`]:e.target.value}))}/><button type="button" className="label-qty-plus" aria-label={`Augmenter la quantité pour ${p.name}`} onClick={()=>setCouloirAddQuantities(current=>({...current,[`${p.catalog_source}:${p.id}`]:String(Math.min(500,Math.max(1,Number(current[`${p.catalog_source}:${p.id}`]||1))+1))}))}>+</button></div></td><td style={styles.td}><button type="button" style={styles.button} onClick={()=>addCouloirLine(p,couloirAddQuantities[`${p.catalog_source}:${p.id}`] ?? 1)}>Ajouter</button></td></tr>)}
                    {catalogProducts.filter(p=>productMatchesSearch(p,couloirSearch)).length===0 && <tr><td style={styles.td} colSpan={3}>Aucun produit trouvé.</td></tr>}
                  </tbody></table></div>}
                  {couloirLines.length>0 && <div className="ls-table-wrap" style={{marginTop:14}}><table className="ls-table"><thead><tr><th style={styles.th}>Désignation</th><th style={styles.th}>LARGEUR</th><th style={styles.th}>PRIX</th><th style={styles.th}>Nombre</th><th style={styles.th}>Action</th></tr></thead><tbody>
                    {couloirLines.map(line=>{const data=getCouloirLabelData(line);return <tr key={`${line.catalog_source}:${line.id}`}><td style={styles.td}>{line.name}</td><td style={styles.td}>{data.width||'—'}</td><td style={styles.td}>{data.price||'—'}</td><td style={styles.td}><input type="number" min="1" max="500" style={{...styles.field,width:78}} value={line.quantity} onChange={e=>updateCouloirLineQuantity(line,e.target.value)}/></td><td style={styles.td}><button type="button" style={styles.secondary} onClick={()=>setCouloirLines(current=>current.filter(item=>!(String(item.id)===String(line.id)&&item.catalog_source===line.catalog_source)))}>Retirer</button></td></tr>})}
                  </tbody></table></div>}
                  <div className="ls-toolbar" style={{marginTop:12}}>
                    <button type="button" style={styles.button} disabled={pdfBusy||couloirLines.length===0||couloirLines.reduce((sum,line)=>sum+Math.max(0,Number(line.quantity)||0),0)>500} onClick={makeCouloirPdf}>{pdfBusy?'Préparation…':'Générer PDF Prix couloir'}</button>
                    <button type="button" style={styles.secondary} onClick={()=>{setCouloirLines([]);setCouloirSearch('');}}>Vider la sélection</button>
                  </div>
                </div>
                <div style={{marginTop:30,paddingTop:20,borderTop:'1px solid #dbe3ec'}}>
                  <h2>Prix moquette mosquée</h2>
                  <p className="ls-muted">Étiquettes carrées 100 × 100 mm. Nom du produit, largeur extraite de la désignation et prix extrait de DETAIL.</p>
                  <ClearableSearchInput style={{...styles.field,marginTop:4}} value={moquetteSearch} onChange={(e)=>setMoquetteSearch(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'){e.preventDefault();const first=catalogProducts.find(p=>productMatchesSearch(p,moquetteSearch));if(first)addMoquetteLine(first,1);}}} placeholder="Rechercher un produit moquette…"/>
                  {moquetteSearch.trim() && <div className="ls-table-wrap ls-force-table" style={{marginTop:10}}><table className="ls-table"><colgroup><col style={{width:'48%'}}/><col style={{width:'32%'}}/><col style={{width:'20%'}}/></colgroup><thead><tr><th style={styles.th}>Désignation</th><th style={styles.th}>Quantité</th><th style={styles.th}>Action</th></tr></thead><tbody>
                    {/* Prix moquette mosquée search table: Désignation, Quantité, Action */}
                  {catalogProducts.filter(p=>productMatchesSearch(p,moquetteSearch)).slice(0,30).map(p=><tr key={`${p.catalog_source}:${p.id}`}><td style={styles.td}><strong>{p.name}{p.catalog_source==='tapis_products'?<small style={{marginInlineStart:7,color:'#64748b'}}>Tapis</small>:null}</strong></td><td style={styles.td}><div className="label-qty-control"><input type="number" min="1" max="500" step="1" aria-label={`Quantité à ajouter pour ${p.name}`} style={{...styles.field,width:90}} value={moquetteAddQuantities[`${p.catalog_source}:${p.id}`] ?? '1'} onChange={e=>setMoquetteAddQuantities(current=>({...current,[`${p.catalog_source}:${p.id}`]:e.target.value}))}/><button type="button" className="label-qty-plus" aria-label={`Augmenter la quantité pour ${p.name}`} onClick={()=>setMoquetteAddQuantities(current=>({...current,[`${p.catalog_source}:${p.id}`]:String(Math.min(500,Math.max(1,Number(current[`${p.catalog_source}:${p.id}`]||1))+1))}))}>+</button></div></td><td style={styles.td}><button type="button" style={styles.button} onClick={()=>addMoquetteLine(p,moquetteAddQuantities[`${p.catalog_source}:${p.id}`] ?? 1)}>Ajouter</button></td></tr>)}
                    {catalogProducts.filter(p=>productMatchesSearch(p,moquetteSearch)).length===0 && <tr><td style={styles.td} colSpan={3}>Aucun produit trouvé.</td></tr>}
                  </tbody></table></div>}
                  {moquetteLines.length>0 && <div className="ls-table-wrap" style={{marginTop:14}}><table className="ls-table"><thead><tr><th style={styles.th}>Désignation</th><th style={styles.th}>LARGEUR</th><th style={styles.th}>PRIX</th><th style={styles.th}>Nombre</th><th style={styles.th}>Action</th></tr></thead><tbody>
                    {moquetteLines.map(line=>{const data=getMoquetteLabelData(line);return <tr key={`${line.catalog_source}:${line.id}`}><td style={styles.td}>{line.name}</td><td style={styles.td}>{data.width||'—'}</td><td style={styles.td}>{data.price||'—'}</td><td style={styles.td}><input type="number" min="1" max="500" style={{...styles.field,width:78}} value={line.quantity} onChange={e=>updateMoquetteLineQuantity(line,e.target.value)}/></td><td style={styles.td}><button type="button" style={styles.secondary} onClick={()=>setMoquetteLines(current=>current.filter(item=>!(String(item.id)===String(line.id)&&item.catalog_source===line.catalog_source)))}>Retirer</button></td></tr>})}
                  </tbody></table></div>}
                  <div className="ls-toolbar" style={{marginTop:12}}>
                    <button type="button" style={styles.button} disabled={pdfBusy||moquetteLines.length===0||moquetteLines.reduce((sum,line)=>sum+Math.max(0,Number(line.quantity)||0),0)>500} onClick={makeMoquettePdf}>{pdfBusy?'Préparation…':'Générer PDF Prix moquette mosquée'}</button>
                    <button type="button" style={styles.secondary} onClick={()=>{setMoquetteLines([]);setMoquetteSearch('');}}>Vider la sélection</button>
                  </div>
                </div>
                <h3 style={{marginTop:28}}>Mes documents d’étiquettes / Historique</h3>
                {documentsLoading ? <p className="ls-muted">Chargement de l’historique…</p> : savedPdfDocuments.filter(d=>d.doc_type==='labels').length===0 ? <p className="ls-muted">Aucun document enregistré.</p> : <><div className="ls-toolbar" style={{marginBottom:10}}><label style={{display:'inline-flex',alignItems:'center',gap:6}}><input type="checkbox" checked={savedPdfDocuments.filter(d=>d.doc_type==='labels').length>0 && selectedLabelDocuments.length===savedPdfDocuments.filter(d=>d.doc_type==='labels').length} onChange={e=>setSelectedLabelDocuments(e.target.checked?savedPdfDocuments.filter(d=>d.doc_type==='labels').map(d=>d.id):[])} /> Tout sélectionner</label><button type="button" style={styles.secondary} disabled={!selectedLabelDocuments.length} onClick={()=>deleteSelectedPdfDocuments('labels',selectedLabelDocuments,setSelectedLabelDocuments)}>Supprimer la sélection ({selectedLabelDocuments.length})</button></div><div className="ls-table-wrap"><table className="ls-table"><thead><tr><th style={styles.th}>Choix</th><th style={styles.th}>Date</th><th style={styles.th}>Document</th><th style={styles.th}>Nombre d’étiquettes</th><th style={styles.th}>Consulter</th><th style={styles.th}>Action</th></tr></thead><tbody>{savedPdfDocuments.filter(d=>d.doc_type==='labels').map(d=><tr key={d.id}><td style={styles.td}><input type="checkbox" checked={selectedLabelDocuments.includes(d.id)} onChange={e=>setSelectedLabelDocuments(current=>e.target.checked?[...current,d.id]:current.filter(id=>id!==d.id))} /></td><td style={styles.td}>{d.document_date}</td><td style={styles.td}>{d.title || 'Étiquettes prix'}</td><td style={styles.td}>{Number(d.total||0)}</td><td style={styles.td}><details><summary style={{cursor:'pointer',fontWeight:700}}>Voir les étiquettes</summary><div style={{minWidth:220,paddingTop:8}}>{(Array.isArray(d.items)?d.items:[]).map((item,index)=><div key={item.product_id || index} style={{padding:'6px 0',borderBottom:'1px solid #e5eaf0'}}><strong>{item.name}</strong><div className="ls-muted">{item.quantity} étiquette(s) · {Number(item.retail_price||0).toFixed(2)} DA</div></div>)}</div></details></td><td style={styles.td}><button type="button" style={styles.secondary} onClick={()=>deleteSavedPdfDocument(d.id)}>Supprimer</button></td></tr>)}</tbody></table></div></>}
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
                    <option value="system">Système (selon l’appareil)</option>
                  </select>
                </div>

                {isAdmin && (
                  <section className="ls-panel" style={{marginBottom:18}}>
                    <h3 style={{marginTop:0}}>Dimensions des documents PDF (cm)</h3>
                    <p className="ls-muted">Seul l’administrateur peut modifier les dimensions. Les étiquettes sont réglées par défaut à 5 × 3 cm.</p>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>
                      <label>Bon de vente — largeur (cm)<input type="number" min="0.1" max="100" step="0.1" style={styles.field} value={printSettings.invoice_width_cm} onChange={(e)=>setPrintSettings(s=>({...s,invoice_width_cm:e.target.value}))}/></label>
                      <label>Bon de vente — hauteur (cm)<input type="number" min="0.1" max="100" step="0.1" style={styles.field} value={printSettings.invoice_height_cm} onChange={(e)=>setPrintSettings(s=>({...s,invoice_height_cm:e.target.value}))}/></label>
                      <label>Étiquette — longueur / largeur (cm)<input type="number" min="0.1" max="100" step="0.1" style={styles.field} value={printSettings.label_width_cm} onChange={(e)=>setPrintSettings(s=>({...s,label_width_cm:e.target.value}))}/></label>
                      <label>Étiquette — hauteur (cm)<input type="number" min="0.1" max="100" step="0.1" style={styles.field} value={printSettings.label_height_cm} onChange={(e)=>setPrintSettings(s=>({...s,label_height_cm:e.target.value}))}/></label>
                    </div>
                    <div className="ls-toolbar" style={{marginTop:12}}><button style={styles.button} onClick={savePrintSettings}>Enregistrer les dimensions</button><button style={styles.secondary} onClick={loadPrintSettings}>Recharger</button></div>
                    {printSettingsMessage && <p className="ls-message">{printSettingsMessage}</p>}
                  </section>
                )}
                <section className="ls-panel" style={{marginTop:16}}>
                  <h3 style={{marginTop:0}}>Personnaliser mes pages</h3>
                  <p className="ls-muted">Masquez les pages inutiles ou changez leur ordre. Le réglage est propre à votre compte.</p>
                  {navItems.filter((item)=>(!item.adminOnly || isAdmin) && (!item.admin || isAdmin)).map((item,index)=>{
                    const order = pageOrder.length ? [...pageOrder, ...navItems.map(x=>x.id).filter(id=>!pageOrder.includes(id))] : navItems.map(x=>x.id);
                    const visible = !hiddenPages.includes(item.id);
                    return <div key={item.id} style={{display:'flex',gap:10,alignItems:'center',padding:'8px 0',borderBottom:'1px solid #e2e8f0',flexWrap:'wrap'}}>
                      <strong style={{flex:1}}>{item.label}</strong>
                      <label style={{display:'flex',gap:5,alignItems:'center'}}><input type="checkbox" checked={visible} onChange={(e)=>savePagePreferences(order,e.target.checked?hiddenPages.filter(x=>x!==item.id):[...hiddenPages,item.id])}/>Afficher</label>
                      <button style={styles.secondary} disabled={index===0} onClick={()=>{const i=order.indexOf(item.id);if(i>0){[order[i-1],order[i]]=[order[i],order[i-1]];savePagePreferences(order,hiddenPages);}}}>↑</button>
                      <button style={styles.secondary} disabled={index===navItems.length-1} onClick={()=>{const i=order.indexOf(item.id);if(i>=0&&i<order.length-1){[order[i+1],order[i]]=[order[i],order[i+1]];savePagePreferences(order,hiddenPages);}}}>↓</button>
                    </div>;
                  })}
                </section>
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
                    <section className="ls-panel" style={{marginTop:18}}>
                    <h3 style={{marginTop:0}}>Gestion centralisée des permissions des comptes</h3>
                    <p className="ls-muted">Les réglages généraux et les autorisations individuelles sont regroupés ici et enregistrés dans Supabase.</p>
                    <h4>Réglage général des quantités</h4>
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
                      <h4>Autorisations par compte</h4>
                      <p className="ls-muted">Choisissez les sections accessibles à chaque compte, l’accès au tableau des stocks négatifs et l’affichage des produits à quantité zéro ou négative dans Matelas Europ Arina.</p>
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
                                <th style={styles.th}>Accès aux sections</th>
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
                                    <td style={styles.td}>
                                      <select style={styles.field} value={account.role || 'trader'} disabled={permissionSavingId === account.id + ':role'} onChange={(event)=>updateAccountRole(account.id,event.target.value)}>
                                        <option value="trader">Trader</option>
                                        <option value="viewer">Viewer</option>
                                        <option value="sous-admin">Sous-admin</option>
                                      </select>
                                    </td>
                                    <td style={styles.td}>
                                      <details><summary>Sections et autorisations</summary>
                                        {navItems.filter((item)=>(!item.adminOnly || isAdmin) && (!item.admin || isAdmin)).map((item)=><label key={item.id} style={{display:'flex',gap:6,alignItems:'center',margin:'6px 0'}}><input type="checkbox" checked={(item.admin || item.adminOnly || ['sales','labels','barcode'].includes(item.id)) ? account.page_permissions?.[item.id] === true : account.page_permissions?.[item.id] !== false} onChange={(e)=>savePagePermission(account.id,item.id,e.target.checked)}/>{item.label}</label>)}
                                        <label style={{display:'flex',gap:6,alignItems:'center',margin:'8px 0'}}><input type="checkbox" checked={Boolean(account.can_view_negative_stock)} disabled={permissionSavingId === account.id + ':can_view_negative_stock'} onChange={(event)=>updateAccountPermission(account.id,'can_view_negative_stock',event.target.checked)}/>Tableau des stocks négatifs</label>
                                        <label style={{display:'flex',gap:6,alignItems:'center',margin:'8px 0'}}><input type="checkbox" checked={Boolean(account.can_view_zero_negative_products)} disabled={permissionSavingId === account.id + ':can_view_zero_negative_products'} onChange={(event)=>updateAccountPermission(account.id,'can_view_zero_negative_products',event.target.checked)}/>Europ Arina : afficher quantité 0 ou négative</label>
                                      </details>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
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
            {photoPreview && <div onClick={()=>setPhotoPreview(null)} style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,.84)',display:'grid',placeItems:'center',padding:20,cursor:'zoom-out'}}><button onClick={()=>setPhotoPreview(null)} style={{position:'absolute',top:16,right:16,fontSize:24,padding:'8px 14px'}}>×</button><div onClick={(e)=>e.stopPropagation()} style={{maxWidth:'95vw',maxHeight:'90vh',textAlign:'center',color:'#fff'}}><img src={photoPreview.url} alt={photoPreview.name} style={{maxWidth:'90vw',maxHeight:'78vh',objectFit:'contain',borderRadius:10}}/><div style={{marginTop:10,fontWeight:700}}>{photoPreview.name}</div></div></div>}
            <div
              className="ls-muted"
              style={{ textAlign: 'center', marginTop: 24 }}
            >
              Africha Hamiz Assistant · Les données restent synchronisées avec Supabase.
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
