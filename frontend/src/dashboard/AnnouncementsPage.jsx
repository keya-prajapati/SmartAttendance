import { useCallback, useEffect, useState } from "react";
import { api, Panel, RefreshButton, useNotify } from "./DashboardShared";

const TYPES = ["General", "Exam", "Holiday", "Event", "Important", "Other"];
const AUDIENCES = ["Everyone", "Teachers", "Students"];
const today = () => new Date().toLocaleDateString("en-CA");
/* SQL Server BIT can arrive as 0/1, true/false or the strings "0"/"1" (a non-empty string is truthy in JS) */
const flag = (v) => v === true || v === 1 || v === "1" || v === "true";
const blankForm = () => ({ title: "", message: "", type: "General", targetAudience: "Everyone", publishDate: today(), expiryDate: "" });

export default function AnnouncementsPage({ isAdmin = false }) {
  const notify = useNotify();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setItems(await api("/announcements")); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const reset = () => { setForm(blankForm()); setEditingId(null); setError(""); };
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError("");
    const body = { ...form, expiryDate: form.expiryDate || null };
    try {
      const response = editingId
        ? await api(`/announcements/${editingId}`, { method: "PUT", body })
        : await api("/announcements", { method: "POST", body });
      notify(response.message);
      reset();
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const edit = (item) => {
    setEditingId(item.AnnouncementID);
    setForm({
      title: item.Title,
      message: item.Message,
      type: item.Type,
      targetAudience: item.TargetAudience,
      publishDate: String(item.PublishDate).slice(0, 10),
      expiryDate: item.ExpiryDate ? String(item.ExpiryDate).slice(0, 10) : "",
    });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const setPublished = async (item) => {
    try {
      const response = await api(`/announcements/${item.AnnouncementID}/publish`, { method: "PATCH", body: { isPublished: !flag(item.IsPublished) } });
      notify(response.message);
      await load();
    } catch (e) { notify(e.message, "error"); }
  };

  const archive = async (item) => {
    if (!window.confirm(`Archive “${item.Title}”?`)) return;
    try {
      const response = await api(`/announcements/${item.AnnouncementID}/archive`, { method: "PATCH", body: {} });
      notify(response.message);
      await load();
    } catch (e) { notify(e.message, "error"); }
  };

  if (!isAdmin) {
    return (
      <Panel title="Announcements" sub="Current notices for your role" right={<RefreshButton onClick={load} busy={loading} />}>
        {loading ? <div className="dash-empty">Loading announcements…</div> : error ? <div className="dash-error" role="alert">{error}</div> : !items.length ? <div className="dash-empty">No announcements at this time.</div> : (
          <div className="dash-announcement-list">{items.map((item) => (
            <article className="dash-announcement" key={item.AnnouncementID}>
              <div className="dash-announcement-head"><h3>{item.Title}</h3><span className={`dash-pill ${item.Type === "Important" ? "absent" : "none"}`}>{item.Type}</span></div>
              <p className="dash-announcement-message">{item.Message}</p>
              <small>Published {item.PublishDate}{item.ExpiryDate ? ` · Expires ${item.ExpiryDate}` : ""}</small>
            </article>
          ))}</div>
        )}
      </Panel>
    );
  }

  return (
    <div className="dash-stack">
      <Panel title={editingId ? "Edit Announcement" : "Create Announcement"} sub="Announcements are unpublished until you publish them">
        <form className="dash-form" onSubmit={save}>
          <div className="dash-form-grid">
            <label className="dash-field"><span>Title</span><input value={form.title} onChange={set("title")} maxLength={160} required /></label>
            <label className="dash-field"><span>Type</span><select value={form.type} onChange={set("type")}>{TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <label className="dash-field"><span>Target audience</span><select value={form.targetAudience} onChange={set("targetAudience")}>{AUDIENCES.map((audience) => <option key={audience} value={audience}>{audience}</option>)}</select></label>
            <label className="dash-field"><span>Publish date</span><input type="date" value={form.publishDate} onChange={set("publishDate")} required /></label>
            <label className="dash-field"><span>Expiry date (optional)</span><input type="date" value={form.expiryDate} min={form.publishDate || undefined} onChange={set("expiryDate")} /></label>
          </div>
          <label className="dash-field"><span>Message</span><textarea className="dash-textarea" value={form.message} onChange={set("message")} maxLength={20000} rows={5} required /></label>
          {error && <div className="dash-form-error" role="alert">{error}</div>}
          <div className="dash-form-actions">
            {editingId && <button type="button" className="dash-ghost-btn" disabled={busy} onClick={reset}>Cancel edit</button>}
            <button type="submit" className="dash-primary-btn" disabled={busy}>{busy ? "Saving…" : editingId ? "Save changes" : "Create announcement"}</button>
          </div>
        </form>
      </Panel>

      <Panel title="All Announcements" sub={loading ? "Loading…" : `${items.length} announcement(s)`} right={<RefreshButton onClick={load} busy={loading} />}>
        {loading ? <div className="dash-empty">Loading announcements…</div> : error ? <div className="dash-empty">{error}</div> : !items.length ? <div className="dash-empty">No announcements created yet.</div> : (
          <div className="dash-table-wrap"><table className="dash-table dash-announcement-table">
            <thead><tr><th>Announcement</th><th>Type</th><th>Audience</th><th>Publish</th><th>Expiry</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{items.map((item) => (
              <tr key={item.AnnouncementID}>
                <td><strong>{item.Title}</strong><p className="dash-announcement-message">{item.Message}</p></td>
                <td>{item.Type}</td><td>{item.TargetAudience}</td><td>{item.PublishDate}</td><td>{item.ExpiryDate || "—"}</td>
                <td>{flag(item.IsArchived) ? "Archived" : flag(item.IsPublished) ? "Published" : "Unpublished"}</td>
                <td><div className="dash-head-actions">
                  <button className="dash-ghost-btn sm" disabled={flag(item.IsArchived)} onClick={() => edit(item)}>Edit</button>
                  <button className="dash-ghost-btn sm" disabled={flag(item.IsArchived)} onClick={() => setPublished(item)}>{flag(item.IsPublished) ? "Unpublish" : "Publish"}</button>
                  <button className="dash-ghost-btn sm danger" disabled={flag(item.IsArchived)} onClick={() => archive(item)}>Archive</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </div>
  );
}