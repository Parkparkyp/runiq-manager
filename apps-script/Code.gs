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
 * [보안] 고객 브라우저에서 비밀키 없이 쓸 수 있는 동작은 view(보기) / submit(제출) / pdfSaved(저장 기록) 세 가지(계약서 토큰 필요)와
 *        reqCfg(신청 페이지 공개 설정 읽기) / reqSubmit(예약신청 제출) 두 가지예요. 나머지는 전부 비밀키가 필요해요.
 *        예약신청은 숨은 칸·최소 작성 시간·시간당 접수 제한·중복 차단으로 스팸을 막고, 연락처는 텔레그램 알림에 넣지 않아요.
 *
 * [텔레그램 알림] 코드에 토큰을 적지 말고 프로젝트 설정(⚙) > 스크립트 속성에 TG_TOKEN 을 추가한 뒤,
 *        텔레그램에서 내 봇에게 메시지를 한 번 보내고 setupTelegram 함수를 한 번 실행하세요 (채팅 ID 는 자동 저장돼요).
 */
const SECRET = '여기에-나만-아는-긴-비밀키로-바꾸세요';
const BRAND = '루닉필름';
const CHUNK = 40000;               // 셀 하나(5만자 제한)보다 작게 나눠서 저장
const S_DATA = '데이터', S_PREV = '데이터_이전', S_LIST = '예약목록', S_CON = '계약서';
const CON_HEAD = ['토큰', '생성', '고객명', '계약내용(JSON)', '상태', '서명시각', '서명자', '연락처', '유입경로', '포트폴리오', '개인정보동의', '서명(PNG base64)', '(미사용)', 'PDF저장'];
const S_REQ = '신청함';
const REQ_HEAD = ['ID', '접수시각', '성함', '연락처', '예식일', '시간', '장소', '결제방식', '포트폴리오', '요청사항', '유입경로', '상태', '처리시각'];
const REQ_SRC = ['인스타그램', '블로그', '유튜브', '지인'];
const REQ_PAY = ['계좌', '카드'];
const REQ_PER_HOUR = 20;               // 한 시간에 받는 최대 신청 수 (스팸 방지)
const REQ_MIN_SEC = 4;                 // 페이지를 연 뒤 최소 작성 시간(초)
const REQ_KEEP_DAYS = 30;              // 앱에서 처리한 신청은 이 기간이 지나면 시트에서 지워요 (연락처 보관 최소화)
const VIEW_DAYS = 7;                   // 서명 후 고객이 사본 링크를 다시 열 수 있는 기간(일)

/* ---------------- 진입점 ---------------- */
function doPost(e) {
  let b = null;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'json' }); }
  // 고객 계약서 제출 (비밀키 대신 고객 전용 토큰으로 보호 / 자체 잠금 사용)
  if (b && b.action === 'submit') return out_(submitContract_(b.token, b.p));
  // 고객이 PDF를 저장했다는 기록 (토큰으로 보호)
  if (b && b.action === 'pdfSaved') return out_(pdfSaved_(String(b.token || ''), String(b.mode || '')));
  // 예약신청 페이지 (비밀키 없음 · 공개 동작 2가지)
  if (b && b.action === 'reqCfg') return out_(reqCfg_());
  if (b && b.action === 'reqSubmit') return out_(reqSubmit_(b.p));
  // 고객 계약서 화면이 내용을 불러올 때 (읽기 전용, 고객 전용 토큰으로 보호)
  if (b && b.action === 'view') return out_(Object.assign({ ok: true }, contractView_(String(b.token || ''))));
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    if (!b || b.key !== SECRET) return out_({ ok: false, error: 'key' });
    switch (b.action) {
      case 'ping': return out_({ ok: true, ts: curTs_() });
      case 'backup': return out_(backup_(b));
      case 'restore': return out_(restore_());
      case 'contractCreate': return out_(contractCreate_(b));
      case 'contractList': return out_(contractList_());
      case 'contractGet': return out_(contractGet_(b));
      case 'contractDelete': return out_(contractDelete_(b));
      case 'pubSet': return out_(pubSet_(b));
      case 'reqList': return out_(reqList_());
      case 'reqMark': return out_(reqMark_(b));
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
  if (!c) return out_({ ok: true, msg: BRAND + ' 서버 동작 중', version: 'v42-source' });   // 배포된 코드 버전 확인용
  if (e.parameter.action === 'contract') return out_(Object.assign({ ok: true }, contractView_(String(c))));
  return out_({ ok: false, error: 'use-post' });
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
  const lock = LockService.getScriptLock();            // 두 기기가 동시에 저장해도 순서대로 처리 (자동 동기화용)
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'busy' }; }
  try { return backupLocked_(b); } finally { lock.releaseLock(); }
}
function backupLocked_(b) {
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
  const cur = s.getLastRow() < 1 ? [] : s.getRange(1, 1, 1, CON_HEAD.length).getValues()[0];
  if (cur.join('|') !== CON_HEAD.join('|')) {        // 처음 만들거나 예전 버전 시트면 제목 줄을 최신으로 맞춤 (데이터는 그대로)
    s.getRange(1, 1, 1, CON_HEAD.length).setValues([CON_HEAD]).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    s.setFrozenRows(1);
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
function parseKst_(str) {            // 'yyyy-MM-dd HH:mm:ss' (한국시간) → Date, 실패하면 null
  const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]));
}
function maskPhone_(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length >= 10) return d.slice(0, 3) + '-****-' + d.slice(-4);
  return d.length > 4 ? '****' + d.slice(-4) : '****';
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

/* 앱 → 계약서 목록 (서명 이미지는 제외) */
function contractList_() {
  const s = conSheet_(), n = s.getLastRow();
  if (n < 2) return { ok: true, list: [] };
  const v = s.getRange(2, 1, n - 1, CON_HEAD.length).getValues();
  return { ok: true, list: v.map(r => {
    let sn = {};
    try { sn = JSON.parse(r[3]); } catch (e) {}
    return { token: String(r[0]), createdAt: String(r[1]), name: String(r[2]), status: String(r[4]), signedAt: String(r[5]), signName: String(r[6]), phone: String(r[7]), source: String(r[8] || ''), portfolio: String(r[9]), pdf: String(r[13] || ''), date: String(sn.date || ''), time: String(sn.time || ''), venue: String(sn.venue || '') };
  }) };
}

/* 앱 → 서명본 1건 (서명 이미지 포함) */
function contractGet_(b) {
  if (!tokOk_(b.token)) return { ok: false, error: 'param' };
  const s = conSheet_(), r = findRow_(s, b.token);
  if (!r) return { ok: false, error: 'none' };
  const v = s.getRange(r, 1, 1, CON_HEAD.length).getValues()[0];
  let snap = {};
  try { snap = JSON.parse(v[3]); } catch (e) {}
  return { ok: true, snap: snap, status: String(v[4]), signedAt: String(v[5]), signName: String(v[6]), phone: String(v[7]), source: String(v[8] || ''), portfolio: String(v[9]), privacy: String(v[10]), signature: String(v[11]), pdf: String(v[13] || '') };
}

/* 앱 → 계약서 삭제 (행 전체 삭제: 연락처·서명 이미지·동의 기록이 시트에서 사라지고 링크도 닫혀요) */
function contractDelete_(b) {
  if (!tokOk_(b.token)) return { ok: false, error: 'param' };
  const s = conSheet_(), r = findRow_(s, b.token);
  if (!r) return { ok: true, gone: true };
  s.deleteRow(r);
  return { ok: true };
}

/* 고객 → PDF 저장 기록 (btn: 저장 버튼을 누름 / auto: 자동 저장을 시도함) */
function pdfSaved_(token, mode) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    if (!tokOk_(token) || (mode !== 'btn' && mode !== 'auto')) return { ok: false, error: 'param' };
    const s = conSheet_(), r = findRow_(s, token);
    if (!r || s.getRange(r, 5).getValue() !== '서명완료') return { ok: false, error: 'none' };
    const cur = String(s.getRange(r, 14).getValue() || '');
    if (mode === 'auto' && cur.indexOf('버튼저장') === 0) return { ok: true };
    s.getRange(r, 14).setNumberFormat('@').setValue((mode === 'btn' ? '버튼저장 ' : '자동시도 ') + nowStr_());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'busy' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* 고객 → 서명 제출 (고객 브라우저에서 doPost 로만 호출돼요) */
function submitContract_(token, p) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    token = String(token || '');
    if (!tokOk_(token)) return { ok: false, error: '링크가 올바르지 않아요' };
    p = p || {};
    const name = clean_(p.name, 50), phone = clean_(p.phone, 30);
    const port = (p.portfolio === '동의' || p.portfolio === '미동의') ? p.portfolio : '';
    const sig = String(p.sign || '');
    if (!name) return { ok: false, error: '성함을 입력해 주세요' };
    if (phone.replace(/\D/g, '').length < 9) return { ok: false, error: '연락처를 확인해 주세요' };
    if (!port) return { ok: false, error: '포트폴리오 활용 동의 여부를 선택해 주세요' };
    const SRC_OK = ['블로그', '인스타', '유튜브', '그 외'];
    const sel = (Array.isArray(p.source) ? p.source : []).filter(function (x, k, a) { return SRC_OK.indexOf(x) >= 0 && a.indexOf(x) === k; });
    const other = clean_(p.sourceOther, 30);
    const src = sel.map(function (x) { return (x === '그 외' && other) ? '그 외: ' + other : x; }).join(', ');
    if (p.agree !== true || p.privacy !== true || p.confirmed !== true) return { ok: false, error: '필수 동의 항목에 체크해 주세요' };
    if (sig.indexOf('data:image/png;base64,') !== 0 || sig.length < 800 || sig.length > 45000) return { ok: false, error: '서명을 다시 해 주세요' };
    const s = conSheet_(), r = findRow_(s, token);
    if (!r) return { ok: false, error: '링크가 올바르지 않아요' };
    if (s.getRange(r, 5).getValue() === '서명완료') return { ok: false, error: 'done' };
    const signedAt = nowStr_();
    s.getRange(r, 5, 1, 10).setNumberFormat('@');
    s.getRange(r, 5, 1, 9).setValues([['서명완료', signedAt, name, phone, src, port, '동의', sig, '']]);
    s.getRange(r, 14).setNumberFormat('@').setValue('미저장');
    return { ok: true, signedAt: signedAt };
  } catch (err) {
    return { ok: false, error: '일시적인 오류예요. 잠시 후 다시 시도해 주세요' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ---------------- 고객용 계약서 화면 데이터 ---------------- */
/* form: 작성 전 / done: 서명 완료본(연락처 가림, 7일간) / expired: 열람 기간 지남 / invalid */
function contractView_(token) {
  let data = null, status = '', rec = null, signedAt = '';
  if (tokOk_(token)) {
    const s = conSheet_(), r = findRow_(s, token);
    if (r) {
      const v = s.getRange(r, 1, 1, 14).getValues()[0];
      status = String(v[4]); signedAt = String(v[5]);
      try { data = JSON.parse(v[3]); } catch (e) { data = null; }
      if (data) data.token = token;
      if (data && status === '서명완료') rec = { name: String(v[6]), phone: maskPhone_(v[7]), portfolio: String(v[9]), signedAt: signedAt, signature: String(v[11]) };
    }
  }
  if (!data) return { state: 'invalid', d: null };
  if (status !== '서명완료') return { state: 'form', d: data };
  const t = parseKst_(signedAt);
  const left = t ? (t.getTime() + VIEW_DAYS * 86400000 - Date.now()) : 0;
  if (left <= 0) return { state: 'expired', d: null };
  const until = Utilities.formatDate(new Date(t.getTime() + VIEW_DAYS * 86400000), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  return { state: 'done', d: { snap: data, rec: rec, until: until } };
}


/* ======================================================================
 *  예약신청 (고객 → 신청함 시트 → 앱에서 문의접수로 등록)
 * ====================================================================== */
function props_() { return PropertiesService.getScriptProperties(); }
function pub_() { try { return JSON.parse(props_().getProperty('pub') || '{}'); } catch (e) { return {}; } }
function kstToday_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'); }

/* 신청 페이지가 읽는 공개 설정 (금액·접수 여부만) */
function reqCfg_() {
  const p = pub_();
  return { ok: true, brand: BRAND, product: 'DVD', portDiscount: Number(p.portDiscount) || 0, open: p.reqOpen !== false, channelUrl: p.channelUrl || '' };
}

/* 앱 → 공개 설정 올리기 (포트폴리오 할인 금액 / 앱 주소 / 접수 켜기·끄기) */
function pubSet_(b) {
  const cur = pub_(), v = b.pub || {};
  if (v.portDiscount != null) cur.portDiscount = Math.max(0, Math.min(10000000, Math.round(Number(v.portDiscount) || 0)));
  if (typeof v.reqOpen === 'boolean') cur.reqOpen = v.reqOpen;
  if (typeof v.channelUrl === 'string') cur.channelUrl = /^https:\/\/pf\.kakao\.com\/_[A-Za-z0-9_-]{2,40}$/.test(v.channelUrl) ? v.channelUrl : '';
  if (typeof v.appUrl === 'string') cur.appUrl = /^https:\/\/[A-Za-z0-9.\-\/_]{3,150}$/.test(v.appUrl) ? v.appUrl : '';
  props_().setProperty('pub', JSON.stringify(cur));
  return { ok: true };
}

function reqSheet_() {
  const s = sh_(S_REQ);
  const cur = s.getLastRow() < 1 ? [] : s.getRange(1, 1, 1, REQ_HEAD.length).getValues()[0];
  if (cur.join('|') !== REQ_HEAD.join('|')) {
    s.getRange(1, 1, 1, REQ_HEAD.length).setValues([REQ_HEAD]).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    s.setFrozenRows(1);
  }
  return s;
}
function validYmd_(str) {
  const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
function ymdAdd_(ymd, days) {
  const m = ymd.split('-').map(Number);
  return Utilities.formatDate(new Date(Date.UTC(m[0], m[1] - 1, m[2]) + days * 86400000), 'UTC', 'yyyy-MM-dd');
}

/* 고객 → 예약신청 제출 */
function reqSubmit_(p) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    p = p || {};
    if (pub_().reqOpen === false) return { ok: false, error: '지금은 예약신청을 받지 않고 있어요. 카카오톡으로 문의해 주세요' };
    if (p.hp) return { ok: true };                                  // 숨은 칸이 채워졌으면 봇 → 성공처럼 응답하고 저장하지 않아요
    const age = Date.now() - Number(p.t || 0);
    if (!(Number(p.t) > 0) || age > 12 * 3600000) return { ok: false, error: '페이지를 새로 열어서 다시 작성해 주세요' };
    if (age < REQ_MIN_SEC * 1000) return { ok: false, error: '조금 천천히 작성해 주세요. 잠시 후 다시 눌러 주세요' };

    const name = clean_(p.name, 50), phone = clean_(p.phone, 30), venue = clean_(p.venue, 80);
    const digits = phone.replace(/\D/g, '');
    if (!name) return { ok: false, error: '성함을 입력해 주세요' };
    if (digits.length < 9 || digits.length > 12) return { ok: false, error: '연락처를 확인해 주세요' };
    const date = String(p.date || '');
    const today = kstToday_();
    if (!validYmd_(date)) return { ok: false, error: '예식일자를 선택해 주세요' };
    if (date < today) return { ok: false, error: '지난 날짜는 선택할 수 없어요' };
    if (date > ymdAdd_(today, 1100)) return { ok: false, error: '예식일자를 확인해 주세요' };
    const tm = String(p.time || '').match(/^(\d{2}):(\d{2})$/);
    const hh = tm ? +tm[1] : -1, mm = tm ? +tm[2] : -1;
    if (!tm || hh < 9 || hh > 20 || mm % 5 !== 0 || mm > 55 || (hh === 20 && mm !== 0)) return { ok: false, error: '예식시간을 선택해 주세요' };
    if (!venue) return { ok: false, error: '예식장소를 입력해 주세요' };
    if (REQ_PAY.indexOf(p.pay) < 0) return { ok: false, error: '결제방식을 선택해 주세요' };
    if (p.portfolio !== '동의' && p.portfolio !== '미동의') return { ok: false, error: '포트폴리오 활용 여부를 선택해 주세요' };
    if (REQ_SRC.indexOf(p.source) < 0) return { ok: false, error: '유입경로를 선택해 주세요' };
    if (p.privacy !== true) return { ok: false, error: '개인정보 수집·이용에 동의해 주세요' };
    const note = String(p.note == null ? '' : p.note).replace(/[\r\t]+/g, ' ').trim().slice(0, 500);

    const pr = props_();
    let ts = [];
    try { ts = JSON.parse(pr.getProperty('reqTs') || '[]'); } catch (e) { ts = []; }
    const hourAgo = Date.now() - 3600000;
    ts = ts.filter(function (x) { return x > hourAgo; });
    if (ts.length >= REQ_PER_HOUR) return { ok: false, error: '지금 신청이 몰려 있어요. 잠시 후 다시 시도해 주세요' };

    const s = reqSheet_(), n = s.getLastRow();
    if (n >= 2) {                                                   // 같은 번호 + 같은 예식일 중복 접수 방지 (대기 중인 것만)
      const from = Math.max(2, n - 59), v = s.getRange(from, 1, n - from + 1, REQ_HEAD.length).getValues();
      for (let i = 0; i < v.length; i++) if (String(v[i][11]) === '대기' && String(v[i][4]) === date && String(v[i][3]).replace(/\D/g, '') === digits) return { ok: true, dup: true };
    }
    const id = Utilities.getUuid().replace(/-/g, '');
    const r = n + 1;
    s.getRange(r, 1, 1, REQ_HEAD.length).setNumberFormat('@');
    s.getRange(r, 1, 1, REQ_HEAD.length).setValues([[id, nowStr_(), name, phone, date, tm[0], venue, p.pay, p.portfolio, note, p.source, '대기', '']]);
    ts.push(Date.now());
    pr.setProperty('reqTs', JSON.stringify(ts));

    const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(date + 'T00:00:00+09:00').getDay()];
    const dd = date.split('-');
    const app = pub_().appUrl;
    notify_('[루닉 신청] 📩 새 예약신청\n' + name + ' · ' + (+dd[1]) + '/' + (+dd[2]) + '(' + dow + ') ' + tm[0] + '\n📍 ' + venue + '\n💳 ' + p.pay + ' · 📸 포트폴리오 ' + p.portfolio + (app ? '\n\n앱에서 확인: ' + app : ''));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: '일시적인 오류예요. 잠시 후 다시 시도해 주세요' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* 앱 → 대기 중인 신청 목록 */
function reqList_() {
  const s = reqSheet_(), n = s.getLastRow();
  if (n < 2) return { ok: true, list: [] };
  const v = s.getRange(2, 1, n - 1, REQ_HEAD.length).getValues();
  const list = [];
  for (let i = 0; i < v.length && list.length < 100; i++) {
    const r = v[i];
    if (String(r[11]) !== '대기') continue;
    list.push({ id: String(r[0]), at: String(r[1]), name: String(r[2]), phone: String(r[3]), date: String(r[4]), time: String(r[5]), venue: String(r[6]), pay: String(r[7]), portfolio: String(r[8]), note: String(r[9]), source: String(r[10]) });
  }
  return { ok: true, list: list };
}

/* 앱 → 신청 처리 표시 (done: 등록함 / delete: 삭제) */
function reqMark_(b) {
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter(function (x) { return /^[0-9a-f]{32}$/.test(x); }).slice(0, 50);
  if (!ids.length) return { ok: false, error: 'param' };
  const mode = b.mode === 'delete' ? 'delete' : 'done';
  const s = reqSheet_(), n = s.getLastRow();
  if (n < 2) return { ok: true, n: 0 };
  const v = s.getRange(2, 1, n - 1, 1).getValues();
  let cnt = 0;
  for (let i = v.length - 1; i >= 0; i--) {                         // 아래부터 처리해야 행 번호가 안 밀려요
    if (ids.indexOf(String(v[i][0])) < 0) continue;
    if (mode === 'delete') s.deleteRow(i + 2);
    else { s.getRange(i + 2, 12, 1, 2).setNumberFormat('@').setValues([['처리됨', nowStr_()]]); }
    cnt++;
  }
  purgeReq_();
  return { ok: true, n: cnt };
}
/* 처리한 지 오래된 신청은 시트에서 지워서 연락처 보관을 줄여요 */
function purgeReq_() {
  try {
    const s = reqSheet_(), n = s.getLastRow();
    if (n < 2) return;
    const v = s.getRange(2, 11, n - 1, 3).getValues(), cut = Date.now() - REQ_KEEP_DAYS * 86400000;
    for (let i = v.length - 1; i >= 0; i--) {
      if (String(v[i][1]) !== '처리됨') continue;
      const t = parseKst_(v[i][2]);
      if (t && t.getTime() < cut) s.deleteRow(i + 2);
    }
  } catch (e) {}
}

/* ---------------- 텔레그램 ---------------- */
function notify_(text) {
  try {
    const pr = props_(), tk = pr.getProperty('TG_TOKEN'), chat = pr.getProperty('TG_CHAT');
    if (!tk || !chat) return false;
    const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tk + '/sendMessage', { method: 'post', muteHttpExceptions: true, payload: { chat_id: chat, text: text, disable_web_page_preview: 'true' } });
    return r.getResponseCode() === 200;
  } catch (e) { return false; }
}

/* 스크립트 편집기에서 한 번만 직접 실행하는 함수: 내 봇에게 보낸 메시지에서 채팅 ID 를 찾아 저장해요 */
function setupTelegram() {
  const tk = props_().getProperty('TG_TOKEN');
  if (!tk) throw new Error('먼저 프로젝트 설정(⚙) > 스크립트 속성에 TG_TOKEN 을 추가하세요');
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tk + '/getUpdates', { muteHttpExceptions: true });
  const j = JSON.parse(r.getContentText());
  if (!j.ok) throw new Error('토큰이 올바르지 않아요. BotFather 에서 받은 토큰을 다시 확인하세요');
  const seen = {};
  (j.result || []).forEach(function (u) { const m = u.message; if (m && m.chat && m.chat.type === 'private') seen[m.chat.id] = [m.chat.first_name, m.chat.last_name, m.chat.username ? '@' + m.chat.username : ''].filter(Boolean).join(' '); });
  const ids = Object.keys(seen);
  if (!ids.length) throw new Error('텔레그램에서 내 봇을 열어 메시지를 한 번 보낸 뒤 다시 실행하세요');
  if (ids.length > 1) throw new Error('여러 사람이 봇에게 메시지를 보냈어요: ' + ids.map(function (k) { return k + '(' + seen[k] + ')'; }).join(', ') + ' → 내 번호를 스크립트 속성 TG_CHAT 에 직접 넣어 주세요');
  props_().setProperty('TG_CHAT', ids[0]);
  const ok = notify_('[루닉 신청] ✅ 알림 연결 완료! 앞으로 새 예약신청이 오면 여기로 알려드려요.');
  Logger.log((ok ? '완료' : '저장은 됐지만 테스트 메시지 전송 실패') + ' · 연결된 채팅: ' + seen[ids[0]]);
}
