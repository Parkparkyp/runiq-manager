/* 루닉필름 계약서 PDF 만들기 + 강조(**굵게**) 표시 — 고객 계약서 페이지와 앱이 같이 써요.
 * 구글 서버를 쓰지 않고, 보고 계신 기기(폰/PC)에서 직접 PDF 파일을 만들어요.
 * (html2canvas · jsPDF 는 vendor 폴더에 같이 들어 있어요) */
(function (w) {
  'use strict';
  var BASE = '';
  try { var cs = document.currentScript; if (cs && cs.src) BASE = cs.src.replace(/[^\/]*$/, ''); } catch (e) {}
  var loading = {};
  function loadScript(src) {
    if (loading[src]) return loading[src];
    loading[src] = new Promise(function (ok, ng) {
      var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { delete loading[src]; ng(new Error('load ' + src)); };
      document.head.appendChild(s);
    });
    return loading[src];
  }
  function libs() {
    var a = w.html2canvas ? Promise.resolve() : loadScript(BASE + 'vendor/html2canvas.min.js');
    return a.then(function () { return (w.jspdf && w.jspdf.jsPDF) ? 0 : loadScript(BASE + 'vendor/jspdf.umd.min.js'); });
  }

  /* **굵게** 표시 → 굵은 글씨 + 형광펜 (텍스트로만 만들어서 안전해요) */
  var EM = 'font-weight:800;background:#fde68a;color:#0f172a;border-radius:3px;padding:0 2px;-webkit-box-decoration-break:clone;box-decoration-break:clone';
  function fmt(parent, text, cls) {
    text = String(text == null ? '' : text);
    var re = /\*\*([^*\n]+?)\*\*/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      var b = document.createElement('b'); b.className = cls || 'em'; if (!cls) b.style.cssText = EM; b.textContent = m[1]; parent.appendChild(b);
      last = re.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
    return parent;
  }
  function plain(text) { return String(text == null ? '' : text).replace(/\*\*([^*\n]+?)\*\*/g, '$1'); }

  function el(tag, css, txt) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; }

  /* doc: {brand, name, signedAt, rows:[[키,값]], sections:[{title,text,check}], privacy, signature, foot} */
  function buildUnits(doc) {
    var u = [];
    var head = el('div', 'padding:8px 0 12px;border-bottom:2px solid #0f172a;margin-bottom:6px');
    head.appendChild(el('div', 'font-size:12px;font-weight:800;color:#b45309;letter-spacing:.5px', doc.brand || ''));
    head.appendChild(el('div', 'font-size:26px;font-weight:800;line-height:1.3', '촬영 계약서'));
    head.appendChild(el('div', 'font-size:13px;color:#64748b;margin-top:2px', (doc.name || '') + '님 · 서명 ' + (doc.signedAt || '')));
    u.push(head);
    (doc.rows || []).forEach(function (r) {
      var d = el('div', 'display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #e2e8f0;font-size:14px;line-height:1.6');
      d.appendChild(el('div', 'width:150px;flex:none;color:#64748b', r[0]));
      d.appendChild(el('div', 'flex:1;font-weight:800;word-break:keep-all;overflow-wrap:anywhere', r[1]));
      u.push(d);
    });
    function ttl(t) { var d = el('div', 'padding:20px 0 6px;font-size:16px;font-weight:800;color:#0f172a', t); d.setAttribute('data-ttl', '1'); u.push(d); }
    function lines(text, sz) {
      String(text || '').split('\n').forEach(function (ln) {
        if (!ln.trim()) { u.push(el('div', 'height:9px')); return; }
        var d = el('div', 'font-size:' + (sz || 13.5) + 'px;line-height:1.75;padding:1px 0;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere;color:#1e293b');
        fmt(d, ln); u.push(d);
      });
    }
    (doc.sections || []).forEach(function (s) {
      ttl(s.title); lines(s.text);
      if (s.check) u.push(el('div', 'font-size:13px;font-weight:800;padding:7px 0 4px;color:#166534', '☑ ' + s.check + ' — 동의함'));
    });
    if (doc.privacy) { ttl('개인정보 수집·이용 동의 (동의함)'); lines(doc.privacy, 13); }
    ttl('서명');
    var sg = el('div', 'padding:4px 0 8px');
    if (doc.signature) { var im = el('img', 'width:280px;max-width:100%;border:1px solid #cbd5e1;border-radius:8px;background:#fff;display:block'); im.src = doc.signature; sg.appendChild(im); }
    sg.appendChild(el('div', 'font-size:12.5px;color:#64748b;margin-top:6px', (doc.name || '') + ' · ' + (doc.signedAt || '')));
    u.push(sg);
    if (doc.foot) u.push(el('div', 'font-size:11.5px;color:#94a3b8;padding-top:14px;line-height:1.6', doc.foot));
    return u;
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* 계약서 PDF(Blob) 만들기 */
  function make(doc, opt) {
    opt = opt || {};
    var prog = opt.onProgress || function () {};
    var W = 760, H = 1088, SCALE = opt.scale || 1.6, root = null;
    return libs().then(function () {
      root = el('div', 'position:absolute;left:-12000px;top:0;width:' + W + 'px;background:#fff;color:#0f172a;font:15px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif');
      document.body.appendChild(root);
      var meas = el('div', 'width:' + W + 'px;padding:0 30px;box-sizing:border-box;background:#fff');
      root.appendChild(meas);
      var units = buildUnits(doc);
      units.forEach(function (x) { meas.appendChild(x); });
      var imgs = Array.prototype.slice.call(meas.querySelectorAll('img'));
      var ready = Promise.all(imgs.map(function (i) { return i.complete ? 0 : new Promise(function (r) { i.onload = i.onerror = r; }); }));
      var fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
      return Promise.all([ready, fonts]).then(function () { return wait(30); }).then(function () {
        var hs = units.map(function (x) { return x.getBoundingClientRect().height; });
        var pages = [], cur = [], h = 0;
        units.forEach(function (x, k) {
          var need = hs[k];
          if (x.getAttribute('data-ttl') && units[k + 1]) need += hs[k + 1];
          if (cur.length && h + need > H) { pages.push(cur); cur = []; h = 0; }
          cur.push(x); h += hs[k];
        });
        if (cur.length) pages.push(cur);
        var pageEls = pages.map(function (p) {
          var d = el('div', 'width:' + W + 'px;padding:0 30px;box-sizing:border-box;background:#fff;margin-bottom:8px');
          p.forEach(function (x) { d.appendChild(x); });
          root.appendChild(d); return d;
        });
        root.removeChild(meas);
        var pdf = new w.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'p', compress: true });
        var chain = Promise.resolve();
        pageEls.forEach(function (pe, n) {
          chain = chain.then(function () {
            prog(n, pageEls.length);
            return w.html2canvas(pe, { scale: SCALE, backgroundColor: '#ffffff', logging: false, useCORS: true, windowWidth: W });
          }).then(function (cv) {
            var hh = cv.height * 190 / cv.width;
            if (n > 0) pdf.addPage();
            pdf.addImage(cv.toDataURL('image/jpeg', 0.84), 'JPEG', 10, 10, 190, hh, undefined, 'FAST');
            pdf.setFontSize(8); pdf.setTextColor(150);
            pdf.text((n + 1) + ' / ' + pageEls.length, 105, 292, { align: 'center' });
            cv.width = cv.height = 0;
            return wait(10);
          });
        });
        return chain.then(function () { prog(pageEls.length, pageEls.length); return pdf.output('blob'); });
      });
    }).then(function (b) { if (root && root.parentNode) root.parentNode.removeChild(root); return b; },
            function (e) { if (root && root.parentNode) root.parentNode.removeChild(root); throw e; });
  }

  function save(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { try { document.body.removeChild(a); } catch (e) {} URL.revokeObjectURL(url); }, 60000);
  }
  function canShare(blob, name) {
    try { var f = new File([blob], name, { type: 'application/pdf' }); return !!(navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { return false; }
  }
  function share(blob, name, title) {
    var f = new File([blob], name, { type: 'application/pdf' });
    return navigator.share({ files: [f], title: title || name });
  }

  /* 계약 문구 나누기 / 금액 계산 / PDF용 문서 데이터 (앱의 서명본 PDF 만들기에서 써요) */
  function parseSecs(b) {
    b = String(b || ''); var parts = b.split(/\n={3,}[ \t]*\n/);
    if (parts.length < 2) return [{ title: '계약 내용', text: b.trim(), label: '', port: false }];
    return parts.map(function (s) {
      s = s.trim(); var nl = s.indexOf('\n'); var title = nl < 0 ? s : s.slice(0, nl).trim(); var text = nl < 0 ? '' : s.slice(nl + 1).trim();
      var label = ''; var m = text.match(/(^|\n)☑ ([^\n]+)\s*$/); if (m) { label = m[2].trim(); text = text.slice(0, m.index).trim(); }
      var port = text.indexOf('[[포트폴리오선택]]') >= 0; if (port) text = text.split('[[포트폴리오선택]]').join('').trim();
      return { title: title, text: text, label: label, port: port };
    });
  }
  function amounts(D, port) {
    var base = (Number(D.total) || 0) + (Number(D.portApplied) || 0), dep = Number(D.deposit) || 0, pd = Number(D.portDiscount) || 0;
    var tot = (port === '동의') ? Math.max(0, base - pd) : base;
    return { base: base, dep: dep, pd: pd, tot: tot, bal: Math.max(0, tot - dep) };
  }
  function won(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원'; }
  function sellerRows(sl) { sl = sl || {}; if (!(sl.name || sl.rep || sl.biz || sl.addr || sl.tel)) return []; return [['판매자(상호)', [sl.name, sl.rep ? '(대표 ' + sl.rep + ')' : ''].filter(Boolean).join(' ')], ['사업자등록번호', sl.biz || '-'], ['사업장 주소', sl.addr || '-'], ['판매자 연락처', sl.tel || '-']]; }
  function docOf(D, r, brand) {
    var A = amounts(D, r.portfolio), secs = parseSecs(D.body);
    return { brand: brand, name: r.name, signedAt: r.signedAt,
      rows: sellerRows(D.seller).concat([['촬영 일시', D.date + ' ' + D.time], ['장소', D.venue], ['상품', D.category || '-'], ['총 금액', won(A.tot)], ['계약금', won(A.dep)], ['잔금', won(A.bal)], ['서명자', r.name], ['연락처', r.phone], ['포트폴리오 활용', r.portfolio === '동의' ? '동의함' : '동의하지 않음'], ['촬영 일시·장소·상품 확인', '확인함']]),
      sections: secs.map(function (s) { return { title: s.title, text: s.text, check: s.port ? '' : (s.label || '위 내용을 확인하고 동의합니다.') }; }),
      privacy: D.privacy, signature: r.signature,
      foot: '이 문서는 전자서명으로 체결된 계약서 사본입니다. 서명 시각 ' + r.signedAt + '.' };
  }
  function inApp() { return /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|; wv\)|DaumApps|Line\//i.test(navigator.userAgent || ''); }

  w.RQ = { sellerRows: sellerRows, parseSecs: parseSecs, amounts: amounts, docOf: docOf, fmt: fmt, plain: plain, make: make, save: save, share: share, canShare: canShare, inApp: inApp, libs: libs };
})(window);
