/* SubnetPal - read the text out of a .docx file, in the browser, with no library. A .docx is a zip: find word/document.xml, inflate it
   with the built-in DecompressionStream('deflate-raw'), strip the XML. No DOM, no storage, no network. window.DocRead / Node.
   PDF text is read by the vendored PDF.js in app.js; old .doc (pre-2007) is refused with a friendly message. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.DocRead = factory(); }(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MAX_BYTES = 25 * 1024 * 1024, MAX_XML = 20 * 1024 * 1024;
  const OLD_DOC_MSG = 'Old .doc files (before Word 2007) cannot be read here. In Word choose Save As .docx or PDF, then choose that file.';

  // what kind of file: by the first bytes, then the name
  function kind(bytes, name) {
    const b = bytes || [], n = String(name || '').toLowerCase();
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';                               // %PDF
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return /\.docx$/.test(n) ? 'unknown' : 'doc';  // old OLE2 Word
    if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return /\.(odt|xlsx|pptx)$/.test(n) ? 'unknown' : 'docx';
    if (/\.pdf$/.test(n)) return 'pdf';
    if (/\.doc$/.test(n)) return 'doc';
    return 'text';
  }

  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  // minimal zip reader: returns { method, data (compressed bytes) } for one entry name, or null
  function zipEntry(b, wanted) {
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }   // end of central directory
    if (e < 0) return null;
    const count = u16(b, e + 10); let p = u32(b, e + 16);
    for (let k = 0; k < count && p + 46 <= b.length && u32(b, p) === 0x02014b50; k++) {
      const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32), lho = u32(b, p + 42);
      let name = ''; for (let i = 0; i < nlen; i++) name += String.fromCharCode(b[p + 46 + i]);
      if (name === wanted) {
        if (u32(b, lho) !== 0x04034b50) return null;
        const start = lho + 30 + u16(b, lho + 26) + u16(b, lho + 28);
        if (start + csize > b.length) return null;
        return { method, data: b.subarray(start, start + csize) };
      }
      p += 46 + nlen + xlen + clen;
    }
    return null;
  }

  async function inflate(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip Word files. Update the browser, or save the file as PDF.');
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(data); w.close();
    const out = await new Response(ds.readable).arrayBuffer();
    if (out.byteLength > MAX_XML) throw new Error('That Word file is too large to read here. Paste just the relevant parts.');
    return new Uint8Array(out);
  }

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function xmlToText(xml) {
    return String(xml)
      .replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, '\t')
      .replace(/<[^>]*>/g, '')
      .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, g) => {
        if (g[0] === '#') { const c = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; }
        return ENT[g.toLowerCase()];
      })
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // bytes: Uint8Array of a .docx. Returns the plain text (throws Error with a friendly message).
  async function docxText(bytes) {
    const ent = zipEntry(bytes, 'word/document.xml');
    if (!ent) throw new Error('That does not look like a Word .docx file. Paste the text instead.');
    let raw;
    if (ent.method === 0) raw = ent.data; else if (ent.method === 8) raw = await inflate(ent.data);
    else throw new Error('That Word file uses a compression this app cannot read. Save it as PDF or paste the text.');
    const text = xmlToText(new TextDecoder('utf-8').decode(raw));
    if (!text) throw new Error('No text found in that Word file. It may be empty or only images. Paste the text instead.');
    return text;
  }

  return { MAX_BYTES, OLD_DOC_MSG, kind, zipEntry, xmlToText, docxText };
}));
