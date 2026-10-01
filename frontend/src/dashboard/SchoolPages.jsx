import { useCallback, useEffect, useState } from "react";
import { Download, Upload, MessageCircle, Save, CheckCheck, RotateCcw, Trash2, Pencil, CalendarDays, Copy } from "lucide-react";
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

const WEEK_DAYS = [
  { value: 1, label: "Monday" }, { value: 2, label: "Tuesday" }, { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" }, { value: 5, label: "Friday" }, { value: 6, label: "Saturday" },
];
const mostRecentDayDate = (dayOfWeek) => {
  const date = new Date();
  const jsDay = date.getDay();
  const todayDay = jsDay === 0 ? 7 : jsDay;
  date.setDate(date.getDate() - ((todayDay - Number(dayOfWeek) + 7) % 7));
  return date.toLocaleDateString("en-CA");
};

export function TimetableManagementPage() {
  const notify = useNotify();
  const classes = useApi("/classes");
  const sections = useApi("/sections");
  const subjects = useApi("/subjects");
  const teachers = useApi("/admin/teachers");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [targetClassId, setTargetClassId] = useState("");
  const [targetSectionId, setTargetSectionId] = useState("");
  const [teacherMapping, setTeacherMapping] = useState({});
  const [editing, setEditing] = useState(null);
  const schedule = useApi("/timetable/admin", { classId, sectionId });
  const sectionOptions = (sections.data || []).filter((s) => String(s.ClassID) === String(classId)).map((s) => ({ value: s.SectionID, label: s.SectionName }));
  const targetSectionOptions = (sections.data || []).filter((s) => String(s.ClassID) === String(targetClassId)).map((s) => ({ value: s.SectionID, label: s.SectionName }));
  const entries = Array.isArray(schedule.data) ? schedule.data : [];
  const sourceTeachers = [...new Map(entries.map((entry) => [String(entry.TeacherUserID), { id: entry.TeacherUserID, name: entry.TeacherName }])).values()];
  useEffect(() => {
    setTeacherMapping(Object.fromEntries(sourceTeachers.map((teacher) => [String(teacher.id), String(teacher.id)])));
  }, [entries]);
  const refresh = () => schedule.reload();

  const remove = async (entry) => {
    if (!window.confirm(`Delete Period ${entry.Period} on ${WEEK_DAYS[Number(entry.DayOfWeek) - 1]?.label}?`)) return;
    try { notify((await api(`/timetable/admin/entries/${entry.TimetableEntryID}`, { method: "DELETE" })).message); await refresh(); }
    catch (e) { notify(e.message, "error"); }
  };

  const copy = async () => {
    try {
      const result = await api("/timetable/admin/copy", { method: "POST", body: { sourceClassId: classId, sourceSectionId: sectionId, targetClassId, targetSectionId, teacherMapping } });
      notify(result.message); setTargetClassId(""); setTargetSectionId("");
    } catch (e) { notify(e.message, "error"); }
  };

  return (
    <>
      <Panel title="Weekly Timetable" sub="Manage real weekly periods for a class and section">
        <div className="dash-filters">
          <Sel label="Class" value={classId} onChange={(value) => { setClassId(value); setSectionId(""); }} all="Select class" options={(classes.data || []).map((c) => ({ value: c.ClassID, label: c.ClassName }))} />
          <Sel label="Section" value={sectionId} onChange={setSectionId} all="Select section" options={sectionOptions} />
          <RefreshButton onClick={refresh} busy={schedule.loading} />
        </div>
        {schedule.error && classId && sectionId && <Err msg={schedule.error} />}
        {!classId || !sectionId ? <div className="dash-empty">Select a class and section to view its timetable.</div> : schedule.loading ? <div className="dash-empty">Loading timetable…</div> : (
          <div className="dash-table-wrap"><table className="dash-table">
            <thead><tr><th>Period</th>{WEEK_DAYS.map((day) => <th key={day.value}>{day.label}</th>)}</tr></thead>
            <tbody>{Array.from({ length: 12 }, (_, index) => index + 1).map((period) => (
              <tr key={period}><th>{period}</th>{WEEK_DAYS.map((day) => {
                const entry = entries.find((item) => Number(item.DayOfWeek) === day.value && Number(item.Period) === period);
                return <td key={day.value}>{entry ? (
                  <div className="dash-timetable-cell"><strong>{entry.SubjectName}</strong><span>{entry.TeacherName}</span><span>{lectureTime(entry.StartTime, entry.EndTime)}</span>
                    <div className="dash-head-actions"><button className="dash-ghost-btn sm" onClick={() => setEditing({ ...entry, DayOfWeek: day.value, Period: period })}><Pencil size={13} /> Edit</button><button className="dash-ghost-btn sm danger" onClick={() => remove(entry)}><Trash2 size={13} /> Delete</button></div>
                  </div>
                ) : <button className="dash-link" onClick={() => setEditing({ DayOfWeek: day.value, Period: period })}>+ Add entry</button>}</td>;
              })}</tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>

      {classId && sectionId && (
        <Panel title="Copy Timetable" sub="Copy a complete weekly timetable to an empty section; conflicts are rejected without overwriting entries">
          <div className="dash-filters">
            <span className="dash-muted">Source: {classes.data?.find((c) => String(c.ClassID) === String(classId))?.ClassName || "—"} / {sections.data?.find((s) => String(s.SectionID) === String(sectionId))?.SectionName || "—"}</span>
            {sourceTeachers.map((teacher) => <Sel key={teacher.id} label={`Use teacher for ${teacher.name}`} value={teacherMapping[String(teacher.id)] || String(teacher.id)} onChange={(value) => setTeacherMapping((current) => ({ ...current, [String(teacher.id)]: value }))} all="Select teacher" options={(teachers.data || []).map((t) => ({ value: t.UserId, label: t.FullName }))} />)}
            <Sel label="Destination class" value={targetClassId} onChange={(value) => { setTargetClassId(value); setTargetSectionId(""); }} all="Select class" options={(classes.data || []).map((c) => ({ value: c.ClassID, label: c.ClassName }))} />
            <Sel label="Destination section" value={targetSectionId} onChange={setTargetSectionId} all="Select section" options={targetSectionOptions} />
            <button className="dash-primary-btn sm" disabled={!targetClassId || !targetSectionId} onClick={copy}><Copy size={14} /> Copy timetable</button>
          </div>
        </Panel>
      )}
      {editing && <TimetableEntryModal entry={editing} classId={classId} sectionId={sectionId} subjects={subjects.data || []} teachers={teachers.data || []} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); notify(message); await refresh(); }} />}
    </>
  );
}

function TimetableEntryModal({ entry, classId, sectionId, subjects, teachers, onClose, onSaved }) {
  const [form, setForm] = useState({
    teacherUserId: entry.TeacherUserID ?? "", subjectId: entry.SubjectID ?? "",
    startTime: entry.StartTime ? String(entry.StartTime).slice(0, 5) : "", endTime: entry.EndTime ? String(entry.EndTime).slice(0, 5) : "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setBusy(true); setError("");
    const body = { ...form, classId, sectionId, dayOfWeek: entry.DayOfWeek, period: entry.Period };
    try {
      const result = entry.TimetableEntryID
        ? await api(`/timetable/admin/entries/${entry.TimetableEntryID}`, { method: "PUT", body })
        : await api("/timetable/admin/entries", { method: "POST", body });
      await onSaved(result.message);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={`${entry.TimetableEntryID ? "Edit" : "Add"} ${WEEK_DAYS[Number(entry.DayOfWeek) - 1]?.label} Period ${entry.Period}`} onClose={onClose}>
      <div className="dash-form">
        <Sel label="Subject" value={form.subjectId} onChange={update("subjectId")} all="Select subject" options={subjects.map((s) => ({ value: s.SubjectID, label: s.SubjectName }))} />
        <Sel label="Teacher" value={form.teacherUserId} onChange={update("teacherUserId")} all="Select teacher" options={teachers.map((t) => ({ value: t.UserId, label: t.FullName }))} />
        <label className="dash-field"><span>Start time</span><input type="time" value={form.startTime} onChange={(e) => update("startTime")(e.target.value)} required /></label>
        <label className="dash-field"><span>End time</span><input type="time" value={form.endTime} onChange={(e) => update("endTime")(e.target.value)} required /></label>
        {error && <Err msg={error} />}
        <div className="dash-form-actions"><button className="dash-ghost-btn" onClick={onClose}>Cancel</button><button className="dash-primary-btn" disabled={busy || !form.teacherUserId || !form.subjectId || !form.startTime || !form.endTime} onClick={save}>{busy ? "Saving…" : "Save period"}</button></div>
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
export function TeacherTimetablePage({ onTakeAttendance }) {
  const schedule = useApi("/timetable/teacher/me");
  const entries = Array.isArray(schedule.data) ? schedule.data : [];
  return (
    <Panel title="My Timetable" sub={schedule.loading ? "Loading…" : `${entries.length} scheduled period${entries.length === 1 ? "" : "s"}`} right={<RefreshButton onClick={schedule.reload} busy={schedule.loading} />}>
      {schedule.error ? <div className="dash-empty">{schedule.error}</div> : schedule.loading ? <div className="dash-empty">Loading your timetable…</div> : !entries.length ? <div className="dash-empty">No timetable assigned yet.</div> : (
        <div className="dash-stack">{WEEK_DAYS.map((day) => {
          const dayEntries = entries.filter((entry) => Number(entry.DayOfWeek) === day.value);
          return <section key={day.value}><h2 className="dash-day-heading">{day.label}</h2>{!dayEntries.length ? <div className="dash-muted">No periods assigned.</div> : (
            <div className="dash-table-wrap"><table className="dash-table"><thead><tr><th>Period</th><th>Time</th><th>Class</th><th>Section</th><th>Subject</th><th /></tr></thead><tbody>{dayEntries.map((entry) => (
              <tr key={entry.TimetableEntryID}><td>{entry.Period}</td><td>{lectureTime(entry.StartTime, entry.EndTime)}</td><td>{entry.ClassNumber}</td><td>{entry.SectionName}</td><td className="strong">{entry.SubjectName}</td><td><button className="dash-primary-btn sm" onClick={() => onTakeAttendance?.({ ...entry, attendanceDate: mostRecentDayDate(entry.DayOfWeek) })}>Take Attendance</button></td></tr>
            ))}</tbody></table></div>
          )}</section>;
        })}</div>
      )}
    </Panel>
  );
}

export function MyClassesPage({ scheduledEntry = null, onExitSchedule }) {
  const notify = useNotify();
  const mine = useApi("/teacher/my-classes");
  const [sel, setSel] = useState(null);
  const [date, setDate] = useState(scheduledEntry?.attendanceDate || new Date().toLocaleDateString("en-CA"));
  const [roster, setRoster] = useState(null);
  const [choices, setChoices] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wa, setWa] = useState([]);
  const [abs, setAbs] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const today = new Date().toLocaleDateString("en-CA");
  const active = scheduledEntry || sel;
  const isScheduled = Boolean(scheduledEntry);

  const loadRoster = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const path = isScheduled ? `/timetable/teacher/entries/${active.TimetableEntryID}/roster` : `/lecture/${active.AssignmentID}/students`;
      setRoster(await api(path, { query: { date } })); setChoices({});
    }
    catch (e) { notify(e.message, "error"); setRoster(null); }
    finally { setLoading(false); }
  }, [active, isScheduled, date, notify]);
  useEffect(() => { loadRoster(); }, [loadRoster]);

  // saved absentees of this lecture/date (from the existing absent-notifications endpoint)
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    const identity = isScheduled ? { timetableEntryId: active.TimetableEntryID } : { assignmentId: active.AssignmentID };
    api("/attendance/absent-notifications", { query: { ...identity, date } })
      .then((d) => live && setAbs(Array.isArray(d) ? d : [])).catch(() => live && setAbs([]));
    return () => { live = false; };
  }, [active, isScheduled, date, roster]);
  const absById = Object.fromEntries(abs.map((n) => [n.studentId, n]));

  const students = roster?.students || [];
  const eff = (s) => choices[s.StudentID] ?? s.Status ?? null;
  const pending = students.filter((s) => choices[s.StudentID] && choices[s.StudentID] !== s.Status);
  const tot = students.reduce((a, s) => { const v = eff(s); if (v === "Present") a.p++; else if (v === "Absent") a.a++; else a.n++; return a; }, { p: 0, a: 0, n: 0 });

  const save = async () => {
    if (!pending.length) return notify("Nothing to save. Mark at least one student.", "info");
    setSaving(true);
    try {
      const attendanceTarget = isScheduled ? { timetableEntryId: active.TimetableEntryID } : { assignmentId: active.AssignmentID };
      const r = await api("/attendance/mark-bulk", { method: "POST", body: { ...attendanceTarget, date, records: pending.map((s) => ({ studentId: s.StudentID, status: choices[s.StudentID] })) } });
      notify(r.message, r.failed?.length ? "info" : "success");
      r.failed?.forEach((f) => notify(f.reason, "error"));
      setWa(r.notifications || []);
      if ((r.notifications || []).length) setShowAll(true);
      await loadRoster(); mine.reload();
    } catch (e) { notify(e.message, "error"); }
    finally { setSaving(false); }
  };

  const batchNotify = () => {
    const valid = abs.filter((n) => n.validPhone && n.url);
    const invalid = abs.length - valid.length;
    if (!abs.length) {
      notify("There are no absent students to notify for this class and date.", "info");
      return;
    }
    const message = `Open ${valid.length} WhatsApp message${valid.length === 1 ? "" : "s"} for valid parent numbers. ${invalid} invalid or missing phone number${invalid === 1 ? "" : "s"} will be skipped. This is click-to-send only; WhatsApp still requires the teacher to tap Send in the app.`;
    if (!window.confirm(`${message}\n\nContinue?`)) return;
    const urls = valid.map((n) => n.url).filter(Boolean);
    if (!urls.length) {
      notify("No valid parent WhatsApp numbers were found for the absent students.", "error");
      return;
    }
    urls.forEach((url, index) => {
      const win = window.open(url, index === 0 ? "_blank" : `wa-${index}`, "noopener,noreferrer");
      if (!win) notify("Your browser blocked one or more WhatsApp windows. Please allow pop-ups and retry.", "info");
    });
    notify(`Opened ${urls.length} message${urls.length === 1 ? "" : "s"} to valid absent parents. ${invalid} invalid/missing phone number${invalid === 1 ? "" : "s"} were skipped.`, "success");
  };

  if (active) {
    const a = roster?.assignment || active;
    const leave = () => {
      setSel(null); setRoster(null); setWa([]); setAbs([]); setShowAll(false);
      if (isScheduled) onExitSchedule?.();
    };
    return (
      <Panel
        title={`Class ${a.ClassNumber} - ${a.SectionName} · ${a.SubjectName}`}
        sub={`${WEEK_DAYS[Number(a.DayOfWeek) - 1]?.label ? `${WEEK_DAYS[Number(a.DayOfWeek) - 1].label} · ` : ""}Period ${a.Period} · ${lectureTime(a.StartTime, a.EndTime)} · ${students.length} students · ${tot.p} present · ${tot.a} absent · ${tot.n} not marked`}
        right={<button className="dash-ghost-btn" onClick={leave}>{isScheduled ? "← My Timetable" : "← My Classes"}</button>}
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
            <div className="dash-cards" style={{ marginBottom: 12 }}>
              {[['Total Absent', abs.length], ['Valid phone', abs.filter((n) => n.validPhone && n.url).length], ['Invalid / missing phone', abs.filter((n) => !n.validPhone || !n.url).length], ['Mode', 'Click-to-send']].map(([label, value]) => (
                <div key={label} className="dash-card"><span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
            <button className="dash-primary-btn sm" onClick={batchNotify}><MessageCircle size={14} /> Notify All Absent Parents via WhatsApp</button>
            <button className="dash-ghost-btn sm" style={{ marginLeft: 8 }} onClick={() => setShowAll((v) => !v)}>{showAll ? "Hide" : "Show"} notification list</button>
            {showAll && <><p className="dash-muted" style={{ marginTop: 8 }}>This feature uses the existing wa.me link flow. WhatsApp still requires the teacher to tap Send in the app unless a separate WhatsApp API is configured.</p><WhatsAppList items={abs} /></>}
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
              <thead><tr><th>Row</th><th>Roll</th><th>Name</th><th>Class-Section</th><th className="num">Teachers who now see this class</th></tr></thead>
              <tbody>{res.imported_rows.map((r) => <tr key={r.row}><td>{r.row}</td><td>{r.roll}</td><td>{r.name}</td><td>{r.classSection}</td><td className="num">{r.teachersWhoSeeStudent}</td></tr>)}</tbody></table></div>)}
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
  const analytics = useApi("/attendance/analytics", applied);
  const low = useApi("/attendance/low-attendance", { ...applied, threshold: 75 });
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

      <Panel title="Attendance Analytics" sub="Real attendance totals from the SQL Server tables">
        {analytics.loading ? <div className="dash-empty">Loading analytics…</div> : analytics.error ? <div className="dash-empty">{analytics.error}</div> : (
          <>
            <div className="dash-cards">
              {[["Class/Section groups", analytics.data?.classSection?.length ?? 0], ["Date entries", analytics.data?.dateSummary?.length ?? 0], ["Monthly months", analytics.data?.monthlySummary?.length ?? 0], ["Student summaries", analytics.data?.studentSummary?.length ?? 0]].map(([label, value]) => (
                <div key={label} className="dash-card"><span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 16 }}>
              <div className="dash-table-wrap"><table className="dash-table"><thead><tr><th>Class</th><th>Section</th><th>Present</th><th>Absent</th><th>Attendance</th></tr></thead><tbody>{(analytics.data?.classSection || []).slice(0, 8).map((item, idx) => (
                <tr key={`${item.classNumber}-${item.sectionName || idx}`}><td>{item.classNumber ?? "—"}</td><td>{item.sectionName || "—"}</td><td>{item.present}</td><td>{item.absent}</td><td>{item.percentage === null ? "—" : `${item.percentage}%`}</td></tr>
              ))}</tbody></table></div>
              <div className="dash-table-wrap"><table className="dash-table"><thead><tr><th>Month</th><th>Present</th><th>Absent</th><th>Attendance</th></tr></thead><tbody>{(analytics.data?.monthlySummary || []).slice(0, 6).map((item) => (
                <tr key={`${item.year}-${item.month}`}><td>{item.month ? `${item.year}-${String(item.month).padStart(2, "0")}` : "—"}</td><td>{item.present}</td><td>{item.absent}</td><td>{item.percentage === null ? "—" : `${item.percentage}%`}</td></tr>
              ))}</tbody></table></div>
            </div>
          </>
        )}
      </Panel>

      <Panel title="Low Attendance Warning" sub="Students below the configured threshold from actual attendance records">
        {low.loading ? <div className="dash-empty">Loading low-attendance list…</div> : low.error ? <div className="dash-empty">{low.error}</div> : (
          !low.data?.students?.length ? <div className="dash-empty">No students are below the configured attendance threshold.</div> : (
            <div className="dash-table-wrap"><table className="dash-table"><thead><tr><th>Student</th><th>Class</th><th>Section</th><th>Present</th><th>Absent</th><th>Attendance %</th></tr></thead><tbody>{low.data.students.map((student) => (
              <tr key={student.studentId}><td className="strong">{student.name}</td><td>{student.classNumber ?? "—"}</td><td>{student.sectionName || "—"}</td><td>{student.present}</td><td>{student.absent}</td><td className="dash-low">{student.percentage === null ? "—" : `${student.percentage}%`}</td></tr>
            ))}</tbody></table></div>
          )
        )}
      </Panel>

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
