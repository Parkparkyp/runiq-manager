# 사용법: python patch.py index.html   (원본은 index.html.bak 으로 백업됩니다)
import re, sys, shutil
p = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
shutil.copy(p, p + '.bak')
t = open(p, encoding='utf-8').read()

def rep(old, new, label):
    global t
    if old in t: t = t.replace(old, new, 1); print('OK  ', label)
    else: print('SKIP', label, '(못 찾음)')

def rex(pat, new, label, flags=re.S):
    global t
    t2, n = re.subn(pat, lambda m: new, t, count=1, flags=flags)
    t = t2; print('OK  ' if n else 'SKIP', label)

# 1) 치명적 오류: 함수 밖에 남은 코드 조각(문법 오류)·중복 함수 제거
rex(r"\n\s*document\.getElementById\('form-selected-date'\)\.value = pickerSelectedDate;\n\s*renderPickerCalendar\(\);\n\s*modal\.classList\.remove\('hidden'\);\n\s*\}\n\s*function closeInquiryModal\(\) \{\n[^\n]*\n\s*\}\n", "\n", "closeInquiryModal 잔여 코드 제거")
rex(r"\n    function closePreviewModal\(\) \{.*?\n    \}\n", "\n", "closePreviewModal 중복 제거")
rex(r"\n    function closeSyncModal\(\) \{.*?\n    \}\n", "\n", "closeSyncModal 중복 제거")

# 2) Tailwind / manifest / 아이콘 연결 (원본에는 누락)
rep("  <style>", '''  <script src="https://cdn.tailwindcss.com/3.4.17"></script>
  <link rel="manifest" href="manifest.json" />
  <link rel="icon" href="icons/icon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="icons/icon-192.png" />
  <style>''', "Tailwind·manifest·아이콘 태그")
rex(r"\(function registerPWA\(\) \{.*?\n    \}\)\(\);", """if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
    }""", "PWA 등록 코드 → 서비스워커")
rep("window.addEventListener('DOMContentLoaded', () => {", "window.addEventListener('DOMContentLoaded', () => {\n      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}", "저장소 영구보존 요청")

# 3) 버그 수정
rep(""".replace(/"/g, '&quot;');""", """.replace(/"/g, '&quot;')\n        .replace(/'/g, '&#39;');""", "escapeHTML 작은따옴표")
rep("""confirmAction('${escapeHTML(item.clientName)} 님의 예약문의를 삭제할까요?', () => deleteInquiry('${item.id}'))""", "confirmDeleteInquiry('${item.id}')", "삭제 버튼 안전화")
rep("function deleteInquiry(id) {", """function confirmDeleteInquiry(id) {
      const it = appState.inquiries.find(i => i.id === id);
      if (!it) return;
      confirmAction(`${it.clientName} 님의 예약문의를 삭제할까요?`, () => deleteInquiry(id));
    }

    function deleteInquiry(id) {""", "confirmDeleteInquiry 추가")
rep("target.selectionStart || target.value.length", "target.selectionStart ?? target.value.length", "변수삽입 커서(시작)")
rep("target.selectionEnd || target.value.length", "target.selectionEnd ?? target.value.length", "변수삽입 커서(끝)")
rep("샘플 예약 데이터 3건이", "샘플 예약 데이터 2건이", "샘플 건수 문구")
rep("const categories = ['본식 서브스냅', '본식 DVD', '야외 커플스냅', '가족스냅', '기타'];", "const categories = [...new Set(appState.inquiries.filter(i => i.status !== '취소').map(i => i.category))];", "상품별 분포 동적화")

# 4) 추가 기능: 연락처 자동인식 + 양식에 연락처 + D-day 배지
rep("// Fallback inline date/time scan if user pasted unlabelled text", """let parsedPhone = '';
      for (const line of lines) {
        const pm = line.match(/(?:연락처|전화번호|휴대폰|핸드폰)\\s*[:：]\\s*(.+)/);
        if (pm) parsedPhone = pm[1].trim();
      }
      if (!parsedPhone) {
        const pm = cleaned.match(/01[016789][-.\\s]?\\d{3,4}[-.\\s]?\\d{4}/);
        if (pm) parsedPhone = pm[0];
      }
      // Fallback inline date/time scan if user pasted unlabelled text""", "연락처 파싱")
rep("const detectedSummary = [];", "const detectedSummary = [];\n      if (parsedPhone) { document.getElementById('form-client-phone').value = parsedPhone; detectedSummary.push(parsedPhone); }", "연락처 입력 반영")
rep("5. 결제방식:\n\n작성해서", "5. 결제방식:\n6. 연락처:\n\n작성해서", "고객 양식에 연락처 추가")
rep("${formatKoreanDateWithDay(item.date)} ${formatReadableKoreanTime(item.time)}</span>", "${formatKoreanDateWithDay(item.date)} ${formatReadableKoreanTime(item.time)}${ddayBadge(item)}</span>", "D-day 표시")
rep("function quickChangeInquiryStatus(id, newStatus) {", """function ddayBadge(item) {
      if (item.status === '취소' || !item.date) return '';
      const [y, m, d] = item.date.split('-').map(Number);
      const n = new Date();
      const diff = Math.round((new Date(y, m - 1, d) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 86400000);
      const label = diff === 0 ? 'D-DAY' : diff > 0 ? `D-${diff}` : `D+${-diff}`;
      const cls = diff < 0 ? 'bg-slate-100 text-slate-500' : diff <= 7 ? 'bg-rose-100 text-rose-700' : 'bg-slate-900 text-amber-300';
      return ` <span class="ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-extrabold ${cls}">${label}</span>`;
    }

    function quickChangeInquiryStatus(id, newStatus) {""", "ddayBadge 추가")

open(p, 'w', encoding='utf-8').write(t)
print('\n완료. SKIP 항목이 있으면 알려주세요.')
