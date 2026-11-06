/* ============================================================
   Importar movimientos de Mercado Pago (resumen de cuenta en PDF).
   Todo se lee en el celular/compu: el archivo no se sube a ningún lado.
   parseLines recibe líneas [{y, text}] de arriba hacia abajo y devuelve
   [{id, date:"AAAA-MM-DD", desc, amount}] (amount negativo = salida).
   ============================================================ */
(function (root) {
  const ROW = /^(\d{2})-(\d{2})-(\d{4})\s+(.*?)\s*(\d{9,})\s+\$\s*(-?[\d.]*\d,\d{2})\s+\$\s*-?[\d.]*\d,\d{2}\s*$/;
  const toNum = (s) => Number(s.replace(/\./g, "").replace(",", "."));

  function parseLines(lines, gap) {
    gap = gap || 14;
    const rows = [], others = [];
    for (const l of lines) {
      const t = (l.text || "").replace(/\s+/g, " ").trim();
      if (/RESUMEN DE TENENCIAS/i.test(t)) break;            // la parte en dólares no se importa
      const m = ROW.exec((l.text || "").replace(/[ \t]+/g, " ").trim());
      if (m) rows.push({ y: l.y, date: m[3] + "-" + m[2] + "-" + m[1], id: m[5], amount: toNum(m[6]), parts: [{ y: l.y, t: m[4].trim() }] });
      else if (t && !/^\d{2}-\d{2}-\d{4}/.test(t) && !/^(ID de la|Fecha|operaci[oó]n|Valor|Saldo|DETALLE|Descripci)/i.test(t)) others.push({ y: l.y, t });
    }
    if (!rows.length) return [];
    for (const o of others) {
      let best = null, bd = Infinity;
      for (const r of rows) { const d = Math.abs(r.y - o.y); if (d < bd) { bd = d; best = r; } }
      if (best && bd <= gap && !/^(Fecha de generaci|Mercado Libre|de consulta|consulta en|Estas operaciones|ante la|en la operaci|Entradas|Salidas|Saldo|Periodo|CVU|Comitente|RESUMEN|P[aá]gina)/i.test(o.t)) best.parts.push(o);
    }
    return rows.map((r) => ({
      id: r.id, date: r.date, amount: r.amount,
      desc: r.parts.sort((a, b) => a.y - b.y).map((p) => p.t).filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
    }));
  }

  /* PDF → líneas, con pdf.js (se carga recién al importar) */
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  const WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  function loadScript(src) {
    return new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("No se pudo cargar el lector de PDF")); document.head.appendChild(s); });
  }
  async function pdfLines(file) {
    if (!root.pdfjsLib) await loadScript(PDFJS);
    const lib = root.pdfjsLib;
    if (!lib.GlobalWorkerOptions.workerSrc) {
      try { const b = await (await fetch(WORKER)).blob(); lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(b); }
      catch (e) { lib.GlobalWorkerOptions.workerSrc = WORKER; }
    }
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const out = []; let off = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p), tc = await page.getTextContent(), H = page.view[3];
      const items = tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ x: i.transform[4], y: H - i.transform[5], s: i.str }));
      items.sort((a, b) => a.y - b.y || a.x - b.x);
      const lines = [];
      for (const it of items) {
        const l = lines[lines.length - 1];
        if (l && Math.abs(l.y - it.y) < 3) l.items.push(it); else lines.push({ y: it.y, items: [it] });
      }
      for (const l of lines) out.push({ y: off + l.y, text: l.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(" ") });
      off += H + 100;
    }
    return out;
  }
  async function readPDF(file) { return parseLines(await pdfLines(file), 16); }

  root.MPImport = { parseLines, readPDF };
  if (typeof module !== "undefined") module.exports = root.MPImport;
})(typeof window !== "undefined" ? window : globalThis);
