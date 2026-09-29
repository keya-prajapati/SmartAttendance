/* Parses CSV / XLS / XLSX (sent from the browser as base64) into an array of objects with
   normalised header keys (lower-case, letters+digits only). */
const key = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => String(c).trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => String(c).trim() !== "")) rows.push(row);
  return rows;
}

function parseFile(filename, base64) {
  const buf = Buffer.from(String(base64 || ""), "base64");
  if (!buf.length) throw new Error("The uploaded file is empty.");
  const ext = String(filename || "").toLowerCase().split(".").pop();
  let matrix;
  if (ext === "csv") {
    matrix = parseCsv(buf.toString("utf8"));
  } else if (ext === "xls" || ext === "xlsx") {
    let XLSX;
    try { XLSX = require("xlsx"); } catch { throw new Error("Excel support is not installed on the server. Run: npm install (in /backend) and restart."); }
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  } else {
    throw new Error("Unsupported file type. Please upload a .csv, .xls or .xlsx file.");
  }
  if (matrix.length < 2) throw new Error("The file has no data rows.");
  const headers = matrix[0].map(key);
  return matrix.slice(1)
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
    .map((r, i) => {
      const o = { __row: i + 2 };
      headers.forEach((h, idx) => { if (h) o[h] = r[idx] ?? ""; });
      return o;
    });
}

const pickField = (o, ...names) => {
  for (const n of names) { const v = o[key(n)]; if (v !== undefined && String(v).trim() !== "") return v; }
  return "";
};

/* Accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, Excel serial numbers, Date objects. Returns YYYY-MM-DD or null. */
function parseDate(v) {
  if (v === "" || v == null) return null;
  const p = (n) => String(n).padStart(2, "0");
  const ok = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${p(m)}-${p(d)}` : null;
  };
  if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 86400000)); return ok(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  if (v instanceof Date) return ok(v.getFullYear(), v.getMonth() + 1, v.getDate());
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return ok(+m[3], +m[2], +m[1]);
  return null;
}

/* "10:00", "10:00 AM", "1:05 PM", "10:00:00", Excel fraction -> "HH:MM" or null */
function parseTime(v) {
  if (v === "" || v == null) return null;

  const p = (n) => String(n).padStart(2, "0");

  // Excel time fraction
  if (typeof v === "number") {
    const mins = Math.round((v % 1) * 1440);
    return `${p(Math.floor(mins / 60) % 24)}:${p(mins % 60)}`;
  }

  const s = String(v).trim();

  // HH:MM, HH:MM:SS, 10:00 AM, 1:05 PM
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);

  if (!m) return null;

  let h = Number(m[1]);
  const mi = Number(m[2]);

  if (m[3]) {
    const pm = m[3].toLowerCase() === "pm";

    if (h === 12) {
      h = pm ? 12 : 0;
    } else if (pm) {
      h += 12;
    }
  }

  if (h > 23 || mi > 59) return null;

  return `${p(h)}:${p(mi)}`;
}

/* date + time string -> "YYYY-MM-DD HH:MM:SS" or null (accepts full datetime cell) */
function parseDateTime(v, fallbackDate) {
  if (v === "" || v == null) return null;
  if (typeof v === "number") {
    const d = parseDate(Math.floor(v)); const t = parseTime(v);
    return d && t ? `${d} ${t}:00` : null;
  }
  const s = String(v).trim();
  const m = s.match(/^(.*?)[ T](\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)$/i);
  if (m) { const d = parseDate(m[1]); const t = parseTime(m[2]); return d && t ? `${d} ${t}:00` : null; }
  const t = parseTime(s);
  return t && fallbackDate ? `${fallbackDate} ${t}:00` : null;
}

module.exports = { parseFile, pickField, parseDate, parseTime, parseDateTime, key };
