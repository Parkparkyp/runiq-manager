/**
 * 루닉스냅 매니저 - 구글 시트 클라우드 백업 (Apps Script)
 * 1) 구글 시트를 새로 만들고  확장 프로그램 > Apps Script 를 엽니다.
 * 2) 이 코드 전체를 붙여넣고, 아래 SECRET 을 나만 아는 긴 비밀키로 바꿉니다.
 * 3) 배포 > 새 배포 > 유형: 웹 앱 / 실행: 나 / 액세스: 모든 사용자 → 배포
 * 4) 나온 웹 앱 URL 과 비밀키를 앱 설정 > 클라우드 백업에 붙여넣습니다.
 * (코드를 고치면 배포 > 배포 관리 > 수정 > 새 버전 으로 다시 배포해야 반영돼요)
 */
const SECRET = '여기에-나만-아는-긴-비밀키로-바꾸세요';
const CHUNK = 40000;               // 셀 하나(5만자 제한)보다 작게 나눠서 저장
const S_DATA = '데이터', S_PREV = '데이터_이전', S_LIST = '예약목록';

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const b = JSON.parse(e.postData.contents);
    if (!b || b.key !== SECRET) return out({ ok: false, error: 'key' });
    if (b.action === 'ping') return out({ ok: true, ts: curTs() });
    if (b.action === 'backup') return out(backup(b));
    if (b.action === 'restore') return out(restore());
    return out({ ok: false, error: 'action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}
function doGet() { return out({ ok: true, msg: '루닉스냅 백업 서버 동작 중' }); }

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function curTs() { return Number(PropertiesService.getScriptProperties().getProperty('ts') || 0); }
function sh(name) { const ss = SpreadsheetApp.getActiveSpreadsheet(); return ss.getSheetByName(name) || ss.insertSheet(name); }

function readChunks(sheet) {
  const n = sheet.getLastRow();
  if (n < 2) return '';
  return sheet.getRange(2, 1, n - 1, 1).getValues().map(r => r[0]).join('');
}
function writeChunks(sheet, str) {
  sheet.clear();
  sheet.getRange(1, 1).setValue('루닉스냅 백업 데이터 (직접 수정하지 마세요)');
  const parts = [];
  for (let i = 0; i < str.length; i += CHUNK) parts.push([str.substr(i, CHUNK)]);
  if (!parts.length) return;
  const r = sheet.getRange(2, 1, parts.length, 1);
  r.setNumberFormat('@');          // 수식으로 해석되지 않게 텍스트로 저장
  r.setValues(parts);
}

function backup(b) {
  if (typeof b.data !== 'string' || b.data.length < 2) return { ok: false, error: 'data' };
  const cur = curTs();
  if (!b.force && cur && Number(b.baseTs) !== cur) return { ok: false, conflict: true, ts: cur };
  const dSheet = sh(S_DATA);
  writeChunks(sh(S_PREV), readChunks(dSheet));   // 직전 버전 한 개 보관
  writeChunks(dSheet, b.data);
  writeList(b.rows || []);
  const ts = Date.now();
  PropertiesService.getScriptProperties().setProperty('ts', String(ts));
  return { ok: true, ts: ts, count: (b.rows || []).length };
}

function restore() {
  const str = readChunks(sh(S_DATA));
  if (!str) return { ok: false, error: 'empty' };
  return { ok: true, ts: curTs(), data: str };
}

function writeList(rows) {
  const s = sh(S_LIST);
  s.clear();
  const head = ['예식일', '시간', '고객명', '연락처', '진행상태', '장소', '총금액', '계약금', '잔금', '주소', '납품', '메모'];
  s.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
  if (rows.length) {
    s.getRange(2, 1, rows.length, head.length).setValues(rows.map(r => head.map((_, k) => r[k] == null ? '' : r[k])));
    s.getRange(2, 7, rows.length, 3).setNumberFormat('#,##0');
  }
  s.setFrozenRows(1);
}
