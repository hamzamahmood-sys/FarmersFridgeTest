"use client";

import { useState, useMemo, useEffect, useTransition } from "react";
import { ArrowUpRight, Copy, Download, Mail, Send } from "lucide-react";
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
  const [emailEditor, setEmailEditor] = useState<{
    subject: string;
    body: string;
    status: Exclude<EmailFilter, "all">;
  }>({ subject: "", body: "", status: "generated" });
  const [savePending, startSaveTransition] = useTransition();
  const [draftPending, startDraftTransition] = useTransition();

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
      setEmailEditor({ subject: "", body: "", status: "generated" });
      return;
    }
    setEmailEditor({
      subject: selectedEmail.subject,
      body: selectedEmail.body,
      status: selectedEmail.status
    });
  }, [selectedEmail?.id, selectedEmail?.subject, selectedEmail?.body, selectedEmail?.status]);

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
      ["Company", "Contact", "Email", "Title", "Step", "Status", "Subject", "Body"],
      ...visibleEmailRows.map((email) => [
        email.companyName || "",
        email.contactName || "",
        email.contactEmail || "",
        email.contactTitle || "",
        email.sequenceStep,
        email.status,
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
          body: JSON.stringify(emailEditor)
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

  function createGmailDraftForSelectedEmail() {
    if (!selectedEmail) return;
    if (!selectedEmail.contactEmail) {
      setPageError("This sequence does not have a contact email yet, so Gmail draft creation is unavailable.");
      return;
    }

    setPageError(null);
    setPageSuccess(null);

    startDraftTransition(async () => {
      try {
        const response = await fetch("/api/gmail/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: selectedEmail.contactEmail,
            subject: emailEditor.subject,
            body: emailEditor.body
          })
        });

        const data = (await response.json()) as { gmailUrl?: string; error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Failed to create Gmail draft.");
        }

        const patchResponse = await fetch(`/api/emails/${selectedEmail.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: emailEditor.subject,
            body: emailEditor.body,
            status: "approved",
            gmailDraftUrl: data.gmailUrl || "https://mail.google.com/mail/u/0/#drafts"
          })
        });

        const patchData = (await patchResponse.json()) as { email?: StoredEmail; error?: string };
        if (!patchResponse.ok || !patchData.email) {
          throw new Error(patchData.error || "Failed to update email after draft creation.");
        }

        await Promise.all([onEmailsChanged(), onGmailStatusChanged()]);
        setPageSuccess("Draft created in Gmail.");
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Failed to create Gmail draft.");
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
            <option value="generated">generated</option>
            <option value="approved">approved</option>
            <option value="sent">sent</option>
          </select>
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

      {visibleEmailRows.length > 0 ? (
        <section className="emailWorkbench">
          <div className="resultsPanel emailListPane">
            <div className="sectionHeader sectionHeader--filters">
              <div>
                <h2>Queue</h2>
                <p>Generated, approved, and sent sequences.</p>
              </div>
              <input
                className="compactInput"
                value={emailSearch}
                onChange={(event) => setEmailSearch(event.target.value)}
                placeholder="Filter emails..."
              />
            </div>
            <div className="emailList">
              {visibleEmailRows.map((email) => (
                <button
                  key={email.id}
                  className={`emailRowCard ${selectedEmail?.id === email.id ? "active" : ""}`}
                  type="button"
                  onClick={() => setSelectedEmailId(email.id)}
                >
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
                  <p>{email.body.slice(0, 180)}{email.body.length > 180 ? "..." : ""}</p>
                </button>
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
                        status: event.target.value as Exclude<EmailFilter, "all">
                      }))
                    }
                  >
                    <option value="generated">Generated</option>
                    <option value="approved">Approved</option>
                    <option value="sent">Sent</option>
                  </select>
                </div>

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
                      ? "Gmail is connected with compose access."
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
