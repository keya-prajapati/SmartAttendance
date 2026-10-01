import { useEffect, useMemo, useState } from "react";
import { Download, Pencil, Trash2, UserPlus, Link2, Search, CheckCheck, RotateCcw, Save, MessageCircle, LogOut, Sun, Moon } from "lucide-react";
import {
  api, dash, pick, pctText, fmtDate, classLabel, downloadCSV, statusToday,
  Panel, Pill, RefreshButton, Tabs, Modal, useNotify, summarize, applyTheme, currentTheme, setStoredUser,
} from "./DashboardShared";

/* Pages shared by Admin and Teacher. Every list comes from `data` (useDashboardData -> SQL Server). */

const uniq = (arr) => [...new Set(arr.filter((v) => v !== null && v !== undefined && v !== "").map(String))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const has = (hay, needle) => String(hay ?? "").toLowerCase().includes(needle);

function Select({ label, value, onChange, options, all = "All" }) {
  return (
    <label className="dash-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {options.map((o) => (typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </label>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="dash-search">
      <Search size={16} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

/* =====================================================================
   STUDENTS
   ===================================================================== */
export function StudentsPage({ data, isAdmin, addOpen, setAddOpen }) {
  const notify = useNotify();
  const { students, records, loading, refreshing, reload, todayKey, errors } = data;
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");
  const [sec, setSec] = useState("");
  const [st, setSt] = useState("");
  const [linkFor, setLinkFor] = useState(null);
  const [editFor, setEditFor] = useState(null);
  const delStudent = async (s) => {
    if (!window.confirm(`Delete ${s.name}? (Not possible if the student already has attendance records.)`)) return;
    try {
      notify((await api(`/students/${s.id}`, { method: "DELETE" })).message);
      await reload();
    } catch (e) {
      if (e.code !== "HAS_ATTENDANCE") return notify(e.message, "error");
      notify(e.message, "error");
      if (!window.confirm(`${e.message}\n\nDeactivate this student instead?`)) return;
      try {
        notify((await api(`/students/${s.id}/deactivate`, { method: "PATCH" })).message);
        await reload();
      } catch (deactivateError) {
        notify(deactivateError.message, "error");
      }
    }
  };
  const linkStudent = async (s) => {
    const popup = window.open("about:blank", "_blank");
    if (!popup) return setLinkFor(s);
    popup.opener = null;
    try {
      const res = await api(`/students/${s.id}/link`, { method: "PUT", body: {} });
      if (!res.whatsappUrl) throw new Error("WhatsApp message could not be prepared.");
      notify(res.message, "info");
      if (popup.closed) setLinkFor({ ...s, preparedUrl: res.whatsappUrl });
      else popup.location.href = res.whatsappUrl;
      reload();
    } catch (e) {
      popup.close();
      if (e.code === "NO_STUDENT_LOGIN") setLinkFor({ ...s, forceNeedsLogin: true });
      else notify(e.message, "error");
    }
  };

  const statusOf = useMemo(() => statusToday(records, todayKey), [records, todayKey]);
  const classes = useMemo(() => uniq(students.map((s) => s.cls)), [students]);
  const sections = useMemo(() => uniq(students.map((s) => s.section)), [students]);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return students.filter((s) =>
      (!n || has(s.name, n) || has(s.roll, n) || has(s.parentName, n) || has(s.parentPhone, n)) &&
      (!cls || String(s.cls) === cls) &&
      (!sec || String(s.section) === sec) &&
      (!st || statusOf(s) === st)
    );
  }, [students, q, cls, sec, st, statusOf]);

  const filtered = q || cls || sec || st;
  const clear = () => { setQ(""); setCls(""); setSec(""); setSt(""); };

  const exportCsv = () => {
    if (!rows.length) return notify("There are no students to export.", "info");
    downloadCSV(
      `students-${todayKey}.csv`,
      ["Roll Number", "Name", "Class", "Section", "Parent Name", "Parent Phone", `Status (${todayKey})`],
      rows.map((s) => [s.roll, s.name, s.cls, s.section, s.parentName, s.parentPhone, statusOf(s)])
    );
    notify(`Exported ${rows.length} student${rows.length === 1 ? "" : "s"}.`);
  };

  return (
    <>
      <Panel
        id="students"
        title="Students"
        sub={loading ? "Loading…" : `${rows.length} of ${students.length} student${students.length === 1 ? "" : "s"}`}
        right={
          <div className="dash-head-actions">
            <RefreshButton onClick={reload} busy={refreshing} />
            <button className="dash-ghost-btn" onClick={exportCsv}><Download size={14} /> Export CSV</button>
            {isAdmin && <button className="dash-primary-btn sm" onClick={() => setAddOpen(true)}><UserPlus size={15} /> Add Student</button>}
          </div>
        }
      >
        <div className="dash-filters">
          <SearchBox value={q} onChange={setQ} placeholder="Search name, roll no., parent…" />
          <Select label="Class" value={cls} onChange={setCls} options={classes} />
          <Select label="Section" value={sec} onChange={setSec} options={sections} />
          <Select label="Today" value={st} onChange={setSt} options={[{ value: "present", label: "Present" }, { value: "absent", label: "Absent" }, { value: "none", label: "Not marked" }]} />
          {filtered && <button className="dash-ghost-btn" onClick={clear}><RotateCcw size={14} /> Reset</button>}
        </div>

        {loading ? (
          <div className="dash-empty">Loading students…</div>
        ) : errors.students && !students.length ? (
          <div className="dash-empty">Students could not be loaded: {errors.students}</div>
        ) : !students.length ? (
          <div className="dash-empty">
            No students added yet.
            {isAdmin && <> <button className="dash-link" onClick={() => setAddOpen(true)}>Add the first student</button></>}
          </div>
        ) : !rows.length ? (
          <div className="dash-empty">No students match your filters.</div>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Roll No.</th><th>Name</th><th>Class</th><th>Section</th><th>Parent</th><th>Parent Phone</th><th>Today</th>
                  {isAdmin && <th>Login account</th>}{isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => (
                  <tr key={s.id ?? i}>
                    <td>{dash(s.roll)}</td>
                    <td className="strong">{dash(s.name)}</td>
                    <td>{dash(s.cls)}</td>
                    <td>{dash(s.section)}</td>
                    <td>{dash(s.parentName)}</td>
                    <td>{dash(s.parentPhone)}</td>
                    <td><Pill status={statusOf(s)} /></td>
                    {isAdmin && (
                      <td>
                        {s.linkedUsername ? (
                          <span className="dash-linked">{s.linkedUsername} <button className="dash-link" onClick={() => linkStudent(s)}>Link</button></span>
                        ) : (
                          <button className="dash-ghost-btn sm" onClick={() => linkStudent(s)}><Link2 size={13} /> Link</button>
                        )}
                      </td>
                    )}
                    {isAdmin && (
                      <td><div className="dash-head-actions">
                        <button className="dash-ghost-btn sm" onClick={() => setEditFor(s)}><Pencil size={13} /></button>
                        <button className="dash-ghost-btn sm" onClick={() => delStudent(s)}><Trash2 size={13} /></button>
                      </div></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {addOpen && <AddStudentModal classes={classes} onClose={() => setAddOpen(false)} onDone={reload} />}
      {editFor && <AddStudentModal student={editFor} classes={classes} onClose={() => setEditFor(null)} onDone={reload} />}
      {linkFor && <LinkAccountModal student={linkFor} onClose={() => setLinkFor(null)} onDone={reload} />}
    </>
  );
}

function AddStudentModal({ classes, onClose, onDone, student }) {
  const notify = useNotify();
  const [f, setF] = useState(student ? { rollNumber: student.roll ?? "", name: student.name ?? "", studentClass: String(student.cls ?? ""), section: student.section ?? "", parentName: student.parentName ?? "", parentPhone: student.parentPhone ?? "", createLogin: false, username: "", password: "" } : { rollNumber: "", name: "", studentClass: "", section: "", parentName: "", parentPhone: "", createLogin: false, username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!f.rollNumber.trim() || !f.name.trim() || !f.studentClass.trim() || !f.section.trim() || !f.parentPhone.trim()) {
      return setErr("Roll number, name, class, section and parent phone are required.");
    }
    if (!/^[0-9+\-()\s]{7,20}$/.test(f.parentPhone.trim())) return setErr("Enter a valid parent phone number.");
    if (f.createLogin && (f.username.trim().length < 3 || f.password.length < 6)) {
      return setErr("Login username needs 3+ characters and password 6+ characters.");
    }
    setBusy(true);
    try {
      const res = student ? await api(`/students/${student.id}`, { method: "PUT", body: f }) : await api("/students/add", { method: "POST", body: f });
      notify(res.message, res.loginError ? "info" : "success");
      await onDone();
      onClose();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={student ? "Edit Student" : "Add Student"} onClose={onClose}>
      <form className="dash-form" onSubmit={submit} noValidate>
        <div className="dash-form-grid">
          <label className="dash-field"><span>Roll number *</span><input value={f.rollNumber} onChange={set("rollNumber")} autoFocus /></label>
          <label className="dash-field"><span>Student name *</span><input value={f.name} onChange={set("name")} /></label>
          <label className="dash-field"><span>Class *</span><input value={f.studentClass} onChange={set("studentClass")} list="dash-class-list" /></label>
          <label className="dash-field"><span>Section *</span><input value={f.section} onChange={set("section")} /></label>
          <label className="dash-field"><span>Parent name</span><input value={f.parentName} onChange={set("parentName")} /></label>
          <label className="dash-field"><span>Parent phone *</span><input value={f.parentPhone} onChange={set("parentPhone")} inputMode="tel" /></label>
        </div>
        <datalist id="dash-class-list">{classes.map((c) => <option key={c} value={c} />)}</datalist>

        {!student && <label className="dash-check">
          <input type="checkbox" checked={f.createLogin} onChange={set("createLogin")} />
          Also create a student login for this student
        </label>}
        {!student && f.createLogin && (
          <div className="dash-form-grid">
            <label className="dash-field"><span>Username *</span><input value={f.username} onChange={set("username")} autoComplete="off" /></label>
            <label className="dash-field"><span>Password *</span><input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" /></label>
          </div>
        )}

        {err && <div className="dash-form-error" role="alert">{err}</div>}
        <div className="dash-form-actions">
          <button type="button" className="dash-ghost-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="dash-primary-btn" disabled={busy}>{busy ? "Saving…" : "Save Student"}</button>
        </div>
      </form>
    </Modal>
  );
}

function LinkAccountModal({ student, onClose, onDone }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [whatsappUrl, setWhatsappUrl] = useState(student.preparedUrl || "");
  const [username, setUsername] = useState(student.linkedUsername || "");
  const [needsLogin, setNeedsLogin] = useState(Boolean(student.forceNeedsLogin || !student.linkedUsername));

  const prepare = async () => {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setBusy(true);
    setErr("");
    setWhatsappUrl("");
    try {
      const res = await api(`/students/${student.id}/link`, { method: "PUT", body: {} });
      notify(res.message);
      setUsername(res.username);
      if (res.whatsappUrl) {
        if (popup && !popup.closed) popup.location.href = res.whatsappUrl;
        else setWhatsappUrl(res.whatsappUrl);
        await onDone();
        return;
      }
      await onDone();
      onClose();
    } catch (e) {
      popup?.close();
      setErr(e.message);
      if (e.code === "NO_STUDENT_LOGIN") setNeedsLogin(true);
    } finally {
      setBusy(false);
    }
  };

  const createLogin = async () => {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setBusy(true);
    setErr("");
    setWhatsappUrl("");
    try {
      const res = await api(`/students/${student.id}/login`, { method: "POST", body: { username } });
      notify(res.message);
      setUsername(res.username);
      setNeedsLogin(false);
      if (popup && !popup.closed) popup.location.href = res.whatsappUrl;
      else setWhatsappUrl(res.whatsappUrl);
      await onDone();
    } catch (e) {
      popup?.close();
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    setErr("");
    try {
      notify((await api(`/students/${student.id}/link`, { method: "PUT", body: { unlink: true } })).message);
      await onDone();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Login account for ${student.name ?? "student"}`} onClose={onClose}>
      <div className="dash-form">
        {needsLogin ? (
          <>
            <div className="dash-empty">This student does not have a login account yet.</div>
            <label className="dash-field"><span>New Student username</span><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></label>
            <button className="dash-primary-btn" disabled={busy || username.trim().length < 3} onClick={createLogin}>{busy ? "Creating…" : "Create login & prepare WhatsApp"}</button>
          </>
        ) : (
          <>
            <p className="dash-muted">Student login: <strong>{username}</strong></p>
            <button className="dash-primary-btn" disabled={busy} onClick={prepare}>{busy ? "Preparing…" : "Prepare WhatsApp message"}</button>
          </>
        )}
        {err && <div className="dash-form-error" role="alert">{err}</div>}
        {whatsappUrl && (
          <div className="dash-empty" role="status">
            <p>Credentials are ready in a pre-filled WhatsApp message. It will only be sent if you choose to send it in WhatsApp.</p>
            <a className="dash-primary-btn" href={whatsappUrl} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Open WhatsApp</a>
          </div>
        )}
        <div className="dash-form-actions">
          {!needsLogin && student.linkedUserId && <button className="dash-ghost-btn danger" disabled={busy} onClick={unlink}>Unlink</button>}
          <button className="dash-ghost-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

/* =====================================================================
   ATTENDANCE (Mark + Records)
   ===================================================================== */
export function AttendancePage({ data, tab, setTab, preset }) {
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[{ key: "mark", label: "Mark Attendance" }, { key: "records", label: "Attendance Records" }]}
      />
      {tab === "mark" ? <MarkTab data={data} preset={preset} /> : <RecordsTab data={data} />}
    </>
  );
}

function MarkTab({ data, preset }) {
  const notify = useNotify();
  const { students, records, loading, refreshing, reload, todayKey, errors } = data;
  const [date, setDate] = useState(todayKey);
  const [cls, setCls] = useState(preset?.cls ?? "");
  const [sec, setSec] = useState(preset?.section ?? "");
  const [q, setQ] = useState("");
  const [choices, setChoices] = useState({});
  const [saving, setSaving] = useState(false);
  const [notices, setNotices] = useState([]);

  const classes = useMemo(() => uniq(students.map((s) => s.cls)), [students]);
  const sections = useMemo(() => uniq(students.map((s) => s.section)), [students]);

  const saved = useMemo(() => {
    const m = new Map();
    records.filter((r) => r.date === date && r.status).forEach((r) => m.set(String(r.studentRef), r.status));
    return m;
  }, [records, date]);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return students.filter((s) =>
      (!cls || String(s.cls) === cls) && (!sec || String(s.section) === sec) &&
      (!n || has(s.name, n) || has(s.roll, n))
    );
  }, [students, cls, sec, q]);

  const eff = (s) => choices[s.id] ?? saved.get(String(s.id)) ?? null;
  const changed = (s) => choices[s.id] !== undefined && choices[s.id] !== saved.get(String(s.id));
  const pendingIds = list.filter(changed);
  const totals = list.reduce((a, s) => {
    const v = eff(s);
    if (v === "present") a.p += 1; else if (v === "absent") a.a += 1; else a.n += 1;
    return a;
  }, { p: 0, a: 0, n: 0 });

  const setOne = (s, v) => setChoices((c) => ({ ...c, [s.id]: v }));
  const allPresent = () => setChoices((c) => ({ ...c, ...Object.fromEntries(list.map((s) => [s.id, "present"])) }));
  const changeDate = (v) => { setDate(v || todayKey); setChoices({}); setNotices([]); };

  const save = async () => {
    const all = Object.entries(choices)
      .filter(([id, v]) => v !== saved.get(String(id)) && students.some((s) => String(s.id) === String(id)))
      .map(([id, v]) => ({ studentId: Number(id), status: v === "present" ? "Present" : "Absent" }));
    if (!all.length) return notify("Nothing to save. Mark at least one student first.", "info");
    setSaving(true);
    try {
      const res = await api("/attendance/mark-bulk", { method: "POST", body: { date, records: all } });
      notify(`${res.message} (${fmtDate(date)})`, res.failed?.length ? "info" : "success");
      setNotices(res.notifications || []);
      setChoices({});
      await reload();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      id="mark-attendance"
      title="Mark Attendance"
      sub={loading ? "Loading…" : `${list.length} student${list.length === 1 ? "" : "s"} · ${totals.p} present · ${totals.a} absent · ${totals.n} not marked`}
      right={<RefreshButton onClick={reload} busy={refreshing} />}
    >
      <div className="dash-filters">
        <label className="dash-field">
          <span>Date</span>
          <input type="date" value={date} max={todayKey} onChange={(e) => changeDate(e.target.value)} />
        </label>
        <Select label="Class" value={cls} onChange={setCls} options={classes} />
        <Select label="Section" value={sec} onChange={setSec} options={sections} />
        <SearchBox value={q} onChange={setQ} placeholder="Search student…" />
      </div>

      {loading ? (
        <div className="dash-empty">Loading students…</div>
      ) : errors.students && !students.length ? (
        <div className="dash-empty">Students could not be loaded: {errors.students}</div>
      ) : !students.length ? (
        <div className="dash-empty">No students added yet, so there is no one to mark.</div>
      ) : !list.length ? (
        <div className="dash-empty">No students match your filters.</div>
      ) : (
        <>
          <div className="dash-bulkbar">
            <button className="dash-ghost-btn" onClick={allPresent}><CheckCheck size={14} /> Mark all shown present</button>
            <button className="dash-ghost-btn" onClick={() => setChoices({})} disabled={!Object.keys(choices).length}><RotateCcw size={14} /> Undo changes</button>
            <span className="dash-muted">{pendingIds.length} unsaved change{pendingIds.length === 1 ? "" : "s"}</span>
            <button className="dash-primary-btn sm" onClick={save} disabled={saving || !Object.keys(choices).length}>
              <Save size={15} /> {saving ? "Saving…" : "Save Attendance"}
            </button>
          </div>
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead><tr><th>Roll No.</th><th>Name</th><th>Class</th><th>Attendance</th></tr></thead>
              <tbody>
                {list.map((s) => {
                  const v = eff(s);
                  return (
                    <tr key={s.id} className={changed(s) ? "dash-dirty" : ""}>
                      <td>{dash(s.roll)}</td>
                      <td className="strong">{dash(s.name)}</td>
                      <td>{classLabel(s.cls, s.section)}</td>
                      <td>
                        <div className="dash-seg" role="group" aria-label={`Attendance for ${s.name}`}>
                          <button className={v === "present" ? "on p" : ""} aria-pressed={v === "present"} onClick={() => setOne(s, "present")}>Present</button>
                          <button className={v === "absent" ? "on a" : ""} aria-pressed={v === "absent"} onClick={() => setOne(s, "absent")}>Absent</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {notices.length > 0 && (
        <div className="dash-notify-box">
          <strong><MessageCircle size={15} /> Notify parents of absent students</strong>
          <ul>
            {notices.map((n) => (
              <li key={n.studentId}>
                {n.name}
                <a href={n.url} target="_blank" rel="noopener noreferrer">Open WhatsApp</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

const PAGE = 50;

function RecordsTab({ data }) {
  const notify = useNotify();
  const { students, records, loading, refreshing, reload, errors } = data;
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cls, setCls] = useState("");
  const [sec, setSec] = useState("");
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const classes = useMemo(() => uniq(students.map((s) => s.cls)), [students]);
  const sections = useMemo(() => uniq(students.map((s) => s.section)), [students]);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return records.filter((r) =>
      r.date && r.status &&
      (!n || has(r.name, n) || has(r.roll, n)) &&
      (!from || r.date >= from) && (!to || r.date <= to) &&
      (!cls || String(r.cls) === cls) && (!sec || String(r.section) === sec) &&
      (!status || r.status === status)
    );
  }, [records, q, from, to, cls, sec, status]);

  const any = q || from || to || cls || sec || status;
  const clear = () => { setQ(""); setFrom(""); setTo(""); setCls(""); setSec(""); setStatus(""); setLimit(PAGE); };
  const f = (setter) => (v) => { setter(v); setLimit(PAGE); };

  const exportCsv = () => {
    if (!rows.length) return notify("There are no records to export.", "info");
    downloadCSV(
      `attendance-${from || "all"}-to-${to || "all"}.csv`,
      ["Date", "Roll Number", "Name", "Class", "Section", "Status"],
      rows.map((r) => [r.date, r.roll, r.name, r.cls, r.section, r.status === "present" ? "Present" : "Absent"])
    );
    notify(`Exported ${rows.length} record${rows.length === 1 ? "" : "s"}.`);
  };

  return (
    <Panel
      id="records"
      title="Attendance Records"
      sub={loading ? "Loading…" : `${rows.length} of ${records.length} record${records.length === 1 ? "" : "s"}`}
      right={
        <div className="dash-head-actions">
          <RefreshButton onClick={reload} busy={refreshing} />
          <button className="dash-ghost-btn" onClick={exportCsv}><Download size={14} /> Export CSV</button>
        </div>
      }
    >
      <div className="dash-filters">
        <SearchBox value={q} onChange={f(setQ)} placeholder="Search name or roll no.…" />
        <label className="dash-field"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => f(setFrom)(e.target.value)} /></label>
        <label className="dash-field"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => f(setTo)(e.target.value)} /></label>
        <Select label="Class" value={cls} onChange={f(setCls)} options={classes} />
        <Select label="Section" value={sec} onChange={f(setSec)} options={sections} />
        <Select label="Status" value={status} onChange={f(setStatus)} options={[{ value: "present", label: "Present" }, { value: "absent", label: "Absent" }]} />
        {any && <button className="dash-ghost-btn" onClick={clear}><RotateCcw size={14} /> Reset</button>}
      </div>

      {loading ? (
        <div className="dash-empty">Loading attendance…</div>
      ) : errors.attendance && !records.length ? (
        <div className="dash-empty">Attendance could not be loaded: {errors.attendance}</div>
      ) : !records.length ? (
        <div className="dash-empty">No attendance has been recorded yet.</div>
      ) : !rows.length ? (
        <div className="dash-empty">No records match your filters.</div>
      ) : (
        <>
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead><tr><th>Date</th><th>Roll No.</th><th>Student</th><th>Class</th><th>Status</th></tr></thead>
              <tbody>
                {rows.slice(0, limit).map((r, i) => (
                  <tr key={`${r.date}-${r.studentRef}-${i}`}>
                    <td>{fmtDate(r.date)}</td>
                    <td>{dash(r.roll)}</td>
                    <td className="strong">{dash(r.name)}</td>
                    <td>{dash(classLabel(r.cls, r.section))}</td>
                    <td><Pill status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > limit && (
            <div className="dash-more">
              <button className="dash-ghost-btn" onClick={() => setLimit(limit + PAGE)}>Show more ({rows.length - limit} remaining)</button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/* =====================================================================
   REPORTS (generated from real records)
   ===================================================================== */
export function ReportsPage({ data }) {
  const notify = useNotify();
  const { students, records, loading, refreshing, reload, todayKey, errors } = data;
  const monthStart = `${todayKey.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayKey);
  const [cls, setCls] = useState("");
  const [sec, setSec] = useState("");
  const [threshold, setThreshold] = useState(75);
  const [onlyLow, setOnlyLow] = useState(false);

  const classes = useMemo(() => uniq(students.map((s) => s.cls)), [students]);
  const sections = useMemo(() => uniq(students.map((s) => s.section)), [students]);

  const report = useMemo(() => {
    const inScope = students.filter((s) => (!cls || String(s.cls) === cls) && (!sec || String(s.section) === sec));
    const ids = new Set(inScope.map((s) => String(s.id)));
    const recs = records.filter((r) => r.date && r.status && ids.has(String(r.studentRef)) && (!from || r.date >= from) && (!to || r.date <= to));

    const per = new Map(inScope.map((s) => [String(s.id), { s, p: 0, a: 0 }]));
    const days = new Map();
    recs.forEach((r) => {
      const e = per.get(String(r.studentRef));
      if (e) e[r.status === "present" ? "p" : "a"] += 1;
      const d = days.get(r.date) || { date: r.date, p: 0, a: 0 };
      d[r.status === "present" ? "p" : "a"] += 1;
      days.set(r.date, d);
    });

    const studentRows = [...per.values()].map((e) => {
      const total = e.p + e.a;
      return { ...e, total, pct: total ? (e.p / total) * 100 : null };
    });
    const dayRows = [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).map((d) => ({ ...d, total: d.p + d.a, pct: (d.p / (d.p + d.a)) * 100 }));
    const totalP = recs.filter((r) => r.status === "present").length;
    return {
      studentRows, dayRows, total: recs.length,
      avg: recs.length ? (totalP / recs.length) * 100 : null,
      low: studentRows.filter((r) => r.pct !== null && r.pct < threshold).length,
    };
  }, [students, records, from, to, cls, sec, threshold]);

  const shown = onlyLow ? report.studentRows.filter((r) => r.pct !== null && r.pct < threshold) : report.studentRows;
  const range = `${from || "start"}_to_${to || "end"}`;

  const exportStudents = () => {
    if (!shown.length) return notify("Nothing to export.", "info");
    downloadCSV(`report-students-${range}.csv`, ["Roll Number", "Name", "Class", "Section", "Present", "Absent", "Total Days", "Attendance %"],
      shown.map((r) => [r.s.roll, r.s.name, r.s.cls, r.s.section, r.p, r.a, r.total, r.pct === null ? "" : r.pct.toFixed(1)]));
    notify("Student-wise report exported.");
  };
  const exportDays = () => {
    if (!report.dayRows.length) return notify("Nothing to export.", "info");
    downloadCSV(`report-daily-${range}.csv`, ["Date", "Present", "Absent", "Marked", "Attendance %"],
      report.dayRows.map((d) => [d.date, d.p, d.a, d.total, d.pct.toFixed(1)]));
    notify("Daily report exported.");
  };

  return (
    <>
      <Panel
        id="report-filters"
        title="Attendance Report"
        sub="Generated live from the attendance records in the database"
        right={<RefreshButton onClick={reload} busy={refreshing} />}
      >
        <div className="dash-filters">
          <label className="dash-field"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="dash-field"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
          <Select label="Class" value={cls} onChange={setCls} options={classes} />
          <Select label="Section" value={sec} onChange={setSec} options={sections} />
          <label className="dash-field"><span>Low-attendance below (%)</span>
            <input type="number" min="1" max="100" value={threshold} onChange={(e) => setThreshold(Math.min(100, Math.max(1, Number(e.target.value) || 75)))} />
          </label>
        </div>
        {!loading && (
          <div className="dash-mini-stats">
            <div><span>Students</span><strong>{report.studentRows.length}</strong></div>
            <div><span>Records in range</span><strong>{report.total}</strong></div>
            <div><span>Average attendance</span><strong>{pctText(report.avg)}</strong></div>
            <div><span>Below {threshold}%</span><strong>{report.low}</strong></div>
          </div>
        )}
      </Panel>

      <Panel
        id="report-students"
        title="Student-wise Report"
        sub={`${shown.length} student${shown.length === 1 ? "" : "s"}`}
        right={
          <div className="dash-head-actions">
            <label className="dash-check inline"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Only below {threshold}%</label>
            <button className="dash-ghost-btn" onClick={exportStudents}><Download size={14} /> Export CSV</button>
          </div>
        }
      >
        {loading ? (
          <div className="dash-empty">Loading report…</div>
        ) : errors.students || errors.attendance ? (
          <div className="dash-empty">The report could not be generated: {errors.students || errors.attendance}</div>
        ) : !shown.length ? (
          <div className="dash-empty">{students.length ? "No students match these filters." : "No students added yet."}</div>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead><tr><th>Roll No.</th><th>Name</th><th>Class</th><th className="num">Present</th><th className="num">Absent</th><th className="num">Days</th><th className="num">Attendance</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.s.id}>
                    <td>{dash(r.s.roll)}</td>
                    <td className="strong">{dash(r.s.name)}</td>
                    <td>{classLabel(r.s.cls, r.s.section)}</td>
                    <td className="num">{r.p}</td><td className="num">{r.a}</td><td className="num">{r.total}</td>
                    <td className={`num ${r.pct !== null && r.pct < threshold ? "dash-low" : ""}`}>{pctText(r.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        id="report-days"
        title="Daily Summary"
        sub={`${report.dayRows.length} day${report.dayRows.length === 1 ? "" : "s"} with attendance`}
        right={<button className="dash-ghost-btn" onClick={exportDays}><Download size={14} /> Export CSV</button>}
      >
        {loading ? (
          <div className="dash-empty">Loading…</div>
        ) : !report.dayRows.length ? (
          <div className="dash-empty">No attendance was recorded in this range.</div>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead><tr><th>Date</th><th className="num">Present</th><th className="num">Absent</th><th className="num">Marked</th><th className="num">Attendance</th></tr></thead>
              <tbody>
                {report.dayRows.map((d) => (
                  <tr key={d.date}>
                    <td>{fmtDate(d.date)}</td><td className="num">{d.p}</td><td className="num">{d.a}</td><td className="num">{d.total}</td><td className="num">{pctText(d.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

/* =====================================================================
   SETTINGS (all roles): profile, password, appearance, session
   ===================================================================== */
export function SettingsPage({ user, onUserChange, onLogout }) {
  const notify = useNotify();
  const [name, setName] = useState(pick(user, ["fullName", "name"]) || "");
  const [phone, setPhone] = useState(pick(user, ["phone"]) || "");
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [theme, setTheme] = useState(currentTheme());

  const saveProfile = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return notify("Enter your full name.", "error");
    setBusy(true);
    try {
      const res = await api("/auth/profile", { method: "PUT", body: { fullName: name, phone } });
      const next = { ...user, ...res.user };
      setStoredUser(next);
      onUserChange?.(next);
      notify(res.message);
    } catch (ex) {
      notify(ex.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (pw.newPassword.length < 6) return notify("New password must be at least 6 characters.", "error");
    if (pw.newPassword !== pw.confirm) return notify("New password and confirmation do not match.", "error");
    setPwBusy(true);
    try {
      const res = await api("/auth/password", { method: "PUT", body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      notify(res.message);
    } catch (ex) {
      notify(ex.message, "error");
    } finally {
      setPwBusy(false);
    }
  };

  const chooseTheme = (t) => { applyTheme(t); setTheme(t); };

  return (
    <div className="dash-cols even">
      <Panel title="Profile" sub="Your account details">
        <form className="dash-form" onSubmit={saveProfile}>
          <label className="dash-field"><span>Full name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="dash-field"><span>Phone</span><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></label>
          <label className="dash-field"><span>Username</span><input value={pick(user, ["username"]) || ""} disabled /></label>
          <label className="dash-field"><span>Role</span><input value={pick(user, ["role"]) || ""} disabled /></label>
          <div className="dash-form-actions"><button className="dash-primary-btn" disabled={busy}>{busy ? "Saving…" : "Save Profile"}</button></div>
        </form>
      </Panel>

      <div className="dash-stack">
        <Panel title="Change Password" sub="Use at least 6 characters">
          <form className="dash-form" onSubmit={savePassword}>
            <label className="dash-field"><span>Current password</span><input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" /></label>
            <label className="dash-field"><span>New password</span><input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" /></label>
            <label className="dash-field"><span>Confirm new password</span><input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" /></label>
            <div className="dash-form-actions"><button className="dash-primary-btn" disabled={pwBusy || !pw.currentPassword}>{pwBusy ? "Updating…" : "Update Password"}</button></div>
          </form>
        </Panel>

        <Panel title="Appearance & Session">
          <div className="dash-form">
            <div className="dash-seg wide" role="group" aria-label="Theme">
              <button className={theme === "light" ? "on p" : ""} onClick={() => chooseTheme("light")}><Sun size={14} /> Light</button>
              <button className={theme === "dark" ? "on p" : ""} onClick={() => chooseTheme("dark")}><Moon size={14} /> Dark</button>
            </div>
            <button className="dash-ghost-btn danger" onClick={onLogout}><LogOut size={14} /> Log out of this device</button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* Bell notifications derived from real data (Admin / Teacher) */
export function buildStaffNotices(data, goMark, goRecords) {
  if (data.loading) return [];
  const sum = summarize(data.records, data.todayKey);
  const total = data.students.length;
  const out = [];
  if (total > 0 && sum.marked < total) out.push({ id: "unmarked", text: `${total - sum.marked} student${total - sum.marked === 1 ? "" : "s"} not marked today`, onClick: goMark });
  if (sum.absent > 0) out.push({ id: "absent", text: `${sum.absent} student${sum.absent === 1 ? "" : "s"} absent today`, onClick: goRecords });
  return out;
}
