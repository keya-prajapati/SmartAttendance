import { useCallback, useEffect, useState } from "react";
import { Download, Upload, MessageCircle, Save, CheckCheck, RotateCcw, Trash2, Pencil } from "lucide-react";
import { api, API, downloadCSV, dash, fmtDate, Panel, Tabs, Modal, RefreshButton, useNotify } from "./DashboardShared";

/* All data on these pages comes from the Node/Express API (SQL Server). No mock data, no localStorage. */

export const to12 = (t) => {
  if (!t) return "";
  const [h, m] = String(t).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
export const lectureTime = (s, e) => (s && e ? `${to12(s)} - ${to12(e)}` : "—");
const takenTime = (v) => (v ? to12(String(v).slice(11, 16)) : "—");
const dmy = (k) => (k ? String(k).slice(0, 10).split("-").reverse().join("-") : "—");

function useApi(path, query, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const qKey = JSON.stringify(query || {});
  const depKey = JSON.stringify(deps);
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try { setState({ data: await api(path, { query: JSON.parse(qKey) }), loading: false, error: null }); }
    catch (e) { setState({ data: null, loading: false, error: e.message }); }
  }, [path, qKey, depKey]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

function Sel({ label, value, onChange, options, all = "All", required }) {
  return (
    <label className="dash-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} required={required}>
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
const Err = ({ msg }) => (msg ? <div className="dash-form-error" role="alert">{msg}</div> : null);

/* =====================================================================
   ADMIN: Classes / Sections / Subjects
   ===================================================================== */
export function SetupPage() {
  const notify = useNotify();
  const [tab, setTab] = useState("classes");
  const classes = useApi("/classes");
  const sections = useApi("/sections");
  const subjects = useApi("/subjects");
  const [secForm, setSecForm] = useState({ classId: "", sectionName: "" });
  const [subName, setSubName] = useState("");
  const [editSub, setEditSub] = useState(null);
  const [editClass, setEditClass] = useState(null);

  const act = async (fn, after) => {
    try { const r = await fn(); notify(r.message); after?.(); } catch (e) { notify(e.message, "error"); }
  };
  const classOpts = (classes.data || []).map((c) => ({ value: c.ClassID, label: c.ClassName }));

  return (
    <Panel title="Classes, Sections & Subjects" sub="Stored in SQL Server (Classes, Sections, Subjects tables)">
      <Tabs tabs={[{ key: "classes", label: "Classes 1-12" }, { key: "sections", label: "Sections" }, { key: "subjects", label: "Subjects" }]} value={tab} onChange={setTab} />

      {tab === "classes" && (
        <div className="dash-table-wrap"><table className="dash-table">
          <thead><tr><th>#</th><th>Class name</th><th className="num">Sections</th><th /></tr></thead>
          <tbody>{(classes.data || []).map((c) => (
            <tr key={c.ClassID}>
              <td>{c.ClassNumber}</td><td className="strong">{c.ClassName}</td>
              <td className="num">{(sections.data || []).filter((s) => s.ClassID === c.ClassID).map((s) => s.SectionName).join(", ") || "—"}</td>
              <td><button className="dash-ghost-btn sm" onClick={() => setEditClass(c)}><Pencil size={13} /> Rename</button></td>
            </tr>))}
          </tbody></table></div>
      )}

      {tab === "sections" && (
        <>
          <div className="dash-filters">
            <Sel label="Class" value={secForm.classId} onChange={(v) => setSecForm({ ...secForm, classId: v })} options={classOpts} all="Select class" />
            <label className="dash-field"><span>Section (A, B, C…)</span><input value={secForm.sectionName} maxLength={5} onChange={(e) => setSecForm({ ...secForm, sectionName: e.target.value })} /></label>
            <button className="dash-primary-btn sm" onClick={() => act(() => api("/admin/sections", { method: "POST", body: secForm }), () => { setSecForm({ ...secForm, sectionName: "" }); sections.reload(); })}>Add section</button>
          </div>
          <div className="dash-table-wrap"><table className="dash-table">
            <thead><tr><th>Class</th><th>Section</th><th className="num">Students</th><th /></tr></thead>
            <tbody>{(sections.data || []).map((s) => (
              <tr key={s.SectionID}><td>{s.ClassName}</td><td className="strong">{s.SectionName}</td><td className="num">{s.StudentCount}</td>
                <td><button className="dash-ghost-btn sm" onClick={() => window.confirm(`Delete section ${s.ClassNumber}-${s.SectionName}?`) && act(() => api(`/admin/sections/${s.SectionID}`, { method: "DELETE" }), sections.reload)}><Trash2 size={13} /> Delete</button></td></tr>))}
            </tbody></table></div>
        </>
      )}

      {tab === "subjects" && (
        <>
          <div className="dash-filters">
            <label className="dash-field"><span>New subject</span><input value={subName} onChange={(e) => setSubName(e.target.value)} /></label>
            <button className="dash-primary-btn sm" onClick={() => act(() => api("/admin/subjects", { method: "POST", body: { subjectName: subName } }), () => { setSubName(""); subjects.reload(); })}>Add subject</button>
          </div>
          <div className="dash-table-wrap"><table className="dash-table">
            <thead><tr><th>Subject</th><th /></tr></thead>
            <tbody>{(subjects.data || []).map((s) => (
              <tr key={s.SubjectID}><td className="strong">{s.SubjectName}</td>
                <td><div className="dash-head-actions">
                  <button className="dash-ghost-btn sm" onClick={() => setEditSub(s)}><Pencil size={13} /> Edit</button>
                  <button className="dash-ghost-btn sm" onClick={() => window.confirm(`Delete ${s.SubjectName}?`) && act(() => api(`/admin/subjects/${s.SubjectID}`, { method: "DELETE" }), subjects.reload)}><Trash2 size={13} /> Delete</button>
                </div></td></tr>))}
            </tbody></table></div>
        </>
      )}

      {editSub && <NameModal title="Edit subject" value={editSub.SubjectName} onClose={() => setEditSub(null)}
        onSave={(v) => act(() => api(`/admin/subjects/${editSub.SubjectID}`, { method: "PUT", body: { subjectName: v } }), () => { setEditSub(null); subjects.reload(); })} />}
      {editClass && <NameModal title="Rename class" value={editClass.ClassName} onClose={() => setEditClass(null)}
        onSave={(v) => act(() => api(`/admin/classes/${editClass.ClassID}`, { method: "PUT", body: { className: v } }), () => { setEditClass(null); classes.reload(); })} />}
    </Panel>
  );
}

function NameModal({ title, value, onSave, onClose }) {
  const [v, setV] = useState(value);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="dash-form">
        <label className="dash-field"><span>Name</span><input value={v} onChange={(e) => setV(e.target.value)} autoFocus /></label>
        <div className="dash-form-actions"><button className="dash-ghost-btn" onClick={onClose}>Cancel</button><button className="dash-primary-btn" onClick={() => onSave(v)}>Save</button></div>
      </div>
    </Modal>
  );
}

/* =====================================================================
   ADMIN: Teacher assignments (Teacher + Class + Section + Subject + Period + times)
   ===================================================================== */
export function AssignmentsPage() {
  const notify = useNotify();
  const teachers = useApi("/admin/teachers");
  const classes = useApi("/classes");
  const sections = useApi("/sections");
  const subjects = useApi("/subjects");
  const list = useApi("/admin/assignments");
  const blank = { teacherUserId: "", classId: "", sectionId: "", subjectId: "", period: "", startTime: "", endTime: "" };
  const [f, setF] = useState(blank);
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState("");
  const set = (k) => (v) => setF((o) => ({ ...o, [k]: v, ...(k === "classId" ? { sectionId: "" } : {}) }));
  const secOpts = (sections.data || []).filter((s) => String(s.ClassID) === String(f.classId)).map((s) => ({ value: s.SectionID, label: s.SectionName }));

  const save = async () => {
    setErr("");
    try {
      const r = editId ? await api(`/admin/assignments/${editId}`, { method: "PUT", body: f }) : await api("/admin/assignments", { method: "POST", body: f });
      notify(r.message); setF(blank); setEditId(null); list.reload();
    } catch (e) { setErr(e.message); }
  };
  const edit = (a) => { setEditId(a.AssignmentID); setF({ teacherUserId: a.TeacherUserID, classId: a.ClassID, sectionId: a.SectionID, subjectId: a.SubjectID, period: a.Period, startTime: a.StartTime, endTime: a.EndTime }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const del = async (a) => {
    if (!window.confirm(`Delete ${a.TeacherName}'s assignment for Class ${a.ClassNumber}-${a.SectionName} Period ${a.Period}?`)) return;
    try { notify((await api(`/admin/assignments/${a.AssignmentID}`, { method: "DELETE" })).message); list.reload(); } catch (e) { notify(e.message, "error"); }
  };

  return (
    <>
      <Panel title={editId ? "Edit Assignment" : "Assign Teacher"} sub="Teacher + Class + Section + Subject + Period + timing (saved to SQL Server)">
        <div className="dash-filters">
          <Sel label="Teacher" value={f.teacherUserId} onChange={set("teacherUserId")} all="Select" options={(teachers.data || []).map((t) => ({ value: t.UserId, label: t.FullName }))} />
          <Sel label="Class" value={f.classId} onChange={set("classId")} all="Select" options={(classes.data || []).map((c) => ({ value: c.ClassID, label: c.ClassName }))} />
          <Sel label="Section" value={f.sectionId} onChange={set("sectionId")} all="Select" options={secOpts} />
          <Sel label="Subject" value={f.subjectId} onChange={set("subjectId")} all="Select" options={(subjects.data || []).map((s) => ({ value: s.SubjectID, label: s.SubjectName }))} />
          <label className="dash-field"><span>Period (1-12)</span><input type="number" min="1" max="12" value={f.period} onChange={(e) => set("period")(e.target.value)} /></label>
          <label className="dash-field"><span>Start time</span><input type="time" value={f.startTime} onChange={(e) => set("startTime")(e.target.value)} /></label>
          <label className="dash-field"><span>End time</span><input type="time" value={f.endTime} onChange={(e) => set("endTime")(e.target.value)} /></label>
          <button className="dash-primary-btn sm" onClick={save}>{editId ? "Update" : "Assign"}</button>
          {editId && <button className="dash-ghost-btn" onClick={() => { setEditId(null); setF(blank); setErr(""); }}>Cancel</button>}
        </div>
        <Err msg={err} />
      </Panel>

      <Panel title="All Assignments" sub={list.loading ? "Loading…" : `${(list.data || []).length} assignment(s)`} right={<RefreshButton onClick={list.reload} busy={list.loading} />}>
        {!(list.data || []).length ? <div className="dash-empty">{list.error || "No teacher assignments yet."}</div> : (
          <div className="dash-table-wrap"><table className="dash-table">
            <thead><tr><th>Teacher</th><th>Class</th><th>Section</th><th>Subject</th><th>Period</th><th>Time</th><th className="num">Students</th><th /></tr></thead>
            <tbody>{list.data.map((a) => (
              <tr key={a.AssignmentID}>
                <td className="strong">{a.TeacherName}</td><td>{a.ClassNumber}</td><td>{a.SectionName}</td><td>{a.SubjectName}</td>
                <td>{a.Period}</td><td>{lectureTime(a.StartTime, a.EndTime)}</td><td className="num">{a.StudentCount}</td>
                <td><div className="dash-head-actions">
                  <button className="dash-ghost-btn sm" onClick={() => edit(a)}><Pencil size={13} /></button>
                  <button className="dash-ghost-btn sm" onClick={() => del(a)}><Trash2 size={13} /></button>
                </div></td>
              </tr>))}
            </tbody></table></div>
        )}
      </Panel>
    </>
  );
}

/* =====================================================================
   TEACHER: My Classes -> students -> mark attendance -> WhatsApp
   ===================================================================== */
export function MyClassesPage() {
  const notify = useNotify();
  const mine = useApi("/teacher/my-classes");
  const [sel, setSel] = useState(null);
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [roster, setRoster] = useState(null);
  const [choices, setChoices] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wa, setWa] = useState([]);
  const [abs, setAbs] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const today = new Date().toLocaleDateString("en-CA");

  const loadRoster = useCallback(async () => {
    if (!sel) return;
    setLoading(true);
    try { setRoster(await api(`/lecture/${sel.AssignmentID}/students`, { query: { date } })); setChoices({}); }
    catch (e) { notify(e.message, "error"); setRoster(null); }
    finally { setLoading(false); }
  }, [sel, date, notify]);
  useEffect(() => { loadRoster(); }, [loadRoster]);

  // saved absentees of this lecture/date (from the existing absent-notifications endpoint)
  useEffect(() => {
    if (!sel) return undefined;
    let live = true;
    api("/attendance/absent-notifications", { query: { assignmentId: sel.AssignmentID, date } })
      .then((d) => live && setAbs(Array.isArray(d) ? d : [])).catch(() => live && setAbs([]));
    return () => { live = false; };
  }, [sel, date, roster]);
  const absById = Object.fromEntries(abs.map((n) => [n.studentId, n]));

  const students = roster?.students || [];
  const eff = (s) => choices[s.StudentID] ?? s.Status ?? null;
  const pending = students.filter((s) => choices[s.StudentID] && choices[s.StudentID] !== s.Status);
  const tot = students.reduce((a, s) => { const v = eff(s); if (v === "Present") a.p++; else if (v === "Absent") a.a++; else a.n++; return a; }, { p: 0, a: 0, n: 0 });

  const save = async () => {
    if (!pending.length) return notify("Nothing to save. Mark at least one student.", "info");
    setSaving(true);
    try {
      const r = await api("/attendance/mark-bulk", { method: "POST", body: { assignmentId: sel.AssignmentID, date, records: pending.map((s) => ({ studentId: s.StudentID, status: choices[s.StudentID] })) } });
      notify(r.message, r.failed?.length ? "info" : "success");
      r.failed?.forEach((f) => notify(f.reason, "error"));
      setWa(r.notifications || []);
      if ((r.notifications || []).length) setShowAll(true);
      await loadRoster(); mine.reload();
    } catch (e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  };

  if (sel) {
    const a = roster?.assignment || sel;
    return (
      <Panel
        title={`Class ${sel.ClassNumber} - ${sel.SectionName} · ${sel.SubjectName}`}
        sub={`Period ${sel.Period} · ${lectureTime(sel.StartTime, sel.EndTime)} · ${students.length} students · ${tot.p} present · ${tot.a} absent · ${tot.n} not marked`}
        right={<button className="dash-ghost-btn" onClick={() => { setSel(null); setRoster(null); setWa([]); setAbs([]); setShowAll(false); }}>← My Classes</button>}
      >
        <div className="dash-filters">
          <label className="dash-field"><span>Date</span><input type="date" max={today} value={date} onChange={(e) => { setDate(e.target.value || today); setWa([]); }} /></label>
          <button className="dash-ghost-btn" onClick={() => setChoices(Object.fromEntries(students.map((s) => [s.StudentID, "Present"])))}><CheckCheck size={14} /> All present</button>
          <button className="dash-ghost-btn" onClick={() => setChoices(Object.fromEntries(students.map((s) => [s.StudentID, "Absent"])))}>All absent</button>
          <button className="dash-ghost-btn" onClick={() => setChoices({})}><RotateCcw size={14} /> Reset</button>
          <button className="dash-primary-btn sm" disabled={saving || !pending.length} onClick={save}><Save size={15} /> {saving ? "Saving…" : `Save attendance${pending.length ? ` (${pending.length})` : ""}`}</button>
        </div>
        <div className="dash-cards">
          {[["Total Students", students.length], ["Present", tot.p], ["Absent", tot.a], ["Attendance", tot.p + tot.a ? `${Math.round((tot.p / (tot.p + tot.a)) * 100)}%` : "—"]].map(([l, v]) => (
            <div key={l} className="dash-card"><span>{l}</span><strong>{v}</strong></div>))}
        </div>
        {loading ? <div className="dash-empty">Loading students…</div> : !students.length ? <div className="dash-empty">No students are enrolled in Class {a.ClassNumber}-{a.SectionName} yet.</div> : (
          <div className="dash-table-wrap"><table className="dash-table">
            <thead><tr><th>Roll No.</th><th>Name</th><th>Saved status</th><th>Taken at</th><th>Mark</th></tr></thead>
            <tbody>{students.map((s) => (
              <tr key={s.StudentID}>
                <td>{dash(s.RollNumber)}</td><td className="strong">{s.Name}</td>
                <td><span className={`dash-pill ${s.Status ? s.Status.toLowerCase() : "none"}`}>{s.Status || "Not marked"}</span></td>
                <td>{takenTime(s.AttendanceTakenAt)}</td>
                <td><div className="dash-head-actions">
                  <button className={`dash-ghost-btn sm${eff(s) === "Present" ? " active" : ""}`} style={eff(s) === "Present" ? { fontWeight: 700, outline: "2px solid #16a34a" } : undefined} onClick={() => setChoices({ ...choices, [s.StudentID]: "Present" })}>Present</button>
                  <button className={`dash-ghost-btn sm${eff(s) === "Absent" ? " active" : ""}`} style={eff(s) === "Absent" ? { fontWeight: 700, outline: "2px solid #dc2626" } : undefined} onClick={() => setChoices({ ...choices, [s.StudentID]: "Absent" })}>Absent</button>
                  {s.Status === "Absent" && !choices[s.StudentID] && absById[s.StudentID] && <WaButton n={absById[s.StudentID]} label="Send WhatsApp" />}
                </div></td>
              </tr>))}
            </tbody></table></div>
        )}
        {abs.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <button className="dash-primary-btn sm" onClick={() => setShowAll((v) => !v)}><MessageCircle size={14} /> Notify All Absent Parents ({abs.length})</button>
            {showAll && <><p className="dash-muted" style={{ marginTop: 8 }}>Each button opens WhatsApp with a prepared message. Nothing is sent until you press Send in WhatsApp.</p><WhatsAppList items={abs} /></>}
          </div>
        )}
      </Panel>
    );
  }

  const rows = mine.data || [];
  return (
    <Panel id="my-classes" title="My Classes" sub={mine.loading ? "Loading…" : `${rows.length} assigned lecture${rows.length === 1 ? "" : "s"}`} right={<RefreshButton onClick={mine.reload} busy={mine.loading} />}>
      {!rows.length ? <div className="dash-empty">{mine.error || "No classes have been assigned to you yet. Please contact the administrator."}</div> : (
        <div className="dash-classes">{rows.map((a) => (
          <div className="dash-class" key={a.AssignmentID}>
            <div className="dash-class-top"><strong>Class {a.ClassNumber} - {a.SectionName}</strong><span>{a.StudentCount} students</span></div>
            <p><b>{a.SubjectName}</b></p>
            <p>Period {a.Period}</p>
            <p>{lectureTime(a.StartTime, a.EndTime)}</p>
            <p>{Number(a.MarkedToday) ? `${a.MarkedToday} marked today` : "Not marked today"}</p>
            <button className="dash-primary-btn sm" onClick={() => setSel(a)}>Open class & mark attendance</button>
          </div>))}
        </div>
      )}
    </Panel>
  );
}

function WaButton({ n, label = "Send WhatsApp" }) {
  if (!n.url) return <span className="dash-muted" title={n.phone || "No phone"}>Invalid parent phone</span>;
  return <a className="dash-primary-btn sm" href={n.url} target="_blank" rel="noreferrer"><MessageCircle size={14} /> {label}</a>;
}

function WhatsAppList({ items }) {
  if (!items.length) return null;
  return (
    <div className="dash-panel" style={{ marginTop: 8 }}>
      <strong>Absent students - open WhatsApp for each parent</strong>
      <div className="dash-table-wrap"><table className="dash-table"><tbody>
        {items.map((n) => (
          <tr key={n.studentId}><td className="strong">{n.name}</td><td>{n.parentName || "—"}</td><td>{n.phone || "—"}</td>
            <td><WaButton n={n} label="Send on WhatsApp" /></td></tr>))}
      </tbody></table></div>
    </div>
  );
}

/* =====================================================================
   IMPORT (students / attendance) - CSV, XLS, XLSX -> server -> SQL Server
   ===================================================================== */
const TEMPLATES = {
  students: { file: "students-template.csv", head: ["StudentID", "RollNumber", "Name", "Class", "Section", "ParentName", "ParentPhone"], row: ["", "101", "Rahul Sharma", "10", "A", "Suresh Sharma", "9876543210"] },
  attendance: { file: "attendance-template.csv", head: ["StudentID", "RollNumber", "Class", "Section", "Subject", "Teacher", "Period", "Date", "LectureStartTime", "LectureEndTime", "Status", "AttendanceTakenAt"], row: ["", "101", "10", "A", "Mathematics", "rahul.sir", "2", "2026-09-29", "10:00", "10:45", "Present", "2026-09-29 10:12:35"] },
};

const toBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] || "");
  r.onerror = () => rej(new Error("Could not read the file."));
  r.readAsDataURL(file);
});

export function ImportPage({ kind, onDone }) {
  const notify = useNotify();
  const t = TEMPLATES[kind];
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");

  const run = async () => {
    if (!file) return setErr("Choose a .csv, .xls or .xlsx file first.");
    setBusy(true); setErr(""); setRes(null);
    try {
      const r = await api(`/${kind === "students" ? "students" : "attendance"}/import`, { method: "POST", body: { filename: file.name, contentBase64: await toBase64(file) } });
      setRes(r); notify(r.message, r.failed ? "info" : "success"); onDone?.();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Panel title={kind === "students" ? "Import Students" : "Import Attendance"} sub="CSV, XLS or XLSX. Records are validated and saved straight into SQL Server."
      right={<button className="dash-ghost-btn" onClick={() => downloadCSV(t.file, t.head, [t.row])}><Download size={14} /> Download template</button>}>
      <div className="dash-filters">
        <label className="dash-field"><span>File</span><input type="file" accept=".csv,.xls,.xlsx" onChange={(e) => { setFile(e.target.files[0] || null); setRes(null); setErr(""); }} /></label>
        <button className="dash-primary-btn sm" disabled={busy} onClick={run}><Upload size={15} /> {busy ? "Importing…" : "Import"}</button>
      </div>
      <p className="dash-muted">Required columns: {t.head.join(", ")}{kind === "attendance" ? " (StudentID OR RollNumber; times/TakenAt optional)." : " (StudentID optional)."}</p>
      <Err msg={err} />
      {res && (
        <>
          <div className="dash-cards">
            {[["Total records", res.total], ["Imported", res.imported], ["Failed", res.failed], ["Duplicates", res.duplicates]].map(([l, v]) => (
              <div key={l} className="dash-card"><span>{l}</span><strong>{v}</strong></div>))}
          </div>
          <Issues title="Failed records" rows={res.failures} />
          <Issues title="Duplicate records" rows={res.duplicateRows} />
          {kind === "students" && res.imported_rows?.length > 0 && (
            <div className="dash-table-wrap"><table className="dash-table">
              <thead><tr><th>Row</th><th>Roll</th><th>Name</th><th>Class-Section</th><th className="num">Teachers who now see this class</th><th>Username</th><th>Password</th><th>WhatsApp</th></tr></thead>
              <tbody>{res.imported_rows.map((r) => <tr key={r.row}><td>{r.row}</td><td>{r.roll}</td><td>{r.name}</td><td>{r.classSection}</td><td className="num">{r.teachersWhoSeeStudent}</td><td>{r.username || "—"}</td><td>{r.password || "—"}</td><td>{r.whatsappUrl ? <a href={r.whatsappUrl} target="_blank" rel="noopener noreferrer">Send Login Details</a> : "—"}</td></tr>)}</tbody></table></div>)}
          {kind === "attendance" && <WhatsAppList items={res.notifications || []} />}
        </>
      )}
    </Panel>
  );
}

function Issues({ title, rows }) {
  if (!rows?.length) return null;
  return (
    <div className="dash-table-wrap"><h3 style={{ margin: "12px 0 6px" }}>{title} ({rows.length})</h3>
      <table className="dash-table"><thead><tr><th>Row</th><th>Reason</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{r.row}{r.name ? ` · ${r.name}` : ""}</td><td>{r.reason}</td></tr>)}</tbody></table></div>
  );
}

/* =====================================================================
   REPORTS (Admin + Teacher) - real rows and SQL-computed statistics
   ===================================================================== */
export function LectureReportsPage({ isAdmin }) {
  const notify = useNotify();
  const classes = useApi("/classes");
  const sections = useApi("/sections");
  const subjects = useApi("/subjects");
  const teachers = useApi(isAdmin ? "/admin/teachers" : "/subjects");
  const [f, setF] = useState({ date: "", from: "", to: "", classId: "", sectionId: "", subjectId: "", teacherId: "", period: "", q: "", status: "" });
  const [applied, setApplied] = useState(f);
  const rep = useApi("/attendance/report", applied);
  const sum = useApi("/attendance/summary", applied);
  const set = (k) => (v) => setF((o) => ({ ...o, [k]: v, ...(k === "classId" ? { sectionId: "" } : {}) }));
  const rows = rep.data || [];
  const secOpts = (sections.data || []).filter((s) => !f.classId || String(s.ClassID) === String(f.classId)).map((s) => ({ value: s.SectionID, label: `${s.ClassNumber}-${s.SectionName}` }));

  const hist = useApi("/attendance/history", applied);
  const [showHist, setShowHist] = useState(false);
  const exportFile = async (format) => {
    if (!rows.length) return notify("There are no records to export.", "info");
    try {
      const token = localStorage.getItem("token");
      const qs = new URLSearchParams(Object.entries({ ...applied, format }).filter(([, v]) => v !== "" && v != null)).toString();
      const res = await fetch(`${API}/attendance/export?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { let m = `Export failed (${res.status}).`; try { m = (await res.json()).message || m; } catch { /* ignore */ } throw new Error(m); }
      const cd = res.headers.get("Content-Disposition") || "";
      const name = (cd.match(/filename="([^"]+)"/) || [])[1] || `Attendance.${format}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { notify(e.message === "Failed to fetch" ? "Cannot reach the server." : e.message, "error"); }
  };
  const s = sum.data;

  return (
    <Panel title="Attendance Reports" sub={rep.loading ? "Loading…" : `${rows.length} record(s) from SQL Server`}
      right={<div className="dash-head-actions"><RefreshButton onClick={() => { rep.reload(); sum.reload(); }} busy={rep.loading} /><button className="dash-ghost-btn" onClick={() => exportFile("csv")}><Download size={14} /> Export CSV</button><button className="dash-ghost-btn" onClick={() => exportFile("xlsx")}><Download size={14} /> Export Excel</button></div>}>
      <div className="dash-filters">
        <label className="dash-field"><span>Date</span><input type="date" value={f.date} onChange={(e) => set("date")(e.target.value)} /></label>
        <label className="dash-field"><span>From</span><input type="date" value={f.from} onChange={(e) => set("from")(e.target.value)} /></label>
        <label className="dash-field"><span>To</span><input type="date" value={f.to} onChange={(e) => set("to")(e.target.value)} /></label>
        <Sel label="Class" value={f.classId} onChange={set("classId")} options={(classes.data || []).map((c) => ({ value: c.ClassID, label: c.ClassName }))} />
        <Sel label="Section" value={f.sectionId} onChange={set("sectionId")} options={secOpts} />
        <Sel label="Subject" value={f.subjectId} onChange={set("subjectId")} options={(subjects.data || []).map((x) => ({ value: x.SubjectID, label: x.SubjectName }))} />
        {isAdmin && <Sel label="Teacher" value={f.teacherId} onChange={set("teacherId")} options={(teachers.data || []).map((x) => ({ value: x.UserId, label: x.FullName }))} />}
        <label className="dash-field"><span>Period</span><input type="number" min="1" max="12" value={f.period} onChange={(e) => set("period")(e.target.value)} /></label>
        <label className="dash-field"><span>Student / roll</span><input value={f.q} onChange={(e) => set("q")(e.target.value)} /></label>
        <Sel label="Status" value={f.status} onChange={set("status")} options={[{ value: "Present", label: "Present" }, { value: "Absent", label: "Absent" }]} />
        <button className="dash-primary-btn sm" onClick={() => setApplied(f)}>Apply filters</button>
        <button className="dash-ghost-btn" onClick={() => { const b = Object.fromEntries(Object.keys(f).map((k) => [k, ""])); setF(b); setApplied(b); }}><RotateCcw size={14} /> Reset</button>
      </div>

      <div className="dash-cards">
        {[["Total", s?.total ?? "…"], ["Present", s?.present ?? "…"], ["Absent", s?.absent ?? "…"], ["Attendance %", s ? (s.percentage === null ? "—" : `${s.percentage}%`) : "…"]].map(([l, v]) => (
          <div key={l} className="dash-card"><span>{l}</span><strong>{v}</strong></div>))}
      </div>

      {!rows.length ? <div className="dash-empty">{rep.error || "No attendance records match these filters."}</div> : (
        <div className="dash-table-wrap"><table className="dash-table">
          <thead><tr><th>Student</th><th>Roll</th><th>Class</th><th>Sec</th><th>Subject</th><th>Teacher</th><th>Period</th><th>Lecture time</th><th>Date</th><th>Taken at</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.AttendanceID}>
              <td className="strong">{r.Name}</td><td>{dash(r.RollNumber)}</td><td>{dash(r.Class)}</td><td>{dash(r.Section)}</td><td>{dash(r.Subject)}</td>
              <td>{dash(r.TeacherName)}</td><td>{dash(r.Period)}</td><td>{lectureTime(r.LectureStartTime, r.LectureEndTime)}</td>
              <td>{dmy(r.Date)}</td><td>{takenTime(r.AttendanceTakenAt)}</td>
              <td><span className={`dash-pill ${String(r.Status).toLowerCase()}`}>{r.Status}</span></td>
            </tr>))}
          </tbody></table></div>
      )}

      <div style={{ marginTop: 16 }}>
        <button className="dash-ghost-btn" onClick={() => setShowHist((v) => !v)}>{showHist ? "Hide" : "Show"} student attendance history</button>
        {showHist && (!hist.data?.length ? <div className="dash-empty">{hist.error || "No history for the selected filters."}</div> : (
          <div className="dash-table-wrap"><table className="dash-table">
            <thead><tr><th>Roll</th><th>Student</th><th>Total lectures</th><th>Present</th><th>Absent</th><th>Attendance %</th></tr></thead>
            <tbody>{hist.data.map((h) => (
              <tr key={h.studentId}><td>{dash(h.rollNumber)}</td><td className="strong">{h.name}</td><td>{h.total}</td><td>{h.present}</td><td>{h.absent}</td><td>{h.percentage === null ? "—" : `${h.percentage}%`}</td></tr>))}
            </tbody></table></div>))}
      </div>
    </Panel>
  );
}
export { fmtDate };
