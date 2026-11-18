/**
 * 루닉필름 매니저 - 구글 시트 클라우드 백업 + 전자 계약서 (Apps Script)
 *
 * [설치]
 * 1) 구글 시트를 새로 만들고 확장 프로그램 > Apps Script 를 엽니다.
 *    (script.google.com 에서 따로 만들었다면 '루닉필름 데이터' 시트가 내 드라이브에 자동 생성돼요)
 * 2) 이 코드 전체를 붙여넣고, 아래 SECRET 을 나만 아는 긴 비밀키로 바꿉니다.
 * 3) 배포 > 새 배포 > 유형: 웹 앱 / 실행: 나 / 액세스: 모든 사용자 → 배포
 * 4) 나온 웹 앱 URL 과 비밀키를 앱 설정 > 클라우드 백업에 붙여넣습니다.
 * (코드를 고치면 배포 > 배포 관리 > ✏️수정 > 버전: 새 버전 > 배포 로 다시 배포해야 반영돼요)
 *
 * [보안] 이름 끝에 _ 가 붙은 함수는 외부에서 직접 호출할 수 없어요.
 *        고객 브라우저에서 호출 가능한 함수는 submitContract 하나뿐이고, 추측 불가능한 토큰이 있어야만 동작해요.
 */
const SECRET = '여기에-나만-아는-긴-비밀키로-바꾸세요';
const BRAND = '루닉필름';
const CHUNK = 40000;               // 셀 하나(5만자 제한)보다 작게 나눠서 저장
const S_DATA = '데이터', S_PREV = '데이터_이전', S_LIST = '예약목록', S_CON = '계약서';
const CON_HEAD = ['토큰', '생성', '고객명', '계약내용(JSON)', '상태', '서명시각', '서명자', '연락처', '주소', '포트폴리오', '개인정보동의', '서명(PNG base64)', '이메일', '메일결과'];

/* ---------------- 진입점 ---------------- */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const b = JSON.parse(e.postData.contents);
    if (!b || b.key !== SECRET) return out_({ ok: false, error: 'key' });
    switch (b.action) {
      case 'ping': return out_({ ok: true, ts: curTs_() });
      case 'backup': return out_(backup_(b));
      case 'restore': return out_(restore_());
      case 'contractCreate': return out_(contractCreate_(b));
      case 'contractList': return out_(contractList_());
      case 'contractGet': return out_(contractGet_(b));
    }
    return out_({ ok: false, error: 'action' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet(e) {
  const c = e && e.parameter && e.parameter.c;
  if (!c) return out_({ ok: true, msg: BRAND + ' 서버 동작 중' });
  return page_(String(c));
}

/* ---------------- 공통 유틸 ---------------- */
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function curTs_() { return Number(PropertiesService.getScriptProperties().getProperty('ts') || 0); }
function book_() {
  // 시트에서 연 스크립트면 그 시트를, 따로 만든 스크립트면 '루닉필름 데이터' 시트를 자동 생성해서 사용
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('sid');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  ss = SpreadsheetApp.create(BRAND + ' 데이터');
  props.setProperty('sid', ss.getId());
  return ss;
}
function sh_(name) { const ss = book_(); return ss.getSheetByName(name) || ss.insertSheet(name); }
function clean_(x, n) { return String(x == null ? '' : x).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n); }
function tokOk_(t) { return /^[A-Za-z0-9]{16,40}$/.test(String(t || '')); }
function nowStr_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'); }

/* ---------------- 백업 ---------------- */
function readChunks_(sheet) {
  const n = sheet.getLastRow();
  if (n < 2) return '';
  return sheet.getRange(2, 1, n - 1, 1).getValues().map(r => r[0]).join('');
}
function writeChunks_(sheet, str) {
  sheet.clear();
  sheet.getRange(1, 1).setValue(BRAND + ' 백업 데이터 (직접 수정하지 마세요)');
  const parts = [];
  for (let i = 0; i < str.length; i += CHUNK) parts.push([str.substr(i, CHUNK)]);
  if (!parts.length) return;
  const r = sheet.getRange(2, 1, parts.length, 1);
  r.setNumberFormat('@');          // 수식으로 해석되지 않게 텍스트로 저장
  r.setValues(parts);
}
function backup_(b) {
  if (typeof b.data !== 'string' || b.data.length < 2) return { ok: false, error: 'data' };
  const cur = curTs_();
  if (!b.force && cur && Number(b.baseTs) !== cur) return { ok: false, conflict: true, ts: cur };
  const dSheet = sh_(S_DATA);
  writeChunks_(sh_(S_PREV), readChunks_(dSheet));   // 직전 버전 한 개 보관
  writeChunks_(dSheet, b.data);
  writeList_(b.rows || []);
  const ts = Date.now();
  PropertiesService.getScriptProperties().setProperty('ts', String(ts));
  return { ok: true, ts: ts, count: (b.rows || []).length };
}
function restore_() {
  const str = readChunks_(sh_(S_DATA));
  if (!str) return { ok: false, error: 'empty' };
  return { ok: true, ts: curTs_(), data: str };
}
function writeList_(rows) {
  const s = sh_(S_LIST);
  s.clear();
  const head = ['예식일', '시간', '고객명', '연락처', '진행상태', '장소', '총금액', '계약금', '잔금', '주소', '납품', '메모'];
  s.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
  if (rows.length) {
    s.getRange(2, 1, rows.length, head.length).setValues(rows.map(r => head.map((_, k) => r[k] == null ? '' : r[k])));
    s.getRange(2, 7, rows.length, 3).setNumberFormat('#,##0');
  }
  s.setFrozenRows(1);
}

/* ---------------- 계약서: 시트 ---------------- */
function conSheet_() {
  const s = sh_(S_CON);
  if (s.getLastRow() < 1) {
    s.getRange(1, 1, 1, CON_HEAD.length).setValues([CON_HEAD]).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    s.setFrozenRows(1);
  } else if (!s.getRange(1, 13).getValue()) {        // v10 이전 시트: 새 열 제목 보충
    s.getRange(1, 13, 1, 2).setValues([['이메일', '메일결과']]).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
  }
  return s;
}
function findRow_(s, token) {
  const n = s.getLastRow();
  if (n < 2) return 0;
  const v = s.getRange(2, 1, n - 1, 1).getValues();
  for (let i = 0; i < v.length; i++) if (String(v[i][0]) === token) return i + 2;
  return 0;
}

/* 앱 → 계약서 생성/수정 (서명 전까지만 수정 가능) */
function contractCreate_(b) {
  if (!tokOk_(b.token) || !b.snap || typeof b.snap !== 'object') return { ok: false, error: 'param' };
  const js = JSON.stringify(b.snap);
  if (js.length > 45000) return { ok: false, error: '계약서 문구가 너무 길어요' };
  const s = conSheet_();
  let r = findRow_(s, b.token);
  if (r) {
    if (s.getRange(r, 5).getValue() === '서명완료') return { ok: false, error: 'signed' };
    s.getRange(r, 3).setValue(clean_(b.snap.name, 60));
    s.getRange(r, 4).setValue(js);
  } else {
    r = s.getLastRow() + 1;
    s.getRange(r, 1, 1, CON_HEAD.length).setNumberFormat('@');
    s.getRange(r, 1, 1, 5).setValues([[b.token, nowStr_(), clean_(b.snap.name, 60), js, '대기']]);
  }
  return { ok: true };
}

/* 앱 → 서명 현황 (서명 이미지는 제외) */
function contractList_() {
  const s = conSheet_(), n = s.getLastRow();
  if (n < 2) return { ok: true, list: [] };
  const v = s.getRange(2, 1, n - 1, CON_HEAD.length).getValues();
  return { ok: true, list: v.map(r => ({ token: String(r[0]), status: String(r[4]), signedAt: String(r[5]), signName: String(r[6]), phone: String(r[7]), address: String(r[8]), portfolio: String(r[9]), email: String(r[12] || '') })) };
}

/* 앱 → 서명본 1건 (서명 이미지 포함) */
function contractGet_(b) {
  if (!tokOk_(b.token)) return { ok: false, error: 'param' };
  const s = conSheet_(), r = findRow_(s, b.token);
  if (!r) return { ok: false, error: 'none' };
  const v = s.getRange(r, 1, 1, CON_HEAD.length).getValues()[0];
  let snap = {};
  try { snap = JSON.parse(v[3]); } catch (e) {}
  return { ok: true, snap: snap, status: String(v[4]), signedAt: String(v[5]), signName: String(v[6]), phone: String(v[7]), address: String(v[8]), portfolio: String(v[9]), privacy: String(v[10]), signature: String(v[11]), email: String(v[12] || ''), mail: String(v[13] || '') };
}

/* 고객 → 서명 제출 (고객 브라우저에서 호출되는 유일한 공개 함수) */
function submitContract(token, p) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    token = String(token || '');
    if (!tokOk_(token)) return { ok: false, error: '링크가 올바르지 않아요' };
    p = p || {};
    const name = clean_(p.name, 50), phone = clean_(p.phone, 30), addr = clean_(p.address, 200), email = clean_(p.email, 100);
    const port = (p.portfolio === '동의' || p.portfolio === '미동의') ? p.portfolio : '';
    const sig = String(p.sign || '');
    if (!name) return { ok: false, error: '성함을 입력해 주세요' };
    if (phone.replace(/\D/g, '').length < 9) return { ok: false, error: '연락처를 확인해 주세요' };
    if (addr.length < 5) return { ok: false, error: '주소를 입력해 주세요' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: '이메일 주소를 확인해 주세요' };
    if (!port) return { ok: false, error: '포트폴리오 활용 동의 여부를 선택해 주세요' };
    if (p.agree !== true || p.privacy !== true) return { ok: false, error: '필수 동의 항목에 체크해 주세요' };
    if (sig.indexOf('data:image/png;base64,') !== 0 || sig.length < 800 || sig.length > 45000) return { ok: false, error: '서명을 다시 해 주세요' };
    const s = conSheet_(), r = findRow_(s, token);
    if (!r) return { ok: false, error: '링크가 올바르지 않아요' };
    if (s.getRange(r, 5).getValue() === '서명완료') return { ok: false, error: 'done' };
    const signedAt = nowStr_();
    s.getRange(r, 5, 1, 10).setNumberFormat('@');
    s.getRange(r, 5, 1, 9).setValues([['서명완료', signedAt, name, phone, addr, port, '동의', sig, email]]);
    let snap = {};
    try { snap = JSON.parse(s.getRange(r, 4).getValue()); } catch (e) {}
    let mail = '';
    try { mail = sendCopies_(snap, { name: name, phone: phone, address: addr, email: email, portfolio: port, signedAt: signedAt, signature: sig }); } catch (e) { mail = '실패: ' + String(e).slice(0, 120); }
    s.getRange(r, 14).setValue(mail);
    return { ok: true, mail: mail.indexOf('실패') < 0 };
  } catch (err) {
    return { ok: false, error: '일시적인 오류예요. 잠시 후 다시 시도해 주세요' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ---------------- 서명 사본 (PDF / 메일) ---------------- */
function esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function copyHtml_(snap, rec) {
  const nl = function (x) { return esc_(x).replace(/\n/g, '<br>'); };
  const row = function (k, v) { return '<tr><td style="padding:4px 8px 4px 0;color:#64748b;width:120px">' + esc_(k) + '</td><td style="padding:4px 0"><b>' + esc_(v) + '</b></td></tr>'; };
  const sig = /^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(rec.signature || '') ? '<img src="' + rec.signature + '" style="width:240px;border:1px solid #cbd5e1">' : '(서명 이미지 없음)';
  return '<html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;font-size:11px;line-height:1.6;color:#0f172a">' +
    '<h2 style="margin:0">' + esc_(BRAND) + ' 촬영 계약서</h2><p style="margin:2px 0 10px;color:#64748b">' + esc_(rec.name) + '님 · 서명 시각 ' + esc_(rec.signedAt) + '</p>' +
    '<table>' + row('촬영 일시', (snap.date || '') + ' ' + (snap.time || '')) + row('장소', snap.venue || '') + row('서명자', rec.name) + row('연락처', rec.phone) + row('주소', rec.address) + row('이메일', rec.email) + row('포트폴리오 활용', rec.portfolio) + '</table>' +
    '<h3>계약 내용</h3><div style="border:1px solid #e2e8f0;padding:8px">' + nl(snap.body || '') + '</div>' +
    '<h3>개인정보 수집·이용 동의 (동의함)</h3><div style="border:1px solid #e2e8f0;padding:8px">' + nl(snap.privacy || '') + '</div>' +
    '<h3>서명</h3>' + sig + '</body></html>';
}
function sendCopies_(snap, rec) {
  const pdf = HtmlService.createHtmlOutput(copyHtml_(snap, rec)).getBlob().getAs('application/pdf').setName(BRAND + '_계약서_' + rec.name + '.pdf');
  const out = [];
  try {
    MailApp.sendEmail({ to: rec.email, subject: '[' + BRAND + '] ' + rec.name + '님 촬영 계약서 사본', name: BRAND, attachments: [pdf],
      body: rec.name + '님, 서명해 주신 촬영 계약서 사본을 보내드립니다.\n\n촬영 일시: ' + (snap.date || '') + ' ' + (snap.time || '') + '\n장소: ' + (snap.venue || '') + '\n\n첨부된 PDF를 보관해 주세요. 문의가 있으시면 카카오톡으로 연락 주세요.\n\n' + BRAND });
    out.push('고객 발송완료');
  } catch (e) { out.push('고객 실패: ' + String(e).slice(0, 80)); }
  try {
    const me = Session.getEffectiveUser().getEmail();
    if (me && me !== rec.email) { MailApp.sendEmail({ to: me, subject: '[계약 도착] ' + rec.name + '님 서명 완료', name: BRAND, attachments: [pdf], body: rec.name + '님이 계약서에 서명했어요. 사본을 첨부합니다.' }); out.push('내 메일 발송완료'); }
  } catch (e) { out.push('내 메일 실패: ' + String(e).slice(0, 80)); }
  return out.join(' / ');
}

/* ---------------- 고객용 계약서 페이지 ---------------- */
function page_(token) {
  let data = null, status = '', rec = null;
  if (tokOk_(token)) {
    const s = conSheet_(), r = findRow_(s, token);
    if (r) {
      const v = s.getRange(r, 1, 1, 13).getValues()[0];
      status = String(v[4]);
      try { data = JSON.parse(v[3]); } catch (e) { data = null; }
      if (data) data.token = token;
      if (data && status === '서명완료') rec = { name: String(v[6]), phone: String(v[7]), address: String(v[8]), portfolio: String(v[9]), signedAt: String(v[5]), signature: String(v[11]), email: String(v[12] || '') };
    }
  }
  const state = !data ? 'invalid' : (status === '서명완료' ? 'done' : 'form');
  const json = JSON.stringify({ state: state, brand: BRAND, d: state === 'form' ? data : (state === 'done' ? { snap: data, rec: rec } : null) }).replace(/</g, '\\u003c').split('\u2028').join('\\u2028').split('\u2029').join('\\u2029');
  const html = PAGE_HTML_.split('__DATA__').join(json);
  return HtmlService.createHtmlOutput(html).setTitle(BRAND + ' 촬영 계약서').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

const PAGE_HTML_ = String.raw`<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>
:root{--ink:#0f172a;--mut:#64748b;--ln:#e2e8f0;--am:#fbbf24;--bg:#f1f5f9}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 -apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}
.wrap{max-width:520px;margin:0 auto;padding:0 14px 48px}
header{background:var(--ink);color:#fff;padding:20px 16px 18px;margin:0 -14px 14px;border-radius:0 0 18px 18px}
header small{color:#fcd34d;font-weight:800;font-size:12px;letter-spacing:.5px}
header h1{margin:2px 0 0;font-size:19px}
.c{background:#fff;border:1px solid var(--ln);border-radius:16px;padding:14px;margin-bottom:12px}
.c h2{margin:0 0 8px;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:6px 0;border-bottom:1px solid var(--ln);vertical-align:top}
td:first-child{color:var(--mut);width:34%;white-space:nowrap}
tr:last-child td{border-bottom:0}
td b{font-weight:800}
.box{max-height:280px;overflow:auto;white-space:pre-wrap;font-size:13.5px;line-height:1.7;background:#f8fafc;border:1px solid var(--ln);border-radius:12px;padding:12px}
label{display:block;font-size:12px;font-weight:800;color:var(--mut);margin:12px 0 4px}
input[type=text],input[type=tel]{width:100%;padding:12px;border:1.5px solid var(--ln);border-radius:12px;font-size:16px;font-family:inherit}
input[type=text]:focus,input[type=tel]:focus{outline:0;border-color:var(--ink)}
.ck{display:flex;gap:10px;align-items:flex-start;margin-top:10px;font-size:14px;font-weight:700;color:var(--ink)}
.ck input{width:22px;height:22px;flex:none;margin-top:1px}
.opt{display:flex;gap:8px;margin-top:6px}
.opt label{flex:1;margin:0;display:flex;align-items:center;justify-content:center;gap:6px;padding:12px;border:1.5px solid var(--ln);border-radius:12px;font-size:14px;color:var(--ink);cursor:pointer}
.opt input{margin:0}
.opt label.on{border-color:var(--ink);background:var(--ink);color:#fff}
canvas{display:block;width:100%;height:auto;background:#fff;border:1.5px dashed #94a3b8;border-radius:12px;touch-action:none}
.row{display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:12px;color:var(--mut)}
button{font:inherit;cursor:pointer}
.clr{background:#fff;border:1px solid var(--ln);border-radius:10px;padding:6px 12px;font-weight:700;font-size:12px}
.go{width:100%;margin-top:14px;padding:16px;border:0;border-radius:14px;background:var(--ink);color:#fcd34d;font-size:16px;font-weight:800}
.go:disabled{opacity:.5}
.err{color:#be123c;font-weight:800;font-size:13px;margin-top:10px;white-space:pre-wrap}
.note{font-size:12px;color:var(--mut);margin-top:6px}
.big{text-align:center;padding:36px 10px}
.big b{display:block;font-size:20px;margin-bottom:8px}
.pb{white-space:pre-wrap;font-size:13px;line-height:1.7}
@media print{.noprint{display:none!important}body{background:#fff}.c{border:0;padding:6px 0}header{border-radius:0}}
</style></head><body><div class="wrap" id="app"></div>
<script>
var X=__DATA__;
var app=document.getElementById('app');
function el(t,a,x){var e=document.createElement(t);if(a)for(var k in a){if(k==='class')e.className=a[k];else e.setAttribute(k,a[k]);}if(x!=null)e.textContent=x;return e;}
function won(n){return String(Math.round(Number(n)||0)).replace(/\B(?=(\d{3})+(?!\d))/g,',')+'원';}
function head(){var h=el('header');h.appendChild(el('small',0,X.brand));h.appendChild(el('h1',0,'촬영 계약서'));app.appendChild(h);}
function big(t,s){head();var c=el('div',{class:'c big'});c.appendChild(el('b',0,t));c.appendChild(el('span',{class:'note'},s));app.appendChild(c);}
if(X.state==='invalid'){big('유효하지 않은 링크예요','링크를 다시 확인하시거나 담당자에게 문의해 주세요.');}
else if(X.state==='done'){showDone(X.d.snap,X.d.rec,false,true);}
else{build(X.d);}

function parseSecs(b){
  b=String(b||'');var parts=b.split(/\n={3,}[ \t]*\n/);
  if(parts.length<2)return[{title:'계약 내용',text:b.trim(),label:'',port:false}];
  return parts.map(function(s){
    s=s.trim();var nl=s.indexOf('\n');var title=nl<0?s:s.slice(0,nl).trim();var text=nl<0?'':s.slice(nl+1).trim();
    var label='';var m=text.match(/(^|\n)☑ ([^\n]+)\s*$/);if(m){label=m[2].trim();text=text.slice(0,m.index).trim();}
    var port=text.indexOf('[[포트폴리오선택]]')>=0;if(port)text=text.split('[[포트폴리오선택]]').join('').trim();
    return{title:title,text:text,label:label,port:port};
  });
}

function showDone(D,r,now,mailOk){
  app.innerHTML='';head();
  var c=el('div',{class:'c big noprint'});c.appendChild(el('b',0,now?'제출이 완료되었어요':'서명이 완료된 계약서'));
  c.appendChild(el('span',{class:'note'},now?(mailOk?'입력하신 이메일로 사본을 보내드렸어요. 아래에서 바로 저장하셔도 돼요.':'이메일 발송이 되지 않았어요. 아래 [인쇄 / PDF 저장]으로 사본을 꼭 저장해 주세요.'):'이 링크를 다시 열면 언제든 사본을 확인할 수 있어요.'));
  var pr=el('button',{class:'go',type:'button',style:'margin-top:14px'},'🖨️ 인쇄 / PDF 저장');pr.addEventListener('click',function(){window.print();});c.appendChild(pr);app.appendChild(c);
  var c1=el('div',{class:'c'});c1.appendChild(el('h2',0,D.name+'님 계약서 사본'));
  var tb=el('table');function tr(k,v){var rr=el('tr');rr.appendChild(el('td',0,k));var d=el('td');d.appendChild(el('b',0,v));rr.appendChild(d);tb.appendChild(rr);}
  tr('촬영 일시',D.date+' '+D.time);tr('장소',D.venue);tr('서명자',r.name);tr('연락처',r.phone);tr('주소',r.address);tr('이메일',r.email);tr('포트폴리오 활용',r.portfolio);tr('서명 시각',r.signedAt);
  c1.appendChild(tb);app.appendChild(c1);
  parseSecs(D.body).forEach(function(s){var c2=el('div',{class:'c'});c2.appendChild(el('h2',0,s.title));if(s.text)c2.appendChild(el('div',{class:'pb'},s.text));app.appendChild(c2);});
  var c3=el('div',{class:'c'});c3.appendChild(el('h2',0,'개인정보 수집·이용 동의 (동의함)'));c3.appendChild(el('div',{class:'pb'},D.privacy));app.appendChild(c3);
  var c4=el('div',{class:'c'});c4.appendChild(el('h2',0,'서명'));var im=el('img',{src:r.signature,style:'max-width:260px;border:1px solid #cbd5e1;border-radius:8px'});c4.appendChild(im);app.appendChild(c4);
  window.scrollTo(0,0);
}
function build(D){
  head();
  var base=(Number(D.total)||0)+(Number(D.portApplied)||0), dep=Number(D.deposit)||0, pd=Number(D.portDiscount)||0;
  var c1=el('div',{class:'c'});c1.appendChild(el('h2',0,D.name+'님의 촬영 정보'));
  var tb=el('table');
  function tr(k,v,id){var r=el('tr');r.appendChild(el('td',0,k));var d=el('td');var b=el('b',id?{id:id}:0,v);d.appendChild(b);r.appendChild(d);tb.appendChild(r);}
  tr('촬영 일시',D.date+' '+D.time);tr('장소',D.venue);if(D.category)tr('상품',D.category);
  tr('총 금액','','tot');tr('계약금',won(dep));tr('잔금','','bal');
  c1.appendChild(tb);var pnote=el('div',{class:'note',id:'pnote'});c1.appendChild(pnote);app.appendChild(c1);

  var c3=el('div',{class:'c'});c3.appendChild(el('h2',0,'개인정보 수집·이용 동의'));c3.appendChild(el('div',{class:'box',style:'max-height:200px'},D.privacy));
  var pg=el('label',{class:'ck'});var pgc=el('input',{type:'checkbox',id:'privacy'});pg.appendChild(pgc);pg.appendChild(el('span',0,'개인정보 수집·이용에 동의합니다. (필수)'));c3.appendChild(pg);app.appendChild(c3);

  var c5=el('div',{class:'c'});c5.appendChild(el('h2',0,'신청자 정보'));
  c5.appendChild(el('label',0,'성함'));c5.appendChild(el('input',{type:'text',id:'nm',autocomplete:'name',placeholder:'성함 (서명자)'}));
  c5.appendChild(el('label',0,'연락처'));var ph=el('input',{type:'tel',id:'ph',autocomplete:'tel',placeholder:'010-0000-0000'});ph.value=D.phone||'';c5.appendChild(ph);
  c5.appendChild(el('label',0,'주소'));var ad=el('input',{type:'text',id:'ad',autocomplete:'street-address',placeholder:'계약 및 안내용 주소'});ad.value=D.address||'';c5.appendChild(ad);
  c5.appendChild(el('label',0,'이메일 (서명한 계약서 사본을 보내드려요)'));var em=el('input',{type:'email',id:'em',autocomplete:'email',placeholder:'example@gmail.com'});em.style.cssText='width:100%;padding:12px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:16px;font-family:inherit';c5.appendChild(em);
  app.appendChild(c5);

  var portBox=el('div');
  portBox.appendChild(el('div',{class:'note',style:'margin:8px 0 4px'},pd>0?('촬영 영상·사진을 작가의 포트폴리오·홍보에 활용하는 것에 동의하시면 '+won(pd)+'이 할인됩니다. (필수 선택)'):'포트폴리오 활용 동의 여부를 선택해 주세요. (필수 선택)'));
  var op=el('div',{class:'opt'});var pv=D.portfolio||'';
  [['동의','동의함 (포트폴리오 활용 할인 상품)'],['미동의','동의하지 않음 (비공개 촬영 일반가)']].forEach(function(a){var v=a[0];var l=el('label');var r=el('input',{type:'radio',name:'port',value:v});if(pv===v){r.checked=true;l.className='on';}r.addEventListener('change',function(){sync();});l.appendChild(r);l.appendChild(document.createTextNode(a[1]));op.appendChild(l);});
  portBox.appendChild(op);
  var secs=parseSecs(D.body),checks=[],hasPort=false;
  secs.forEach(function(s){
    var c=el('div',{class:'c'});c.appendChild(el('h2',0,s.title));
    if(s.text)c.appendChild(el('div',{class:'box'},s.text));
    if(s.port){hasPort=true;c.appendChild(portBox);}
    else{var l=el('label',{class:'ck'});var cb=el('input',{type:'checkbox'});l.appendChild(cb);l.appendChild(el('span',0,s.label||(secs.length===1?'위 계약 내용을 모두 읽었으며 이에 동의합니다. (필수)':'위 내용을 확인하고 동의합니다. (필수)')));c.appendChild(l);checks.push({t:s.title,i:cb});}
    app.appendChild(c);
  });
  if(!hasPort){var cp=el('div',{class:'c'});cp.appendChild(el('h2',0,'촬영물 포트폴리오 활용'));cp.appendChild(portBox);app.appendChild(cp);}

  var c6=el('div',{class:'c'});c6.appendChild(el('h2',0,'서명'));
  var cv=el('canvas',{width:640,height:240});c6.appendChild(cv);
  var rw=el('div',{class:'row'});rw.appendChild(el('span',0,'위 칸에 손가락으로 서명해 주세요'));var cl=el('button',{class:'clr',type:'button'},'지우기');rw.appendChild(cl);c6.appendChild(rw);app.appendChild(c6);

  var err=el('div',{class:'err',id:'err'});app.appendChild(err);
  var go=el('button',{class:'go',type:'button'},'계약서 제출하기');app.appendChild(go);
  app.appendChild(el('div',{class:'note',style:'text-align:center;margin-top:10px'},'제출 후에는 수정할 수 없어요. 내용을 한 번 더 확인해 주세요.'));

  function sync(){
    var chk=document.querySelector('input[name=port]:checked');var v=chk?chk.value:'';
    var tot=(v==='동의')?Math.max(0,base-pd):base;
    document.getElementById('tot').textContent=won(tot);document.getElementById('bal').textContent=won(Math.max(0,tot-dep));
    pnote.textContent=(v==='동의'&&pd>0)?'포트폴리오 동의 할인 '+won(pd)+'이 적용된 금액입니다.':'';
    var ls=document.querySelectorAll('.opt label');for(var i=0;i<ls.length;i++){ls[i].className=ls[i].firstChild.checked?'on':'';}
  }
  sync();

  var ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);
  ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#0f172a';
  var drawing=false,inked=0;
  function pos(e){var r=cv.getBoundingClientRect();return{x:(e.clientX-r.left)*cv.width/r.width,y:(e.clientY-r.top)*cv.height/r.height};}
  cv.addEventListener('pointerdown',function(e){e.preventDefault();drawing=true;try{cv.setPointerCapture(e.pointerId);}catch(x){}var p=pos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+0.1,p.y+0.1);ctx.stroke();inked+=1;});
  cv.addEventListener('pointermove',function(e){if(!drawing)return;e.preventDefault();var p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();inked+=1;});
  function up(){drawing=false;}
  cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);cv.addEventListener('pointerleave',up);
  cl.addEventListener('click',function(){ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);inked=0;});

  function exportSig(){
    var u=cv.toDataURL('image/png');
    if(u.length>42000){var s=document.createElement('canvas');s.width=320;s.height=120;var g=s.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,320,120);g.drawImage(cv,0,0,320,120);u=s.toDataURL('image/png');}
    return u;
  }
  function fail(m){err.textContent=m;go.disabled=false;go.textContent='계약서 제출하기';err.scrollIntoView({behavior:'smooth',block:'center'});}
  go.addEventListener('click',function(){
    err.textContent='';
    var chk=document.querySelector('input[name=port]:checked');
    var p={name:document.getElementById('nm').value.trim(),phone:document.getElementById('ph').value.trim(),address:document.getElementById('ad').value.trim(),email:document.getElementById('em').value.trim(),
      portfolio:chk?chk.value:'',agree:true,privacy:document.getElementById('privacy').checked};
    if(!p.privacy)return fail('「개인정보 수집·이용 동의」에 체크해 주세요.');
    if(!p.portfolio)return fail('포트폴리오 활용 동의 여부를 선택해 주세요.');
    for(var k=0;k<checks.length;k++){if(!checks[k].i.checked)return fail('「'+checks[k].t+'」 항목에 체크해 주세요.');}
    if(!p.name)return fail('성함을 입력해 주세요.');
    if(p.phone.replace(/\D/g,'').length<9)return fail('연락처를 확인해 주세요.');
    if(p.address.length<5)return fail('주소를 입력해 주세요.');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email))return fail('이메일 주소를 확인해 주세요.');
    if(inked<15)return fail('서명을 해 주세요.');
    p.sign=exportSig();
    go.disabled=true;go.textContent='제출 중…';
    google.script.run.withSuccessHandler(function(r){
      if(r&&r.ok){showDone(D,{name:p.name,phone:p.phone,address:p.address,email:p.email,portfolio:p.portfolio,signedAt:'방금',signature:p.sign},true,!!r.mail);}
      else if(r&&r.error==='done'){app.innerHTML='';big('이미 제출해 주셨어요','이 링크를 다시 열면 사본을 확인할 수 있어요.');}
      else fail((r&&r.error)||'제출에 실패했어요. 잠시 후 다시 시도해 주세요.');
    }).withFailureHandler(function(){fail('네트워크 오류가 발생했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.');}).submitContract(D.token,p);
  });
}
</script></body></html>`;
