/* coupang.js — v31 쿠팡 구매목록 (쿠팡 신용카드 전표 PDF → 품목 목록, KB 가계부와 승인번호로 연결)
   index.html / ledger.js 의 전역(S, save, refresh, toast, ask, openM, closeM, esc, won, num, LED_CATS, renderLed …)을 그대로 씁니다. */
'use strict';
const CP_LABELS=['카드종류','거래종류','할부개월','카드번호','거래일시','승인번호','주문번호','상품명','과세금액','비과세금액','부가세','합계금액','판매자상호','판매자 사업자등록번호','판매자주소'];
const CP_BIZ_RE=/카메라|DJI|스몰리그|SmallRig|오즈모|렌즈|필터|ND\b|삼각대|짐벌|로닌|케이지|그립|SD\s?카드|메모리\s?카드|CFexpress|CF\s?카드|배터리|충전기|마이크(?!로)|조명|스트랩|카드\s?리더|리더기|모니터링|헤드폰|이어폰|스탠드|거치대|방진|제습|드라이박스|오디오\s?인터페이스/i;
let CPF={cls:'all',q:''}, CPU={y:'all'};
function cpSuggest(name){ return CP_BIZ_RE.test(name||'')?'biz':''; }
function cpHash(s){ let h=5381; for(let i=0;i<s.length;i++) h=((h<<5)+h+s.charCodeAt(i))|0; return (h>>>0).toString(36); }

async function cpLoadPdf(){
  if(window.pdfjsLib) return;
  const m=await import('./vendor/pdfjs/pdf.min.mjs');
  m.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs',location.href).href;
  window.pdfjsLib=m;
}
// 한 페이지의 글자 조각 → 줄(라벨 + 값)
function cpPageLines(items){
  const rows=[];
  items.forEach(it=>{ if(it.str==null||it.str==='') return; const y=Math.round(it.transform[5]/3); let r=rows.find(r=>Math.abs(r.y-y)<=1); if(!r){ r={y,its:[]}; rows.push(r); } r.its.push({x:it.transform[4],w:it.width||0,s:it.str}); });
  rows.sort((a,b)=>b.y-a.y);
  return rows.map(r=>{
    const its=r.its.sort((a,b)=>a.x-b.x), segs=[]; let cur=null, end=0;
    its.forEach(t=>{ if(!t.s.trim()) return;
      if(cur&&t.x-end<14){ const gap=t.x-end; cur.s+=(gap>1.2&&!/\s$/.test(cur.s)&&!/^\s/.test(t.s)?' ':'')+t.s; }
      else{ cur={s:t.s}; segs.push(cur); }
      end=t.x+t.w; });
    return segs.map(g=>g.s.replace(/\s+/g,' ').trim()).filter(Boolean);
  }).filter(p=>p.length);
}
function cpParsePage(lines){
  const f={}; let cur=null;
  lines.forEach(parts=>{
    const first=parts[0], two=parts.slice(0,2).join(' ');
    const lab=CP_LABELS.find(l=>first===l||two===l||parts.join(' ').startsWith(l+' '));
    if(lab){ cur=lab; const n=parts[0]===lab?1:lab.split(' ').length; f[lab]=parts.slice(n).join(' ').trim(); return; }
    if(cur==='상품명'||cur==='판매자주소'){ if(/^(위 신용카드|카드사 측|https?:|결제정보|구매정보|이용상점정보)/.test(parts.join(' '))){ cur=null; return; } f[cur]=((f[cur]||'')+' '+parts.join(' ')).trim(); }
    else if(/^(결제정보|구매정보|이용상점정보)$/.test(first)) cur=null;
  });
  const ap=(f['승인번호']||'').replace(/\D/g,''); if(!ap) return null;
  const dt=(f['거래일시']||'').match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\s+(\d{1,2}:\d{2})/); if(!dt) return null;
  const total=num(f['합계금액']||''); if(!total) return null;
  return {ap,d:`${dt[1]}-${pad(+dt[2])}-${pad(+dt[3])}`,t:dt[4],name:(f['상품명']||'').replace(/\s+/g,' ').trim()||'(상품명 없음)',seller:(f['판매자상호']||'').trim(),bizno:(f['판매자 사업자등록번호']||'').trim(),
    total,supply:num(f['과세금액']||''),vat:num(f['부가세']||''),card:(f['카드종류']||'').trim(),inst:(f['할부개월']||'').trim(),order:(f['주문번호']||'').trim()};
}
async function cpReadFiles(files){
  const out=[]; let pages=0, bad=0;
  try{ await cpLoadPdf(); }catch(e){ toast('PDF 읽기 부품을 불러오지 못했어요. 인터넷 연결을 확인해 주세요'); return; }
  for(const file of files){
    let pdf; try{ pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise; }catch(e){ bad++; continue; }
    for(let n=1;n<=pdf.numPages;n++){
      pages++; const pg=await pdf.getPage(n), tc=await pg.getTextContent(); const r=cpParsePage(cpPageLines(tc.items)); if(r) out.push(r); else bad++;
    }
  }
  cpMerge(out,pages,bad);
}
function cpMerge(recs,pages,bad){
  S.cpItems=S.cpItems||[]; let add=0, upd=0;
  recs.forEach(r=>{
    const id='cp-'+r.ap+'-'+cpHash(r.name+'|'+r.seller+'|'+r.total), ex=S.cpItems.find(x=>x.id===id);
    if(ex){ Object.assign(ex,r); upd++; } else { S.cpItems.push({id,...r,cls:'unc'}); add++; }
  });
  S.cpItems.forEach(x=>cpLink(x.ap,true));
  save(); cpRender(); try{ renderLed(); }catch(e){}
  toast(`🛒 ${pages}쪽 중 ${recs.length}건 읽음 · 새로 ${add}건${upd?` · 갱신 ${upd}건`:''}${bad?` · 못 읽은 쪽 ${bad}`:''}`);
}
const cpKb=ap=>(S.ledger||[]).find(e=>e.io==='out'&&e.ap===ap);
// 승인번호가 같은 가계부 건에 품목명을 메모로 붙임 (직접 쓴 메모는 건드리지 않음)
function cpLink(ap,memoOnly){
  const e=cpKb(ap); if(!e) return; const its=S.cpItems.filter(x=>x.ap===ap);
  const memo='쿠팡: '+its.map(x=>x.name).join(' / ');
  if(!e.memo||/^쿠팡: /.test(e.memo)) e.memo=memo.slice(0,200);
  if(memoOnly) return;
  const cl=[...new Set(its.map(x=>x.cls))];
  if(cl.length===1&&cl[0]!=='unc'){ e.cls=cl[0]; if(!(LED_CATS[cl[0]]||[]).includes(e.cat)) e.cat=cl[0]==='biz'&&its.some(x=>cpSuggest(x.name)==='biz')?'장비·자산':(LED_CATS[cl[0]]||[''])[0]; }
}
function cpSet(id,c){ const x=S.cpItems.find(v=>v.id===id); if(!x) return; x.cls=c; cpLink(x.ap); save(); cpRender(); try{ renderLed(); }catch(e){} }
function cpSugAll(){ let n=0; S.cpItems.forEach(x=>{ if(x.cls==='unc'){ const s=cpSuggest(x.name); if(s){ x.cls=s; n++; } } }); [...new Set(S.cpItems.map(x=>x.ap))].forEach(ap=>cpLink(ap)); save(); cpRender(); try{ renderLed(); }catch(e){} toast(n?`추천 ${n}건을 사업경비로 분류했어요. 맞는지 확인해 주세요`:'적용할 추천이 없어요'); }
function cpClear(){ ask('쿠팡 구매목록을 모두 지울까요? (가계부 내역은 그대로 남아요)',()=>{ S.cpItems=[]; save(); cpRender(); toast('비웠어요'); }); }

function cpOpen(){
  if(!$('m-cp')) cpBuild();
  cpRender(); openM('m-cp');
}
function cpBuild(){
  document.body.insertAdjacentHTML('beforeend',`<div id="m-cp" class="mod hide"><div>
  <div class="row"><h2 style="margin:0;font-size:16px">🛒 쿠팡 구매목록</h2><button class="btn sm" onclick="closeM('m-cp')">✕</button></div>
  <p style="margin:6px 0 8px">쿠팡 <b>신용카드 매출전표 PDF</b>(결제내역 → 카드영수증)를 올리면 품목이 목록으로 정리돼요. KB 카드내역과 승인번호가 같으면 가계부에 품목명이 붙어요. 파일은 이 기기 안에서만 읽고 어디에도 올리지 않아요.</p>
  <input id="cp-file" type="file" accept="application/pdf,.pdf" multiple class="hide" onchange="cpReadFiles(this.files).then(()=>{this.value=''})">
  <button class="btn dk" style="width:100%" onclick="$('cp-file').click()">📄 쿠팡 전표 PDF 올리기</button>
  <div id="cp-sum" style="margin-top:10px"></div>
  <div id="cp-flt" class="wrap" style="margin-top:8px"></div>
  <input id="cp-q" class="inp" style="margin-top:8px" placeholder="품목·판매자 검색" oninput="CPF.q=this.value;cpRenderList()">
  <div id="cp-list" style="margin-top:8px"></div>
  <div class="g2" style="margin-top:10px"><button class="btn" onclick="cpSugAll()">✨ 장비 추천 일괄 적용</button><button class="btn rd" onclick="cpClear()">목록 비우기</button></div>
</div></div>`);
}
function cpRender(){
  const L=S.cpItems||[], sum=a=>a.reduce((s,x)=>s+x.total,0), by=c=>L.filter(x=>x.cls===c);
  $('cp-sum').innerHTML=L.length?`<div class="g2"><div class="box" style="display:block"><b style="display:block;color:var(--mut)">전체</b><b style="font-size:16px">${L.length}건 · ${won(sum(L))}원</b></div>
    <div class="box" style="display:block"><b style="display:block;color:var(--mut)">사업경비로 분류</b><b style="font-size:16px">${by('biz').length}건 · ${won(sum(by('biz')))}원</b></div></div>
    <p style="margin-top:6px">미분류 ${by('unc').length}건 · 개인 ${by('per').length}건 · KB 가계부 연결 ${L.filter(x=>cpKb(x.ap)).length}건</p>`:'<div class="box" style="display:block;text-align:center">아직 올린 전표가 없어요</div>';
  $('cp-flt').innerHTML=[['all','전체'],['unc','미분류'],['biz','사업'],['per','개인']].map(([v,l])=>`<button class="btn sm ${CPF.cls===v?'on':''}" onclick="CPF.cls='${v}';cpRender()">${l}</button>`).join('');
  cpRenderList();
}
function cpRenderList(){
  const q=(CPF.q||'').toLowerCase();
  const L=(S.cpItems||[]).filter(x=>(CPF.cls==='all'||x.cls===CPF.cls)&&(!q||(x.name+' '+x.seller).toLowerCase().includes(q))).sort((a,b)=>(b.d+b.t).localeCompare(a.d+a.t));
  const sumAp={}; (S.cpItems||[]).forEach(x=>{ sumAp[x.ap]=(sumAp[x.ap]||0)+x.total; });
  $('cp-list').innerHTML=L.length?L.slice(0,300).map(x=>{
    const e=cpKb(x.ap); let st='<span class="tag t-x">KB에 없음</span>';
    if(e){ const kb=Math.abs(e.amt); st=kb===sumAp[x.ap]?'<span class="tag t-a">✅ KB 연결</span>':`<span class="tag t-d">⚠️ KB ${won(kb)}원 / 전표 ${won(sumAp[x.ap])}원</span>`; }
    const sg=x.cls==='unc'&&cpSuggest(x.name)==='biz'?'<span style="font-size:11px;color:#047857;font-weight:800"> · 추천: 사업 장비</span>':'';
    return `<div class="lrow" style="display:block"><div style="display:flex;justify-content:space-between;gap:8px"><b style="min-width:0;overflow-wrap:anywhere">${esc(x.name)}</b><b style="white-space:nowrap">${won(x.total)}원</b></div>
      <p style="margin:2px 0">${x.d.replace(/-/g,'.')} ${esc(x.t)} · ${esc(x.seller)}${x.vat?` · 부가세 ${won(x.vat)}원`:''} ${st}${sg}</p>
      <div class="g3" style="margin-top:4px">${[['biz','사업'],['per','개인'],['unc','미분류']].map(([c,l])=>`<button class="btn sm ${x.cls===c?(c==='biz'?'on-a':c==='per'?'on':'dk'):''}" onclick="cpSet('${x.id}','${c}')">${l}</button>`).join('')}</div></div>`;
  }).join('')+(L.length>300?`<p>외 ${L.length-300}건 (검색으로 좁혀 보세요)</p>`:''):'<p style="text-align:center;color:var(--mut)">표시할 항목이 없어요</p>';
}
