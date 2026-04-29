"use client";

import { useState, useMemo, useEffect, useTransition } from "react";
import { ArrowUpRight, CheckSquare, Copy, Download, Mail, RefreshCw, Send } from "lucide-react";
import type { EmailFilter, GmailStatus, StoredEmail } from "./types";
import { EMAIL_STATUS_LABELS, filteredEmails, getStatusClass } from "./utils";

type Props = {
  emails: StoredEmail[];
  gmailStatus: GmailStatus | null;
  pageError: string | null;
  pageSuccess: string | null;
  setPageError: (msg: string | null) => void;
  setPageSuccess: (msg: string | null) => void;
  onEmailsChanged: () => Promise<void>;
  onGmailStatusChanged: () => Promise<void>;
};

export function EmailsPage({
  emails,
  gmailStatus,
  pageError,
  pageSuccess,
  setPageError,
  setPageSuccess,
  onEmailsChanged,
  onGmailStatusChanged
}: Props) {
  const [emailFilter, setEmailFilter] = useState<EmailFilter>("all");
  const [emailSearch, setEmailSearch] = useState("");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedEmailIds, setSelectedEmailIds] = useState<Set<string>>(new Set());
  const [emailEditor, setEmailEditor] = useState<{
    subject: string;
    body: string;
    status: StoredEmail["status"];
    scheduledFor: string;
  }>({ subject: "", body: "", status: "generated", scheduledFor: "" });
  const [savePending, startSaveTransition] = useTransition();
  const [draftPending, startDraftTransition] = useTransition();
  const [bulkPending, startBulkTransition] = useTransition();

  const visibleEmailRows = useMemo(
    () => filteredEmails(emails, emailFilter, emailSearch),
    [emails, emailFilter, emailSearch]
  );

  const selectedEmail = useMemo(
    () => visibleEmailRows.find((e) => e.id === selectedEmailId) || visibleEmailRows[0] || null,
    [visibleEmailRows, selectedEmailId]
  );

  useEffect(() => {
    if (!selectedEmail) {
      setEmailEditor({ subject: "", body: "", status: "generated", scheduledFor: "" });
      return;
    }
    setEmailEditor({
      subject: selectedEmail.subject,
      body: selectedEmail.body,
      status: selectedEmail.status,
      scheduledFor: selectedEmail.scheduledFor ? toDatetimeLocalValue(selectedEmail.scheduledFor) : ""
    });
  }, [selectedEmail?.id, selectedEmail?.subject, selectedEmail?.body, selectedEmail?.status, selectedEmail?.scheduledFor]);

  const selectedCount = selectedEmailIds.size;

  function toDatetimeLocalValue(value: string): string {
    const date = new Date(value);
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  function fromDatetimeLocalValue(value: string): string | undefined {
    if (!value) return undefined;
    return new Date(value).toISOString();
  }

  function toggleSelectedEmail(emailId: string, checked: boolean) {
    setSelectedEmailIds((current) => {
      const next = new Set(current);
      if (checked) next.add(emailId);
      else next.delete(emailId);
      return next;
    });
  }

  function selectVisibleEmails() {
    setSelectedEmailIds(new Set(visibleEmailRows.map((email) => email.id)));
  }

  function downloadCSV(filename: string, rows: Array<Array<string | number>>) {
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportEmailsCSV() {
    const rows = [
      ["Company", "Contact", "Email", "Title", "Step", "Status", "Scheduled For", "Quality Score", "Quality Issues", "Subject", "Body"],
      ...visibleEmailRows.map((email) => [
        email.companyName || "",
        email.contactName || "",
        email.contactEmail || "",
        email.contactTitle || "",
        email.sequenceStep,
        email.status,
        email.scheduledFor || "",
        email.qualityScore,
        email.qualityIssues.join("; "),
        email.subject,
        email.body
      ])
    ];
    downloadCSV("ff_emails.csv", rows);
  }

  function exportEmailContactsCSV() {
    const seen = new Set<string>();
    const rows: Array<Array<string | number>> = [["Company", "Contact", "Email", "Title"]];
    for (const email of visibleEmailRows) {
      const key = `${email.companyName}-${email.contactEmail}`;
      if (!email.contactEmail || seen.has(key)) continue;
      seen.add(key);
      rows.push([email.companyName || "", email.contactName || "", email.contactEmail || "", email.contactTitle || ""]);
    }
    downloadCSV("ff_email_contacts.csv", rows);
  }

  function saveSelectedEmail() {
    if (!selectedEmail) return;
    setPageError(null);
    setPageSuccess(null);

    startSaveTransition(async () => {
      try {
        const response = await fetch(`/api/emails/${selectedEmail.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...emailEditor,
            scheduledFor: fromDatetimeLocalValue(emailEditor.scheduledFor)
          })
        });

        const data = (await response.json()) as { email?: StoredEmail; error?: string };
        if (!response.ok || !data.email) {
          throw new Error(data.error || "Failed to save email.");
        }

        await onEmailsChanged();
        setPageSuccess("Email updated.");
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Failed to save email.");
      }
    });
  }

  async function createGmailDraftForEmail(email: StoredEmail, overrides?: { subject?: string; body?: string }) {
    if (!email.contactEmail) {
      throw new Error(`${email.contactName || email.companyName || "Selected email"} is missing a contact email.`);
    }

    const subject = overrides?.subject ?? email.subject;
    const body = overrides?.body ?? email.body;
    const response = await fetch("/api/gmail/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: email.contactEmail,
        subject,
        body
      })
    });

    const data = (await response.json()) as {
      draftId?: string;
      messageId?: string;
      threadId?: string;
      gmailUrl?: string;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error || "Failed to create Gmail draft.");
    }

    const patchResponse = await fetch(`/api/emails/${email.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject,
        body,
        status: "drafted",
        gmailDraftUrl: data.gmailUrl || "https://mail.google.com/mail/u/0/#drafts",
        gmailDraftId: data.draftId,
        gmailMessageId: data.messageId,
        gmailThreadId: data.threadId
      })
    });

    const patchData = (await patchResponse.json()) as { email?: StoredEmail; error?: string };
    if (!patchResponse.ok || !patchData.email) {
      throw new Error(patchData.error || "Failed to update email after draft creation.");
    }
  }

  function createGmailDraftForSelectedEmail() {
    if (!selectedEmail) return;
    setPageError(null);
    setPageSuccess(null);

    startDraftTransition(async () => {
      try {
        await createGmailDraftForEmail(selectedEmail, {
          subject: emailEditor.subject,
          body: emailEditor.body
        });
        await Promise.all([onEmailsChanged(), onGmailStatusChanged()]);
        setPageSuccess("Draft created in Gmail.");
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Failed to create Gmail draft.");
      }
    });
  }

  function updateSelectedStatus(status: StoredEmail["status"]) {
    const targetIds = selectedEmailIds.size > 0 ? [...selectedEmailIds] : selectedEmail ? [selectedEmail.id] : [];
    if (targetIds.length === 0) return;
    setPageError(null);
    setPageSuccess(null);

    startBulkTransition(async () => {
      try {
        await Promise.all(
          targetIds.map((id) =>
            fetch(`/api/emails/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status })
            }).then(async (response) => {
              if (!response.ok) {
                const data = (await response.json()) as { error?: string };
                throw new Error(data.error || "Failed to update selected emails.");
              }
            })
          )
        );
        await onEmailsChanged();
        setPageSuccess(`${targetIds.length} email${targetIds.length === 1 ? "" : "s"} marked ${EMAIL_STATUS_LABELS[status].toLowerCase()}.`);
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Failed to update selected emails.");
      }
    });
  }

  function createDraftsForSelected() {
    const targetEmails = visibleEmailRows.filter((email) => selectedEmailIds.has(email.id));
    if (targetEmails.length === 0) {
      setPageError("Select at least one email to create Gmail drafts.");
      return;
    }
    setPageError(null);
    setPageSuccess(null);

    startBulkTransition(async () => {
      try {
        let created = 0;
        for (const email of targetEmails) {
          await createGmailDraftForEmail(email);
          created += 1;
        }
        await Promise.all([onEmailsChanged(), onGmailStatusChanged()]);
        setPageSuccess(`${created} Gmail draft${created === 1 ? "" : "s"} created.`);
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Failed to create selected Gmail drafts.");
      }
    });
  }

  function syncGmailStatuses() {
    const ids = selectedEmailIds.size > 0 ? [...selectedEmailIds] : visibleEmailRows.map((email) => email.id);
    setPageError(null);
    setPageSuccess(null);

    startBulkTransition(async () => {
      try {
        const response = await fetch("/api/gmail/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emailIds: ids.slice(0, 50) })
        });
        const data = (await response.json()) as {
          result?: { checked: number; updated: number; replied: number; sent: number; errors: string[] };
          error?: string;
        };
        if (!response.ok || !data.result) throw new Error(data.error || "Gmail sync failed.");
        await Promise.all([onEmailsChanged(), onGmailStatusChanged()]);
        setPageSuccess(
          `Gmail sync checked ${data.result.checked}, updated ${data.result.updated}, found ${data.result.replied} replies.`
        );
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Gmail sync failed.");
      }
    });
  }

  return (
    <>
      <header className="pageHeader">
        <div>
          <h1>Emails</h1>
          <p>{visibleEmailRows.length} of {emails.length} total emails queued for review, edits, and Gmail drafting.</p>
        </div>
        <div className="sectionControls">
          <select value={emailFilter} onChange={(event) => setEmailFilter(event.target.value as EmailFilter)}>
            <option value="all">all</option>
            <option value="due_today">due today</option>
            <option value="missing_email">missing email</option>
            <option value="generated">generated</option>
            <option value="needs_edits">needs edits</option>
            <option value="approved">approved</option>
            <option value="scheduled">scheduled</option>
            <option value="drafted">drafted</option>
            <option value="sent">sent</option>
            <option value="replied">replied</option>
          </select>
          <button className="secondaryButton" type="button" onClick={syncGmailStatuses} disabled={bulkPending}>
            <RefreshCw size={15} />
            Sync Gmail
          </button>
          <button className="secondaryButton" type="button" onClick={exportEmailsCSV}>
            <Download size={15} />
            Export All
          </button>
          <button className="secondaryButton" type="button" onClick={exportEmailContactsCSV}>
            <Download size={15} />
            Export Contacts
          </button>
        </div>
      </header>

      {pageError ? <p className="error">{pageError}</p> : null}
      {pageSuccess ? <p className="success">{pageSuccess}</p> : null}

      {emails.length > 0 ? (
        <section className="emailWorkbench">
          <div className="resultsPanel emailListPane">
            <div className="sectionHeader sectionHeader--filters">
              <div>
                <h2>Queue</h2>
                <p>{selectedCount > 0 ? `${selectedCount} selected.` : "Scheduled, drafted, sent, and replied sequences."}</p>
              </div>
              <input
                className="compactInput"
                value={emailSearch}
                onChange={(event) => setEmailSearch(event.target.value)}
                placeholder="Filter emails..."
              />
            </div>
            <div className="bulkActionBar">
              <button className="secondaryButton" type="button" onClick={selectVisibleEmails}>
                <CheckSquare size={15} />
                Select Visible
              </button>
              <button className="secondaryButton" type="button" onClick={() => setSelectedEmailIds(new Set())}>
                Clear
              </button>
              <button className="secondaryButton" type="button" onClick={() => updateSelectedStatus("approved")} disabled={bulkPending}>
                Approve
              </button>
              <button className="secondaryButton" type="button" onClick={() => updateSelectedStatus("scheduled")} disabled={bulkPending}>
                Schedule
              </button>
              <button className="primaryButton" type="button" onClick={createDraftsForSelected} disabled={bulkPending || selectedCount === 0}>
                <Send size={15} />
                Draft Selected
              </button>
            </div>
            <div className="emailList">
              {visibleEmailRows.map((email) => (
                <article
                  key={email.id}
                  className={`emailRowCard ${selectedEmail?.id === email.id ? "active" : ""}`}
                >
                  <label className="emailRowCheck">
                    <input
                      type="checkbox"
                      checked={selectedEmailIds.has(email.id)}
                      onChange={(event) => toggleSelectedEmail(email.id, event.target.checked)}
                    />
                  </label>
                  <button className="emailRowButton" type="button" onClick={() => setSelectedEmailId(email.id)}>
                  <div className="emailRowTop">
                    <strong>{email.subject}</strong>
                    <span className={getStatusClass(email.status)}>
                      {EMAIL_STATUS_LABELS[email.status]}
                    </span>
                  </div>
                  <div className="emailRowMeta">
                    <span>{email.contactName || "Unknown contact"}</span>
                    <span>{email.contactEmail || "No email found"}</span>
                  </div>
                  <div className="emailRowMeta">
                    <span>{email.companyName || "No company"}</span>
                    <span>Step {email.sequenceStep}</span>
                  </div>
                  <div className="emailRowMeta">
                    <span>{email.scheduledFor ? `Due ${new Date(email.scheduledFor).toLocaleDateString()}` : "No send date"}</span>
                    <span>{email.qualityScore ? `${email.qualityScore} quality` : "Not checked"}</span>
                  </div>
                  <p>{email.body.slice(0, 180)}{email.body.length > 180 ? "..." : ""}</p>
                  </button>
                </article>
              ))}
            </div>
          </div>

          <div className="draftEditor emailEditorPane">
            {selectedEmail ? (
              <>
                <div className="draftHeader">
                  <div>
                    <h2>{selectedEmail.companyName || "Draft Email"}</h2>
                    <p>
                      To: {selectedEmail.contactName || "Unknown"}{" "}
                      <span className="mono">{selectedEmail.contactEmail || "No email found"}</span>
                    </p>
                  </div>
                  <div className="draftHeaderActions">
                    <span className={getStatusClass(emailEditor.status)}>
                      {EMAIL_STATUS_LABELS[emailEditor.status]}
                    </span>
                  </div>
                </div>

                <div className="draftField">
                  <label>Subject</label>
                  <input
                    value={emailEditor.subject}
                    onChange={(event) =>
                      setEmailEditor((current) => ({ ...current, subject: event.target.value }))
                    }
                  />
                </div>

                <div className="draftField">
                  <label>Body</label>
                  <textarea
                    value={emailEditor.body}
                    onChange={(event) =>
                      setEmailEditor((current) => ({ ...current, body: event.target.value }))
                    }
                  />
                </div>

                <div className="draftField">
                  <label>Status</label>
                  <select
                    value={emailEditor.status}
                    onChange={(event) =>
                      setEmailEditor((current) => ({
                        ...current,
                        status: event.target.value as StoredEmail["status"]
                      }))
                    }
                  >
                    <option value="generated">Generated</option>
                    <option value="needs_edits">Needs Edits</option>
                    <option value="approved">Approved</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="drafted">Drafted</option>
                    <option value="sent">Sent</option>
                    <option value="replied">Replied</option>
                  </select>
                </div>

                <div className="draftField">
                  <label>Scheduled For</label>
                  <input
                    type="datetime-local"
                    value={emailEditor.scheduledFor}
                    onChange={(event) =>
                      setEmailEditor((current) => ({ ...current, scheduledFor: event.target.value }))
                    }
                  />
                </div>

                <section className="qualityPanel">
                  <div>
                    <strong>{selectedEmail.qualityScore || 0}</strong>
                    <span>Quality Score</span>
                  </div>
                  {selectedEmail.qualityIssues.length > 0 ? (
                    <ul className="plainList">
                      {selectedEmail.qualityIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No quality issues flagged.</p>
                  )}
                </section>

                <div className="draftFooter">
                  {!selectedEmail.contactEmail ? (
                    <p className="error">
                      No email found yet for this contact. You can still edit the copy here, but Gmail draft creation is disabled until an address is found.
                    </p>
                  ) : null}
                  <div className="inlineActions">
                    <button className="secondaryButton" type="button" onClick={() => navigator.clipboard.writeText(emailEditor.body)}>
                      <Copy size={16} />
                      Copy
                    </button>
                    <button className="secondaryButton" type="button" onClick={saveSelectedEmail} disabled={savePending}>
                      {savePending ? "Saving..." : "Save"}
                    </button>
                    <button
                      className="primaryButton"
                      type="button"
                      onClick={createGmailDraftForSelectedEmail}
                      disabled={draftPending || !selectedEmail.contactEmail}
                    >
                      <Send size={16} />
                      {draftPending ? "Creating..." : "Create Gmail Draft"}
                    </button>
                  </div>
                </div>

                <section className="gmailCard">
                  <strong>Gmail connection</strong>
                  <p>
                    {gmailStatus?.connected
                      ? gmailStatus.canSync
                        ? "Gmail is connected with compose and sync access."
                        : "Gmail can create drafts. Reauthorize to enable sent/reply sync."
                      : "Connect Gmail before creating drafts. Each teammate can authorize their own mailbox from this same app."}
                  </p>
                  <div className="inlineActions">
                    <a className="secondaryLink" href="/signin">
                      {gmailStatus?.connected ? "Reauthorize Gmail" : "Connect Gmail"}
                    </a>
                    <a className="secondaryLink" href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noreferrer">
                      Open Gmail Drafts <ArrowUpRight size={14} />
                    </a>
                  </div>
                </section>
              </>
            ) : (
              <div className="emptyStateTable">
                <Mail size={34} />
                <p>No emails match the current filter.</p>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="resultsPanel">
          <div className="emptyStateTable">
            <Mail size={34} />
            <p>No emails yet. Queue a sequence from a location detail view to populate this page.</p>
          </div>
        </section>
      )}
    </>
  );
}
