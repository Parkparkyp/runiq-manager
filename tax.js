/* tax.js — v35 세금 예상액(참고용) + 신고 일정 알림
   ⚠️ 간이과세자 기준의 단순 추정치입니다. 신고 전 홈택스 모의계산·세무서·세무사로 확인하세요. */
'use strict';
const TAX_BR=[[14e6,.06,0],[50e6,.15,1260000],[88e6,.24,5760000],[150e6,.35,15440000],[300e6,.38,19940000],[500e6,.40,25940000],[1e9,.42,35940000],[Infinity,.45,65940000]];
const taxInc=b=>{ if(b<=0) return 0; const r=TAX_BR.find(x=>b<=x[0]); return Math.max(0,Math.floor(b*r[1]-r[2])); };
const taxVatRate=()=>((parseFloat(S.cfg.vatRate)||40)/100);
const taxDed=()=>S.cfg.taxDed!=null?(Number(S.cfg.taxDed)||0):1500000;
function taxYear(y){
  const p=String(y)+'-', ls=S.ledger||[];
  let rev=0, n=0, cost=0;
  S.inquiries.forEach(i=>{
    if(!isConf(i)) return; const cp=cashParts(i); let add=0;
    if(String(cp.dd).startsWith(p)) add+=cp.dep; if(cp.bd&&String(cp.bd).startsWith(p)) add+=cp.bal;
    if(add){ rev+=add; n++; }
    if(String(i.date||cp.dd).startsWith(p)) cost+=costOf(i);
  });
  const inc=ls.filter(x=>x.io==='in'&&String(x.d).startsWith(p)).reduce((a,x)=>a+x.amt,0);
  const biz=ls.filter(x=>x.io==='out'&&x.cls==='biz'&&String(x.d).startsWith(p));
  const bizAmt=biz.reduce((a,x)=>a+x.amt,0), bizProof=biz.filter(x=>x.proof&&x.proof!=='없음').reduce((a,x)=>a+x.amt,0);
  const rate=taxVatRate(), sales=rev+inc, exp=bizAmt+cost;
  const exempt=sales<48e6, over=sales>=104e6;
  const vat=exempt?0:Math.max(0,Math.floor(sales*rate*0.1-bizProof*0.005));
  const profit=sales-exp, base=Math.max(0,profit-taxDed()), it=taxInc(base), lt=Math.floor(it*0.1);
  return {y,n,rev,inc,sales,bizAmt,cost,exp,profit,bizProof,rate,exempt,over,vat,base,it,lt,total:vat+it+lt};
}
function taxRender(){
  const host=$('led-sum'); if(!host) return; const old=$('led-tax'); if(old) old.remove(); const od=$('led-taxd'); if(od) od.remove();
  const y=LP.y, T=taxYear(y), W=n=>won(Math.round(n))+'원';
  const row=(l,v,st)=>`<div style="${st||''}"><span>${l}</span><b>${v}</b></div>`;
  const nx=taxList()[0], nxh=nx?`<div id="led-taxd" class="alert al-y" style="margin:10px 0 0"><span>📅 다음 신고 · ${nx.t} · ${nx.date.slice(5).replace('-','/')}</span><b>${nx.left===0?'D-DAY':'D-'+nx.left}</b></div>`:'';
  host.insertAdjacentHTML('beforeend',nxh+`<details id="led-tax" style="margin-top:10px"><summary>🧾 세금 예상액 · ${y}년 누적 <b style="color:#b45309">${W(T.total)}</b> (참고용)</summary>
    <div class="box" style="margin-top:8px;display:block">
      ${row('수입 (입금 기준)',W(T.sales))}${row('사업 경비',`−${W(T.exp)}`,'color:#be123c')}${row('사업소득금액(추정)',W(T.profit),'border-top:1px solid var(--ln);margin-top:3px;padding-top:5px')}
      <div style="border-top:1px solid var(--ln);margin:8px 0 4px"></div>
      ${row('① 부가세 (간이과세)',T.exempt?'납부 면제 구간':W(T.vat),'font-size:13px')}
      <p style="margin:2px 0 6px;font-size:11px">${T.exempt?`연 수입 ${W(T.sales)}로 4,800만원 미만이면 납부의무가 면제돼요(신고는 확인 필요). 4,800만원이 넘으면 수입 × 부가가치율 ${Math.round(T.rate*100)}% × 10%에서 카드·계산서 매입의 0.5%를 뺀 금액으로 계산해요.`:`수입 × ${Math.round(T.rate*100)}% × 10% − 증빙 매입 ${W(T.bizProof)}의 0.5%`}${T.over?' ⚠️ 연 1.04억 원 이상이면 간이과세 기준을 넘을 수 있어요.':''}</p>
      ${row('② 종합소득세 (과세표준 '+won(T.base)+'원)',W(T.it),'font-size:13px')}${row('   지방소득세 (10%)',W(T.lt))}
      <p style="margin:2px 0 6px;font-size:11px">사업소득금액 − 소득공제 ${W(taxDed())} = 과세표준 → 누진세율(6~45%). 소득공제는 설정 &gt; 금액·할인에서 바꿀 수 있어요.</p>
      ${row('예상 세금 합계 (①+②+지방소득세)',W(T.total),'border-top:1px solid var(--ln);margin-top:3px;padding-top:5px;font-size:14px;color:#b45309')}
      ${row('세금 낸 뒤 남는 돈(추정)',W(T.profit-T.total))}
    </div>
    <p style="margin-top:6px;font-size:11px">※ ${y}년 1~12월 중 가계부에 기록된 내용만 반영한 <b>단순 추정</b>이에요. 개인·미분류 지출은 빠지고, 공제후보(${W(S.ledger.filter(x=>x.io==='out'&&x.cls==='ptx'&&String(x.d).startsWith(y+'-')).reduce((a,x)=>a+x.amt,0))})도 넣지 않았어요. 부가가치율·공제·세율은 바뀔 수 있어 신고 전에 홈택스 모의계산이나 세무서에서 꼭 확인하세요.</p></details>`);
}
/* ---------- 신고 일정 ---------- */
const TAX_EV=[
  {k:'vat',m:1,d:25,t:'부가세 확정신고',s:'전년도 1.1~12.31분 · 홈택스'},
  {k:'inc',m:5,d:31,t:'종합소득세·지방소득세 신고·납부',s:'5.1~5.31 · 전년도 소득'},
  {k:'vatp',m:7,d:25,t:'부가세 예정부과 납부',s:'고지서를 받은 경우만',notice:true},
  {k:'mid',m:11,d:30,t:'소득세 중간예납',s:'고지서를 받은 경우만',notice:true}
];
function taxNext(ev){ const n=new Date(), y=n.getFullYear(); let dt=new Date(y,ev.m-1,ev.d); const t0=new Date(y,n.getMonth(),n.getDate()); if(dt<t0) dt=new Date(y+1,ev.m-1,ev.d); return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`; }
function taxList(){ return TAX_EV.filter(e=>!e.notice||S.cfg.taxNotice).map(e=>{ const date=taxNext(e); return {...e,date,left:daysFromToday(date)}; }).sort((a,b)=>a.left-b.left); }
function taxAlerts(){
  if(S.cfg.taxAlert===false) return [];
  const unc=(S.ledger||[]).filter(x=>x.io==='out'&&x.cls==='unc').length, out=[];
  taxList().forEach(e=>{
    if(e.left>30) return;
    const dd=e.left===0?'D-DAY':`D-${e.left}`, hint=(e.k==='vat'||e.k==='inc')&&unc?` · 가계부 미분류 ${unc}건 정리`:'';
    out.push({p:e.left<=3?0:e.left<=7?1:2,cls:e.left<=3?'al-r':e.left<=7?'al-y':'al-b',text:`🧾 ${e.t} ${dd} (${e.date.slice(5).replace('-','/')})${hint}`,btn:`<button class="btn dk sm" onclick="tab('led')">가계부</button>`});
    if([7,1,0].includes(e.left)) taxNotify(e,dd);
  });
  return out;
}
function taxNotify(e,dd){
  try{ if(!(S.cfg.notiOn&&('Notification' in window)&&Notification.permission==='granted')) return;
    const k='runiq_tax_'+e.k+'_'+e.date+'_'+e.left; if(localStorage.getItem(k)) return; localStorage.setItem(k,'1');
    const title=`🧾 ${e.t} ${dd}`, body=e.s;
    if(navigator.serviceWorker&&navigator.serviceWorker.ready) navigator.serviceWorker.ready.then(r=>r.showNotification(title,{body,tag:k,icon:'icons/icon-192.png'})).catch(()=>new Notification(title,{body})); else new Notification(title,{body});
  }catch(x){}
}
function taxRenderSettings(){
  const h=$('tax-list'); if(!h) return;
  h.innerHTML=taxList().map(e=>`<div class="lrow"><span><b>${esc(e.t)}</b><br><span style="font-size:11px;color:var(--mut)">${esc(e.s)}</span></span><span style="text-align:right"><b>${e.date.slice(5).replace('-','/')}</b><br><span style="font-size:11px">D-${e.left}</span></span></div>`).join('');
  const a=$('tax-alert'), n=$('tax-notice'); if(a) a.checked=S.cfg.taxAlert!==false; if(n) n.checked=!!S.cfg.taxNotice;
}
function taxSet(){ S.cfg.taxAlert=$('tax-alert').checked; S.cfg.taxNotice=$('tax-notice').checked; save(); taxRenderSettings(); refresh(); if(typeof autoMark==='function') autoMark(); }
