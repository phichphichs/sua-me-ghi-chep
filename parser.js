/* Bộ phân tích câu nói tiếng Việt -> các cữ sữa.
 * "hút 120ml lúc 7 giờ sáng, bé uống 60 ml" -> [{type:'pump',ml:120,...},{type:'feed',ml:60,...}]
 * Chạy được cả trong trình duyệt (window.MilkParser) lẫn Node (để test).
 */
(function (root) {
  'use strict';

  const NUM = { 'không': 0, 'một': 1, 'mốt': 1, 'hai': 2, 'ba': 3, 'bốn': 4, 'tư': 4, 'năm': 5, 'lăm': 5, 'sáu': 6, 'bảy': 7, 'bẩy': 7, 'tám': 8, 'chín': 9 };
  const MAG = new Set(['mười', 'mươi', 'trăm', 'linh', 'lẻ']);
  const UNIT_AFTER = /^(ml|mi|mili|em|cc|xi|giờ|h|tiếng|phút|oz|lít)$/;

  function evalRun(run) {
    let h = 0, t = 0, u = 0, seenTens = false, seenLinh = false;
    for (const w of run) {
      if (w in NUM) u = NUM[w];
      else if (w === 'trăm') { h = u || 1; u = 0; }
      else if (w === 'mười') { t = 1; u = 0; seenTens = true; }
      else if (w === 'mươi') { t = u || 1; u = 0; seenTens = true; }
      else if (w === 'linh' || w === 'lẻ') seenLinh = true;
      else if (w === 'rưỡi') { t = 5; seenTens = true; }
    }
    if (h > 0 && !seenTens && !seenLinh && u > 0 && u < 10) u *= 10; // "một trăm hai" = 120
    return h * 100 + t * 10 + u;
  }

  // "một trăm hai mươi" -> "120" (chỉ khi chắc chắn là số lượng/giờ)
  function wordsToDigits(text) {
    const words = text.split(/\s+/).filter(Boolean);
    const out = [];
    let i = 0;
    while (i < words.length) {
      const w = words[i];
      if (w in NUM || MAG.has(w)) {
        const run = [];
        let j = i;
        while (j < words.length) {
          const x = words[j];
          if (x in NUM || MAG.has(x) || (x === 'rưỡi' && run[run.length - 1] === 'trăm')) { run.push(x); j++; } else break;
        }
        const hasMag = run.some((x) => MAG.has(x));
        const next = words[j] || '';
        if (hasMag || UNIT_AFTER.test(next)) out.push(String(evalRun(run)));
        else out.push(...run);
        i = j;
      } else { out.push(w); i++; }
    }
    return out.join(' ');
  }

  function normalize(text) {
    let s = String(text || '').normalize('NFC').toLowerCase();
    s = s.replace(/(?<!\d)([,;.!?])|([,;.!?])(?!\d)/g, ' $& ');
    s = s.replace(/(\d)(ml|cc|oz|h|g)(?![\p{L}])/gu, '$1 $2');
    s = s.replace(/trực\s+tiếp/g, 'trựctiếp'); // tránh bị cắt ở chữ "tiếp"
    return s.replace(/\s+/g, ' ').trim();
  }

  const DELIM = /\s*(?:(?<!\d)[,;.!?\n]|[,;.!?\n](?!\d)|(?<![\p{L}])(?:rồi|và|sau đó|xong|tiếp theo|tiếp|với)(?![\p{L}]))\s*/u;
  const PUMP_RE = /(?<![\p{L}])(?:hút|út|vắt|bơm|pump)(?![\p{L}])/gu;
  const FEED_RE = /(?<![\p{L}])(?:bú|uống|bé|con|ăn|bình)(?![\p{L}])/gu;

  function keywords(clause) {
    const kws = [];
    for (const m of clause.matchAll(PUMP_RE)) kws.push({ type: 'pump', index: m.index });
    for (const m of clause.matchAll(FEED_RE)) kws.push({ type: 'feed', index: m.index });
    return kws.sort((a, b) => a.index - b.index);
  }

  function splitByType(clause) {
    const kws = keywords(clause);
    if (!kws.length) return [{ text: clause, type: null }];
    const segs = [];
    let start = 0, cur = kws[0].type;
    for (const k of kws) {
      if (k.type !== cur && /\d/.test(clause.slice(start, k.index))) {
        segs.push({ text: clause.slice(start, k.index), type: cur });
        start = k.index; cur = k.type;
      } else if (k.type !== cur) {
        cur = k.type; // chưa có số thì đổi loại, giữ nguyên đoạn
      }
    }
    segs.push({ text: clause.slice(start), type: cur });
    return segs;
  }

  function parseTime(seg, base) {
    let m = /(\d+)\s*(phút|tiếng|giờ)\s*trước/u.exec(seg);
    if (m) {
      const n = +m[1], mult = m[2] === 'phút' ? 60000 : 3600000;
      return { ts: base.getTime() - n * mult, rest: seg.replace(m[0], ' ') };
    }
    let m2 = /(?<![\d.])(\d{1,2})\.(\d{2})(?!\d)(?!\s*(?:ml|mil|mi\b|mili|cc|em\b|xi|oz))/u.exec(seg);
    const re = /(\d{1,2})\s*(?:giờ|gio|h(?![\p{L}])|g(?![\p{L}])|:)\s*(?:(\d{1,2})(?!\d)(?!\s*(?:ml|mil|mi\b|mili|cc|em\b|xi|oz)))?\s*(?:phút)?\s*(rưỡi)?/u;
    m = m2 && +m2[2] <= 59 && +m2[1] <= 24 ? [m2[0], m2[1], m2[2], undefined] : re.exec(seg);
    if (!m) { // "lúc 8" / "vào 8" không kèm chữ giờ
      const b = /(?:lúc|vào|khoảng)\s*(\d{1,2})(?![\d.:,])(?!\s*(?:ml|mil|mi\b|mili|cc|em\b|xi|oz|phút|tiếng))/u.exec(seg);
      if (b) m = [b[0], b[1], undefined, undefined];
    }
    if (!m) return null;
    let h = +m[1];
    let min = m[2] !== undefined ? +m[2] : (m[3] ? 30 : 0);
    if (h > 24 || min > 59) return null;
    const zero = m[1].length === 2 && m[1][0] === '0'; // "08.00" = 8 giờ sáng (kiểu 24h)
    const period = (/(?<![\p{L}])(sáng|trưa|chiều|tối|đêm)(?![\p{L}])/u.exec(seg) || [])[1];
    let dayOff = 0;
    if (/hôm qua/.test(seg)) dayOff = -1; else if (/hôm kia/.test(seg)) dayOff = -2;
    const mk = (hh, off) => { const d = new Date(base); d.setDate(d.getDate() + off); d.setHours(hh % 24, min, 0, 0); return d; };
    let d;
    if (period) {
      if (period === 'chiều' || period === 'tối') { if (h < 12) h += 12; }
      else if (period === 'trưa') { if (h < 10) h += 12; }
      else if (period === 'đêm') { if (h >= 6 && h < 12) h += 12; }
      d = mk(h, dayOff);
    } else if (h > 12 || dayOff !== 0 || zero) {
      d = mk(h, dayOff);
    } else {
      // không nói sáng/chiều: chọn mốc gần nhất không ở tương lai
      const a = mk(h % 12, 0), b = mk((h % 12) + 12, 0);
      const lim = base.getTime() + 10 * 60000;
      const ok = [a, b].filter((x) => x.getTime() <= lim).sort((x, y) => y - x);
      d = ok[0] || mk((h % 12) + 12, -1);
    }
    return { ts: d.getTime(), rest: seg.replace(m[0], ' '), explicit: true };
  }

  function parseAmounts(seg) {
    const out = [];
    const re = /(\d+(?:[.,]\d+)?)\s*(mi\s*li\s*lít|mi\s*li|mili|mil|miu|mi(?![\p{L}])|ml|em\s*eo|xi\s*xi|cc|oz)?/gu;
    let m;
    while ((m = re.exec(seg))) {
      let v = parseFloat(m[1].replace(',', '.'));
      if (m[2] === 'oz') v *= 29.57;
      out.push({ ml: Math.round(v), unit: !!m[2] });
    }
    return out.filter((a) => a.ml >= 1 && a.ml <= 1500);
  }

  function parse(text, base, opts) {
    opts = opts || {};
    base = base ? new Date(base) : new Date();
    const clauses = wordsToDigits(normalize(text)).split(DELIM).map((c) => c && c.trim()).filter(Boolean);
    const entries = [];
    let lastType = null, pendingTs = null, lastExplicit = null, lastExplicitType = null;

    for (const clause of clauses) {
      for (const seg of splitByType(clause)) {
        const direct = /trựctiếp/.test(seg.text);
        const type = direct ? 'feed' : (seg.type || lastType || opts.defaultType || null);
        const sides = [];
        if (/(?<![\p{L}])trái(?![\p{L}])/u.test(seg.text)) sides.push('L');
        if (/(?<![\p{L}])phải(?![\p{L}])/u.test(seg.text)) sides.push('R');
        const t = parseTime(seg.text, base);
        const rest = t ? t.rest : seg.text;
        let amounts = parseAmounts(rest.replace(/\d+\s*(?:phút|tiếng|giờ)(?![\p{L}])/gu, ' '));
        if (!amounts.length && !direct) {
          if (t) pendingTs = t.ts; // "lúc 7 giờ" rồi mới nói lượng ở câu sau
          continue;
        }
        const withUnit = amounts.filter((a) => a.unit);
        if (withUnit.length) amounts = withUnit;
        let ml = 0;
        if (!amounts.length) ml = 0;
        else if (sides.length) ml = amounts.reduce((s, a) => s + a.ml, 0);
        else ml = amounts[0].ml;
        let ts = base.getTime();
        if (t) { ts = t.ts; lastExplicit = ts; lastExplicitType = type; }
        else if (pendingTs !== null) { ts = pendingTs; pendingTs = null; }
        else if (sides.length && lastExplicit !== null && lastExplicitType === type) ts = lastExplicit;
        const entry = { type, ml, ts, side: sides.length === 1 ? sides[0] : null };
        if (direct) entry.direct = true;
        if (type === 'feed') entry.src = /công thức|sữa bột|formula|pha/.test(clause) ? 'formula' : 'breast';
        entries.push(entry);
        lastType = type || lastType;
      }
    }

    // gộp "trái 60 ... phải 50" thành một cữ hút
    const merged = [];
    for (const e of entries) {
      const p = merged[merged.length - 1];
      if (p && e.type === 'pump' && p.type === 'pump' && e.side && p.side && e.side !== p.side && Math.abs(e.ts - p.ts) < 60000) {
        p.ml += e.ml; p.side = null;
      } else merged.push(e);
    }
    merged.forEach((e) => { delete e.side; });
    return { entries: merged, needsType: merged.some((e) => !e.type) };
  }

  const api = { parse, wordsToDigits, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MilkParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
