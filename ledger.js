/* ledger.js — v23 가계부 (사업 경비 · 공제 후보 · 개인 지출 / 카드내역 가져오기)
   index.html 의 전역(S, save, refresh, toast, ask, openM, closeM, esc, won, num, pad …)을 그대로 씁니다. */
'use strict';
const LED_CATS={
  biz:['장비·자산','유류·교통','소모품','통신비','광고비','소프트웨어·구독','수수료','외주·인건비','식비·접대','세금·공과','도서·교육','기타경비'],
  ptx:['의료비','교육비','기부금','보험료','연금','기타공제후보'],
  per:['식비','쇼핑','교통','생활','문화·여가','건강','기타'],
  unc:['미분류']
};
const LED_CLS=[['biz','사업경비','t-q'],['ptx','공제후보','t-d'],['per','개인','t-x'],['unc','미분류','t-b']];
const LED_CLS_LABEL={biz:'사업경비',ptx:'공제후보',per:'개인',unc:'미분류',skip:'제외'};
const LED_PROOF=['카드','현금영수증','세금계산서','없음'];
/* 가맹점 → 추천 (사업 여부는 사용자가 최종 확인) */
const LED_SUGGEST=[
  [/FACEBK|META\s*PLATFORM|페이스북|인스타그램|네이버\s*광고|NAVER\s*AD|GOOGLE\s*\*?\s*ADS|구글\s*광고|카카오\s*광고/i,'biz','광고비'],
  [/OPENAI|ANTHROPIC|CLAUDE|ADOBE|PADDLE|CAPCUT|NOTION|FIGMA|DROPBOX|ENVATO|ARTLIST|MUSICBED|EPIDEMIC|SQUARESPACE|CANVA|MIDJOURNEY|GITHUB/i,'biz','소프트웨어·구독'],
  [/주유소|셀프주유|SK에너지|GS칼텍스|S-?OIL|오일뱅크|알뜰에너지|지에스네트웍스|이화셀프/i,'biz','유류·교통'],
  [/하이패스|도로공사|통행료|주차|파킹|NICE\(주차/i,'biz','유류·교통'],
  [/KT통신|SK텔레콤|SKT|LG유플러스|LGU\+|통신요금|기업요금/i,'biz','통신비'],
  [/프린트|인쇄|포토북|포토스튜디오|현상/i,'biz','소모품'],
  [/카메라|렌즈|짐벌|삼각대|드론|DJI|캐논|니콘|소니스토어|SONY|SANDISK|샌디스크|삼성전자|하이마트|전자랜드|컴퓨존|다나와/i,'biz','장비·자산'],
  [/병원|의원|약국|치과|한의원|클리닉|정신건강|내과|외과|안과|이비인후|피부과|정형외과|소아과|산부인과|메디|헬스케어/i,'ptx','의료비'],
  [/학원|교육|아카데미|스쿨/i,'ptx','교육비'],
  [/보험|생명|화재|손해보험/i,'ptx','보험료'],
  [/카페|커피|스타벅스|투썸|메가엠지씨|이디야|빽다방|식당|한식|치킨|피자|돼지집|국밥|파리바게|뚜레쥬르|씨유|CU\b|GS25|지에스25|세븐일레븐|이마트24|배달의민족|배민|쿠팡이츠|요기요|맥도날드|롯데리아|버거킹|김밥|분식|베이커리|마트|이마트|홈플러스|롯데마트|다이소|올리브영/i,'per','식비'],
  [/넷플릭스|NETFLIX|유튜브|YOUTUBE|디즈니|티빙|웨이브|스포티파이|SPOTIFY|왓챠|영화|CGV|메가박스|롯데시네마/i,'per','문화·여가']
];
let LI={rows:[],groups:[],dup:0,voided:0,est:0,only:false}, LP={y:new Date().getFullYear(),m:new Date().getMonth(),scope:'month'}, LF={cls:'all',q:'',lim:150}, LE=null;

/* ---------- 공통 ---------- */
function ledKey(s){ s=String(s||'').trim().replace(/\s*\*.*$/,''); const p=s.split('-'); if(p.length===2&&p[0].trim()&&p[0].trim()===p[1].trim()) s=p[0]; return s.replace(/\s+/g,'').toLowerCase(); }
function ledName(s){ s=String(s||'').trim().replace(/\s*\*.*$/,''); const p=s.split('-'); if(p.length===2&&p[0].trim()&&p[0].trim()===p[1].trim()) s=p[0].trim(); return s||'(이름 없음)'; }
function ledSuggest(shop){ for(const [re,cls,cat] of LED_SUGGEST) if(re.test(shop)) return {cls,cat}; return null; }
function ledCard(c){ c=String(c||''); return c.replace(/^KB국민\s*/,'').replace(/\(.*?\)/,'').replace(/카드$/,'').trim()||'카드'; }
function ledId(){ return 'l-'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function ledInPeriod(d){ d=String(d||''); if(LP.scope==='all') return true; return LP.scope==='year'?d.startsWith(LP.y+'-'):d.startsWith(LP.y+'-'+pad(LP.m+1)); }
function ledClsChip(c){ const m=LED_CLS.find(x=>x[0]===c); return m?`<span class="tag ${m[2]}">${m[1]}</span>`:`<span class="tag t-x">${LED_CLS_LABEL[c]||c}</span>`; }
function ledNorm(n){ const v=parseFloat(String(n==null?'':n).replace(/[^0-9.\-]/g,'')); return isFinite(v)?v:0; }
function ledDate(v){
  if(v==null||v==='') return '';
  if(typeof v==='number'&&v>20000&&v<80000){ const d=new Date(Math.round((v-25569)*864e5)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`; }
  const m=String(v).trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/); return m?`${m[1]}-${pad(+m[2])}-${pad(+m[3])}`:'';
}

/* ---------- 카드내역 파싱 ---------- */
function ledParseRows(rows){
  const clean=c=>String(c==null?'':c).replace(/\s+/g,'');
  let hi=-1, map=null;
  for(let i=0;i<Math.min(rows.length,40);i++){
    const h=rows[i].map(clean);
    if(h.some(x=>/이용일|승인일|거래일/.test(x))&&h.some(x=>/이용하신곳|가맹점|이용처|사용처|내용/.test(x))){ hi=i; map={}; h.forEach((x,k)=>{
      if(/^(이용일|승인일자?|거래일자?)$/.test(x)&&map.d==null) map.d=k;
      else if(/이용시간|승인시간|시간/.test(x)&&map.t==null) map.t=k;
      else if(/카드명|이용카드/.test(x)&&map.card==null) map.card=k;
      else if(/이용하신곳|^가맹점명?$|이용처|사용처|^내용$/.test(x)&&map.shop==null) map.shop=k;
      else if(/국내이용금액|이용금액|승인금액|거래금액|금액/.test(x)&&!/해외/.test(x)&&map.krw==null) map.krw=k;
      else if(/해외이용금액/.test(x)&&map.usd==null) map.usd=k;
      else if(/^상태$|취소여부|승인구분/.test(x)&&map.status==null) map.status=k;
      else if(/승인번호/.test(x)&&map.appr==null) map.appr=k;
    }); break; }
  }
  const out=[];
  const push=(o)=>{ if(o.d&&o.shop&&(o.krw||o.usd)) out.push(o); };
  if(map&&map.d!=null&&map.shop!=null){
    for(let i=hi+1;i<rows.length;i++){ const r=rows[i]; const d=ledDate(r[map.d]); if(!d) continue;
      push({d,t:String(r[map.t]==null?'':r[map.t]).trim(),card:String(r[map.card]==null?'':r[map.card]).trim(),shop:String(r[map.shop]||'').trim(),krw:Math.abs(ledNorm(r[map.krw])),usd:Math.abs(ledNorm(r[map.usd])),status:String(r[map.status]==null?'':r[map.status]),appr:String(r[map.appr]==null?'':r[map.appr]).trim()}); }
    return out;
  }
  rows.forEach(r=>{
    const d=ledDate(r[0]); if(!d) return;
    if(r.length>=12){ push({d,t:String(r[1]||'').trim(),card:String(r[3]||'').trim(),shop:String(r[4]||'').trim(),krw:Math.abs(ledNorm(r[5])),usd:Math.abs(ledNorm(r[6])),status:String(r[11]||''),appr:String(r[13]==null?'':r[13]).trim()}); return; }
    const cells=r.map(x=>String(x==null?'':x).trim()), isNum=c=>/^-?[\d,]+(\.\d+)?$/.test(c), isTm=c=>/^\d{1,2}:\d{2}/.test(c);
    let ai=-1; cells.forEach((c,k)=>{ if(ai<0&&k>0&&c&&isNum(c)&&Math.abs(ledNorm(c))>=10) ai=k; });
    const amt=ai>=0?Math.abs(ledNorm(cells[ai])):0; let shop='';
    for(let k=(ai>=0?ai-1:cells.length-1);k>0;k--){ const c=cells[k]; if(c&&!isNum(c)&&!isTm(c)&&!ledDate(c)){ shop=c; break; } }
    if(!shop) cells.forEach((c,k)=>{ if(k>0&&c&&!isNum(c)&&!isTm(c)&&c.length>shop.length) shop=c; });
    push({d,t:'',card:'',shop,krw:amt,usd:0,status:'',appr:''});
  });
  return out;
}
function ledParseText(txt){
  const lines=String(txt||'').replace(/\r/g,'').split('\n').filter(l=>l.trim());
  const tab=lines.some(l=>l.includes('\t'));
  return lines.map(l=>{
    if(tab) return l.split('\t');
    const o=[]; let cur='',q=false; for(const ch of l){ if(ch==='"') q=!q; else if(ch===','&&!q){ o.push(cur); cur=''; } else cur+=ch; } o.push(cur); return o;
  });
}
function ledLoadXlsx(){
  return new Promise((res,rej)=>{
    if(window.XLSX) return res();
    const s=document.createElement('script'); s.src='vendor/xlsx.core.min.js';
    s.onload=()=>res(); s.onerror=()=>rej(new Error('엑셀 읽기 모듈을 불러오지 못했어요 (인터넷 연결 또는 앱 업데이트를 확인해 주세요)'));
    document.head.appendChild(s);
  });
}
async function ledFile(inp){
  const f=inp.files&&inp.files[0]; if(!f) return;
  try{
    toast('📄 파일 읽는 중…'); await ledLoadXlsx();
    const buf=await f.arrayBuffer(), wb=XLSX.read(buf,{type:'array'});
    let best=[]; wb.SheetNames.forEach(n=>{ const r=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:true,defval:''}); const p=ledParseRows(r); if(p.length>best.length) best=p; });
    ledStart(best);
  }catch(e){ console.error(e); toast('❌ '+(e&&e.message||'파일을 읽지 못했어요')); }
  inp.value='';
}
function ledReadText(){ ledStart(ledParseRows(ledParseText($('li-text').value))); }

/* ---------- 가져오기: 그룹(가맹점) 분류 ---------- */
function ledStart(parsed){
  if(!parsed.length){ toast('읽을 수 있는 내역이 없어요. 이용일·이용하신곳·금액이 있는 표인지 확인해 주세요'); return; }
  const rate=Number(S.cfg.usdRate)||1400, have=new Set(S.ledger.map(x=>x.id)), seen=new Set(), groups=new Map();
  let dup=0, voided=0, est=0, rows=0;
  parsed.forEach(p=>{
    const st=String(p.status||'');
    if(/승인취소/.test(st)){ voided++; return; }
    const cancel=/취소/.test(st);
    const id='kb-'+(p.appr||(p.d+'|'+p.t+'|'+p.shop+'|'+p.krw+'|'+p.usd));
    if(have.has(id)||seen.has(id)){ dup++; return; } seen.add(id);
    let amt=p.krw, e=false; if(!amt&&p.usd){ amt=Math.round(p.usd*rate); e=true; est++; }
    if(cancel) amt=-amt;
    const k=ledKey(p.shop); let g=groups.get(k);
    if(!g){ g={key:k,name:ledName(p.shop),rows:[],sum:0,cls:'unc',cat:'미분류',how:''}; groups.set(k,g); }
    g.rows.push({id,d:p.d,t:p.t,card:p.card,shop:ledName(p.shop),amt,usd:p.usd||0,est:e,ap:p.appr||''}); g.sum+=amt; rows++;
  });
  const arr=[...groups.values()];
  arr.forEach(g=>{
    const r=S.rules[g.key];
    if(r){ g.cls=r.cls; g.cat=r.cat||LED_CATS[r.cls]?.[0]||''; g.how='rule'; }
    else { const s=ledSuggest(g.name); if(s){ g.cls=s.cls; g.cat=s.cat; g.how='auto'; } }
  });
  arr.sort((a,b)=>Math.abs(b.sum)-Math.abs(a.sum));
  LI={rows,groups:arr,dup,voided,est,only:false};
  if(!rows){ toast(`새로 가져올 내역이 없어요 (이미 있는 ${dup}건)`); return; }
  $('li-step1').classList.add('hide'); $('li-step2').classList.remove('hide'); ledRenderImp();
}
function ledGroupInner(g,i){
  const cats=LED_CATS[g.cls]||[], btn=(c,l)=>`<button class="btn sm ${g.cls===c?'on':''}" onclick="ledSetG(${i},'${c}')">${l}</button>`;
  const hint=g.how==='rule'?'<span class="tag t-a" style="margin-left:4px">🔁 저장된 규칙</span>':g.how==='auto'?'<span class="tag t-d" style="margin-left:4px">✨ 추천</span>':'';
  return `<div class="row" style="align-items:flex-start"><div style="min-width:0"><b style="font-size:13px;word-break:break-all">${esc(g.name)}</b>${hint}<div style="font-size:11px;color:var(--mut);font-weight:700;margin-top:2px">${g.rows.length}건 · 합계 ${g.sum<0?'−':''}${won(Math.abs(g.sum))}원${g.rows.some(r=>r.est)?' · 환산 추정':''}${g.rows.some(r=>r.amt<0)?' · 취소 포함':''}</div></div></div>
  <div class="wrap" style="margin-top:6px">${btn('biz','사업')}${btn('ptx','공제후보')}${btn('per','개인')}${btn('unc','미분류')}${btn('skip','제외(저장 안 함)')}</div>
  ${cats.length&&g.cls!=='unc'?`<select class="inp" style="margin-top:6px;padding:7px" onchange="ledCatG(${i},this.value)">${cats.map(c=>`<option ${c===g.cat?'selected':''}>${c}</option>`).join('')}</select>`:''}`;
}
function ledRenderImp(){
  const G=LI.groups, left=G.filter(g=>g.cls==='unc').length, tot=LI.rows;
  $('li-sum').innerHTML=`<b>새 내역 ${tot}건</b> · 가맹점 ${G.length}곳<div style="font-size:11px;color:var(--mut);font-weight:700;margin-top:3px">이미 있는 ${LI.dup}건은 건너뛰어요 · 승인취소 ${LI.voided}건 제외${LI.est?` · 해외결제 ${LI.est}건은 환율 ${won(S.cfg.usdRate||1400)}원으로 환산(추정)`:''}</div>`;
  $('li-chips').innerHTML=`<button class="btn sm ${!LI.only?'on':''}" onclick="LI.only=false;ledRenderImp()">전체 ${G.length}</button><button class="btn sm ${LI.only?'on':''}" onclick="LI.only=true;ledRenderImp()">미분류만 ${left}</button>`;
  $('li-groups').innerHTML=G.map((g,i)=>({g,i})).filter(x=>!LI.only||x.g.cls==='unc').map(({g,i})=>`<div class="cmrow" id="lg-${i}">${ledGroupInner(g,i)}</div>`).join('')||'<p>표시할 가맹점이 없어요.</p>';
}
function ledSetG(i,c){ const g=LI.groups[i]; g.cls=c; g.how=''; g.cat=(LED_CATS[c]||[])[0]||''; const el=$('lg-'+i); if(LI.only&&c!=='unc') ledRenderImp(); else if(el) el.innerHTML=ledGroupInner(g,i); ledUpdateLeft(); }
function ledCatG(i,v){ LI.groups[i].cat=v; LI.groups[i].how=''; }
function ledUpdateLeft(){ const n=LI.groups.filter(g=>g.cls==='unc').length; const b=$('li-chips').children[1]; if(b) b.textContent='미분류만 '+n; }
function ledAllPersonal(){ LI.groups.forEach(g=>{ if(g.cls==='unc'){ g.cls='per'; g.cat='기타'; g.how=''; } }); ledRenderImp(); toast('남은 미분류를 모두 개인으로 바꿨어요'); }
function ledImportGo(){
  let n=0,skip=0; const add=[];
  LI.groups.forEach(g=>{
    if(g.cls==='skip'){ skip+=g.rows.length; }
    else g.rows.forEach(r=>add.push({id:r.id,io:'out',d:r.d,t:r.t,card:r.card,shop:r.shop,amt:r.amt,usd:r.usd,est:r.est,cls:g.cls,cat:g.cat||'',proof:'카드',memo:'',ap:r.ap,src:'kb'}));
    if(g.cls!=='unc') S.rules[g.key]={cls:g.cls,cat:g.cat||''};
  });
  n=add.length; S.ledger=[...S.ledger,...add]; S.rules={...S.rules};
  save(); closeM('m-limp'); LI={rows:[],groups:[],dup:0,voided:0,est:0,only:false};
  if(add.length){ const ds=add.map(x=>x.d).sort(); LP.y=+ds[ds.length-1].slice(0,4); LP.m=+ds[ds.length-1].slice(5,7)-1; LP.scope=(ds[0].slice(0,7)===ds[ds.length-1].slice(0,7))?'month':'all'; LF.cls='all'; LF.q=''; LF.lim=150; }
  refresh(); toast(`📥 ${n}건 가져왔어요${skip?` (제외 ${skip}건)`:''}`);
}
function ledCover(){
  const m={}; S.ledger.filter(x=>x.io==='out'&&x.src==='kb'&&x.d).forEach(x=>{ const c=ledCard(x.card), o=m[c]||(m[c]={a:x.d,b:x.d,n:0}); if(x.d<o.a) o.a=x.d; if(x.d>o.b) o.b=x.d; o.n++; });
  return m;
}
function ledCoverHTML(long){
  const m=ledCover(), ks=Object.keys(m); if(!ks.length) return '아직 가져온 카드 내역이 없어요';
  const f=d=>d.slice(2).replace(/-/g,'.');
  const last=ks.map(k=>m[k].b).sort().pop();
  return '📅 카드 내역 반영 기간 · '+ks.map(k=>`${esc(k)} ${f(m[k].a)}~${f(m[k].b)} (${m[k].n}건)`).join(' · ')+(long?`<br>다음에는 <b>${f(last)} 이후</b> 내역부터 받으면 돼요. 겹쳐도 같은 승인번호는 자동으로 건너뛰어요.`:'');
}
function ledOpenImp(){ if($('li-cov')) $('li-cov').innerHTML=ledCoverHTML(true); $('li-step1').classList.remove('hide'); $('li-step2').classList.add('hide'); $('li-text').value=''; openM('m-limp'); }

/* ---------- 요약 ---------- */
function ledBook(){
  let rev=0,cost=0,n=0;
  if(chBasis==='cash'){
    S.inquiries.forEach(i=>{
      if(!isConf(i)) return; const cp=cashParts(i); let add=0;
      if(ledInPeriod(cp.dd)) add+=cp.dep; if(cp.bd&&ledInPeriod(cp.bd)) add+=cp.bal;
      if(add){ rev+=add; n++; }
      if(ledInPeriod(i.date||cp.dd)) cost+=costOf(i);
    });
    return {rev,cost,n};
  }
  S.inquiries.forEach(i=>{
    if(!isConf(i)) return;
    const d=chBasis==='contract'?new Date(i.depositAt||i.createdAt):(i.date?new Date(i.date+'T00:00:00'):new Date(i.depositAt||i.createdAt));
    const ds=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; if(!ledInPeriod(ds)) return;
    rev+=price(i); cost+=costOf(i); n++;
  });
  return {rev,cost,n};
}
function ledSummary(){
  const L=S.ledger.filter(x=>ledInPeriod(x.d)), bk=ledBook();
  const inc=L.filter(x=>x.io==='in').reduce((a,x)=>a+x.amt,0);
  const out=L.filter(x=>x.io==='out');
  const sum=c=>out.filter(x=>x.cls===c).reduce((a,x)=>a+x.amt,0);
  const bizCat={}, ptxCat={}; out.forEach(x=>{ if(x.cls==='biz') bizCat[x.cat||'기타경비']=(bizCat[x.cat||'기타경비']||0)+x.amt; if(x.cls==='ptx') ptxCat[x.cat||'기타공제후보']=(ptxCat[x.cat||'기타공제후보']||0)+x.amt; });
  const unc=out.filter(x=>x.cls==='unc');
  return {bk,inc,biz:sum('biz'),ptx:sum('ptx'),per:sum('per'),unc:unc.reduce((a,x)=>a+x.amt,0),uncN:unc.length,bizCat,ptxCat,rev:bk.rev+inc};
}
function ledBars(map,total,color){
  const e=Object.entries(map).filter(x=>x[1]!==0).sort((a,b)=>b[1]-a[1]); if(!e.length) return '<p>아직 내역이 없어요</p>';
  const mx=Math.max(...e.map(x=>Math.abs(x[1])))||1;
  return e.map(([k,v])=>`<div style="margin:6px 0"><div class="row" style="font-size:12px;font-weight:700"><span>${esc(k)}</span><span>${v<0?'−':''}${won(Math.abs(v))}원${total>0?` <span style="color:var(--mut);font-weight:600">${Math.round(Math.abs(v)/total*100)}%</span>`:''}</span></div><div class="bar" style="margin-top:3px"><i style="width:${Math.max(2,Math.abs(v)/mx*100)}%;background:${color}"></i></div></div>`).join('');
}

/* ---------- 화면 ---------- */
function ledPeriodTitle(){ return LP.scope==='all'?'전체 기간':LP.scope==='year'?`${LP.y}년`:`${LP.y}년 ${LP.m+1}월`; }
function ledMove(d){ if(LP.scope==='year') LP.y+=d; else { LP.m+=d; if(LP.m<0){ LP.m=11; LP.y--; } if(LP.m>11){ LP.m=0; LP.y++; } } LF.lim=150; renderLed(); }
function ledScope(s){ LP.scope=s; LF.lim=150; renderLed(); }
function renderLed(){
  if(!$('v-led')) return;
  const R=ledSummary(), net=R.rev-R.biz-R.bk.cost;
  $('led-title').textContent=ledPeriodTitle(); if($('led-cov')) $('led-cov').innerHTML=ledCoverHTML(false);
  ['month','year','all'].forEach(s=>{ const b=$('ls-'+s); if(b) b.className='btn sm '+(LP.scope===s?'on':''); });
  $('led-basis').innerHTML=[['contract','계약월'],['event','예식월'],['cash','입금일']].map(([v,l])=>`<button class="btn sm ${chBasis===v?'on':''}" onclick="chBasis='${v}';saveUI();renderLed()">${l}</button>`).join('');
  const inP=S.ledger.filter(x=>ledInPeriod(x.d)).length; $('led-basis-note').textContent=chBasis==='cash'?'입금일 기준: 계약금은 받은 날, 잔금은 받은 날에 수입으로 잡아요 (실제 현금 흐름). 세금 신고 기준과 다를 수 있어요.':chBasis==='event'?'예식월 기준: 예식일이 속한 달에 전체 금액을 잡아요.':'계약월 기준: 계약금 입금 달에 전체 금액을 잡아요.'; $('led-cnt').textContent=`${ledPeriodTitle()} ${inP}건 · 전체 ${S.ledger.length}건 저장됨`+(LP.scope!=='all'&&inP<S.ledger.length?' (월·연·전체 버튼으로 기간을 바꿔 보세요)':'');
  $('led-sum').innerHTML=`
    <div class="box"><div><span>예약 매출 (${R.bk.n}건)</span><b>${won(R.bk.rev)}원</b></div>
    <div><span>가계부 수입 (스토어 등)</span><b>${won(R.inc)}원</b></div>
    <div style="border-top:1px solid var(--ln);margin-top:3px;padding-top:5px"><span>총 수입</span><b>${won(R.rev)}원</b></div>
    <div><span>사업 경비 (가계부)</span><b style="color:#be123c">−${won(R.biz)}원</b></div>
    <div><span>예약별 지출 (예약 카드에 입력한 비용)</span><b style="color:#be123c">−${won(R.bk.cost)}원</b></div>
    <div style="border-top:1px solid var(--ln);margin-top:3px;padding-top:5px;font-size:14px"><span><b>순이익</b></span><b style="color:${net>=0?'#047857':'#be123c'}">${net<0?'−':''}${won(Math.abs(net))}원</b></div></div>
    <p style="margin-top:6px">예약별 지출과 가계부에 같은 비용을 두 번 넣으면 이중으로 빠져요. 한쪽에만 입력하세요.</p>
    <div class="g3" style="margin-top:8px"><div class="box" style="text-align:center"><div style="display:block"><span style="color:var(--mut)">공제후보</span></div><b style="display:block;text-align:center">${won(R.ptx)}원</b></div><div class="box" style="text-align:center"><div style="display:block"><span style="color:var(--mut)">개인</span></div><b style="display:block;text-align:center">${won(R.per)}원</b></div><div class="box" style="text-align:center;${R.uncN?'border-color:#fcd34d;background:#fffbeb':''}"><div style="display:block"><span style="color:var(--mut)">미분류 ${R.uncN}건</span></div><b style="display:block;text-align:center">${won(R.unc)}원</b></div></div>
    <details style="margin-top:8px" open><summary>🧾 사업 경비 항목별</summary>${ledBars(R.bizCat,R.biz,'#2563eb')}</details>
    <details style="margin-top:6px"><summary>🩺 공제후보 항목별 (적용 여부는 홈택스·세무서 확인)</summary>${ledBars(R.ptxCat,R.ptx,'#7c3aed')}</details>`;
  // 목록
  const q=LF.q.trim().toLowerCase();
  let L=S.ledger.filter(x=>ledInPeriod(x.d)&&(LF.cls==='all'||(LF.cls==='in'?x.io==='in':(x.io==='out'&&x.cls===LF.cls)))&&(!q||[x.shop,x.cat,x.memo,x.card].join(' ').toLowerCase().includes(q)));
  L.sort((a,b)=>(b.d+(b.t||'')).localeCompare(a.d+(a.t||'')));
  const cnt=c=>S.ledger.filter(x=>ledInPeriod(x.d)&&(c==='all'||(c==='in'?x.io==='in':(x.io==='out'&&x.cls===c)))).length;
  $('led-filter').innerHTML=[['all','전체'],['biz','사업'],['ptx','공제후보'],['per','개인'],['unc','미분류'],['in','수입']].map(([v,l])=>`<button class="btn sm ${LF.cls===v?'on':''}" onclick="LF.cls='${v}';LF.lim=150;renderLed()">${l} ${cnt(v)}</button>`).join('');
  const shown=L.slice(0,LF.lim);
  $('led-list').innerHTML=shown.map(x=>{
    const neg=x.amt<0, isIn=x.io==='in';
    return `<button class="cmrow" style="text-align:left;width:100%;cursor:pointer" onclick="ledOpen('${x.id}')"><div class="row" style="align-items:flex-start"><div style="min-width:0"><b style="font-size:13px;word-break:break-all">${esc(x.shop||'(내용 없음)')}</b><div class="tl">${isIn?'<span class="tag t-a">수입</span>':ledClsChip(x.cls)}${x.cat&&x.cat!=='미분류'?`<span class="tag t-x">${esc(x.cat)}</span>`:''}${x.est?'<span class="tag t-b">≈환산</span>':''}${x.card&&x.src==='kb'?`<span style="font-size:10px;color:var(--mut)">${esc(ledCard(x.card))}</span>`:''}</div>${x.memo?`<div style="font-size:11px;color:var(--mut)">📝 ${esc(x.memo)}</div>`:''}</div><div style="text-align:right;flex-shrink:0"><b style="font-size:13px;color:${isIn?'#047857':neg?'#047857':'var(--ink)'}">${isIn?'+':neg?'−':''}${won(Math.abs(x.amt))}원</b><div style="font-size:10.5px;color:var(--mut);font-weight:700">${mdIso(x.d)}${x.usd?` · $${x.usd}`:''}</div></div></div></button>`;
  }).join('')||`<div class="c" style="text-align:center;padding:24px"><b>이 기간에 내역이 없어요</b><p style="margin-top:6px">[📥 카드내역 가져오기] 또는 [+ 직접 입력]으로 시작하세요</p></div>`;
  $('led-more').classList.toggle('hide',L.length<=LF.lim); $('led-more').textContent=`더 보기 (${L.length-LF.lim}건 남음)`;
  try{ if(window.taxRender) taxRender(); }catch(e){ console.error(e); }
  if($('lc-rate')){ if(document.activeElement!==$('lc-rate')) $('lc-rate').value=won(S.cfg.usdRate||1400); if(document.activeElement!==$('lc-fee')) $('lc-fee').value=S.cfg.storeFee||0; }
}
function ledCfgSave(q){ S.cfg.usdRate=num($('lc-rate').value)||1400; const f=parseFloat(String($('lc-fee').value).replace(/[^0-9.]/g,'')); S.cfg.storeFee=isFinite(f)?f:0; save(); if(q) return autoMark(); renderLed(); toast('가계부 설정을 저장했어요'); }

/* ---------- 건별 편집 / 직접 입력 ---------- */
function ledOpen(id,io){
  const x=id?S.ledger.find(v=>v.id===id):null;
  LE=x?{...x}:{id:null,io:io||'out',d:todayISO(),t:'',shop:'',amt:0,cls:io==='in'?'biz':'biz',cat:io==='in'?'매출':LED_CATS.biz[0],proof:'카드',memo:'',src:'manual',card:'',usd:0,est:false,ap:''};
  $('le-title').textContent=x?'내역 수정':(LE.io==='in'?'수입 직접 입력':'지출 직접 입력');
  $('le-date').value=LE.d; $('le-shop').value=LE.shop||''; $('le-amt').value=LE.amt?won(Math.abs(LE.amt)):''; $('le-neg').checked=LE.amt<0; $('le-memo').value=LE.memo||''; $('le-proof').value=LE.proof||'카드';
  $('le-del').classList.toggle('hide',!x); $('le-all').checked=false;
  const same=x&&x.shop?S.ledger.filter(v=>v.io==='out'&&ledKey(v.shop)===ledKey(x.shop)).length:0;
  $('le-allbox').classList.toggle('hide',!(x&&x.io==='out'&&same>1)); $('le-allcnt').textContent=same;
  ledRenderE(); openM('m-led');
}
function ledRenderE(){
  const isIn=LE.io==='in';
  $('le-io').innerHTML=[['out','지출'],['in','수입']].map(([v,l])=>`<button type="button" class="btn sm ${LE.io===v?'on':''}" onclick="LE.io='${v}';if(LE.io==='in'){LE.cls='biz';LE.cat='매출';}else if(LE.cat==='매출'){LE.cat='${LED_CATS.biz[0]}';}ledRenderE()">${l}</button>`).join('');
  $('le-cls-box').classList.toggle('hide',isIn);
  $('le-cls').innerHTML=LED_CLS.map(([c,l])=>`<button type="button" class="btn sm ${LE.cls===c?'on':''}" onclick="LE.cls='${c}';LE.cat=(LED_CATS['${c}']||[])[0]||'';ledRenderE()">${l}</button>`).join('');
  const cats=isIn?['매출','스토어매출','기타수입']:(LED_CATS[LE.cls]||[]);
  if(cats.length&&!cats.includes(LE.cat)) LE.cat=cats[0];
  $('le-cat').innerHTML=cats.map(c=>`<option ${c===LE.cat?'selected':''}>${c}</option>`).join(''); $('le-cat-box').classList.toggle('hide',!cats.length);
  $('le-neg-box').classList.toggle('hide',isIn);
}
function ledSaveE(ev){
  ev.preventDefault();
  const amt=num($('le-amt').value); if(!amt){ toast('금액을 입력해 주세요'); return; }
  const shop=$('le-shop').value.trim(); if(!shop){ toast('내용(거래처)을 입력해 주세요'); return; }
  const d=$('le-date').value||todayISO(), neg=LE.io==='out'&&$('le-neg').checked;
  const rec={...LE,d,shop,amt:neg?-amt:amt,cat:$('le-cat').value||LE.cat,proof:$('le-proof').value,memo:$('le-memo').value.trim()};
  if(rec.io==='in'){ rec.cls='biz'; }
  if(rec.id){
    const k=S.ledger.findIndex(v=>v.id===rec.id); if(k>=0) S.ledger[k]=rec;
    if($('le-all').checked&&rec.io==='out'){ const key=ledKey(rec.shop); S.ledger.forEach(v=>{ if(v.io==='out'&&ledKey(v.shop)===key){ v.cls=rec.cls; v.cat=rec.cat; } }); S.rules={...S.rules,[key]:{cls:rec.cls,cat:rec.cat}}; }
  } else { rec.id=ledId(); S.ledger.push(rec); }
  save(); closeM('m-led'); refresh(); toast('저장했어요');
}
function ledDel(){ if(!LE||!LE.id) return; ask(`'${LE.shop}' 내역을 삭제할까요?`,()=>{ S.ledger=S.ledger.filter(v=>v.id!==LE.id); save(); closeM('m-led'); refresh(); toast('삭제했어요'); }); }

/* ---------- 네이버스토어 정산 ---------- */
function ledStoreOpen(){ $('ls-date').value=todayISO(); $('ls-gross').value=''; $('ls-net').value=''; $('ls-memo').value=''; ledStorePrev(); openM('m-lstore'); }
function ledStoreCalc(){ const g=num($('ls-gross').value), n=num($('ls-net').value); let fee=0, how=''; if(g){ if(n>0){ fee=Math.max(0,g-n); how='정산금액 기준'; } else { fee=Math.round(g*(Number(S.cfg.storeFee)||0)/100); how=`수수료율 ${S.cfg.storeFee||0}% 기준`; } } return {g,fee,how}; }
function ledStorePrev(){ const {g,fee,how}=ledStoreCalc(); $('ls-prev').innerHTML=g?`매출 <b>${won(g)}원</b> − 수수료 <b>${won(fee)}원</b> = 정산 <b>${won(g-fee)}원</b> <span style="color:var(--mut)">(${how})</span>`:'판매금액을 입력하면 수수료가 계산돼요. 정산금액을 입력하면 그 차이를 수수료로 기록해요.'; }
function ledStoreSave(ev){
  ev.preventDefault(); const {g,fee}=ledStoreCalc(); if(!g){ toast('판매금액을 입력해 주세요'); return; }
  const d=$('ls-date').value||todayISO(), memo=$('ls-memo').value.trim(), grp=ledId();
  S.ledger.push({id:ledId(),io:'in',d,t:'',shop:'네이버스토어 정산'+(memo?` (${memo})`:''),amt:g,cls:'biz',cat:'스토어매출',proof:'없음',memo:'',src:'store',card:'',usd:0,est:false,ap:'',grp});
  if(fee>0) S.ledger.push({id:ledId(),io:'out',d,t:'',shop:'네이버스토어 수수료',amt:fee,cls:'biz',cat:'수수료',proof:'없음',memo:'',src:'store',card:'',usd:0,est:false,ap:'',grp});
  save(); closeM('m-lstore'); refresh(); toast('🛒 정산을 기록했어요');
}

/* ---------- 내보내기 ---------- */
function ledCSV(){
  const rows=S.ledger.filter(x=>LP.scope==='all'||x.d.startsWith(String(LP.y))).sort((a,b)=>a.d.localeCompare(b.d));
  const q=v=>`"${String(v==null?'':v).replace(/"/g,'""')}"`;
  const head=['날짜','구분','분류','항목','거래처','금액','증빙','카드','메모'];
  const out=[head.map(q).join(',')];
  rows.forEach(x=>out.push([x.d,x.io==='in'?'수입':'지출',x.io==='in'?'수입':(LED_CLS_LABEL[x.cls]||x.cls),x.cat,x.shop,x.amt,x.proof,x.card,x.memo].map(q).join(',')));
  download(`runiq_ledger_${LP.scope==='all'?'all':LP.y}.csv`,'﻿'+out.join('\r\n'),'text/csv;charset=utf-8'); toast(`📄 ${rows.length}건 내보냈어요`);
}
