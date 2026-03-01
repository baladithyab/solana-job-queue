import React, { FC, useState } from "react";
import { JobInfo, JobStatus } from "../hooks/useJobQueue";

interface Props {
  jobs: JobInfo[];
  loading: boolean;
  onClaim: (jobId: number) => Promise<string>;
  onComplete: (jobId: number, result: string) => Promise<string>;
  connected: boolean;
}

const STATUS_FILTERS: { label: string; value: JobStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "⏳ Pending", value: "pending" },
  { label: "⚙️ Processing", value: "processing" },
  { label: "✅ Completed", value: "completed" },
  { label: "❌ Failed", value: "failed" },
  { label: "⏰ Expired", value: "expired" },
];

function StatusBadge({ status }: { status: JobStatus }) {
  const labels: Record<JobStatus, string> = {
    pending: "⏳ Pending",
    processing: "⚙️ Processing",
    completed: "✅ Completed",
    failed: "❌ Failed",
    expired: "⏰ Expired",
  };
  return <span className={`badge ${status}`}>{labels[status]}</span>;
}

export const JobList: FC<Props> = ({
  jobs,
  loading,
  onClaim,
  onComplete,
  connected,
}) => {
  const [filter, setFilter] = useState<JobStatus | "all">("all");
  const [actionStates, setActionStates] = useState<
    Record<number, { loading: boolean; tx?: string; error?: string }>
  >({});
  const [completingJob, setCompletingJob] = useState<number | null>(null);
  const [resultInput, setResultInput] = useState("");

  const filtered =
    filter === "all" ? jobs : jobs.filter((j) => j.status === filter);

  const counts: Record<string, number> = {};
  jobs.forEach((j) => {
    counts[j.status] = (counts[j.status] || 0) + 1;
  });

  const handleClaim = async (jobId: number) => {
    setActionStates((s) => ({ ...s, [jobId]: { loading: true } }));
    try {
      const tx = await onClaim(jobId);
      setActionStates((s) => ({ ...s, [jobId]: { loading: false, tx } }));
    } catch (e: any) {
      setActionStates((s) => ({
        ...s,
        [jobId]: { loading: false, error: e.message },
      }));
    }
  };

  const handleComplete = async (jobId: number) => {
    if (!resultInput.trim()) return;
    setActionStates((s) => ({ ...s, [jobId]: { loading: true } }));
    try {
      const tx = await onComplete(jobId, resultInput);
      setActionStates((s) => ({ ...s, [jobId]: { loading: false, tx } }));
      setCompletingJob(null);
      setResultInput("");
    } catch (e: any) {
      setActionStates((s) => ({
        ...s,
        [jobId]: { loading: false, error: e.message },
      }));
    }
  };

  return (
    <div className="card">
      <h2>📋 Jobs {loading && <span className="spinner" style={{ marginLeft: 8 }} />}</h2>

      {/* Filter tabs */}
      <div className="filter-tabs">
        {STATUS_FILTERS.map(({ label, value }) => (
          <button
            key={value}
            className={`filter-tab ${filter === value ? "active" : ""}`}
            onClick={() => setFilter(value)}
          >
            {label}
            {value !== "all" && counts[value] ? (
              <span
                style={{
                  marginLeft: 4,
                  background: "#2a2a4a",
                  borderRadius: 10,
                  padding: "1px 6px",
                  fontSize: "0.65rem",
                }}
              >
                {counts[value]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📭</div>
          <div>No {filter !== "all" ? filter : ""} jobs found</div>
        </div>
      ) : (
        <table className="job-table">
          <thead>
            <tr>
              <th>#ID</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Retries</th>
              <th>Submitted</th>
              <th>Deadline</th>
              {connected && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((job) => {
              const state = actionStates[job.jobId];
              const deadline = job.processingDeadline
                ? new Date(job.processingDeadline * 1000)
                : null;
              const isExpiringSoon =
                deadline && Date.now() > deadline.getTime() - 30000;

              return (
                <React.Fragment key={job.jobId}>
                  <tr>
                    <td>
                      <span style={{ fontWeight: 700, color: "#9945ff" }}>
                        #{job.jobId}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={job.status} />
                    </td>
                    <td>{job.priority}</td>
                    <td>
                      {job.retryCount}/{job.maxRetries}
                    </td>
                    <td className="mono">
                      {new Date(job.submittedAt * 1000).toLocaleTimeString()}
                    </td>
                    <td className="mono">
                      {deadline ? (
                        <span style={{ color: isExpiringSoon ? "#ff4757" : "#888" }}>
                          {deadline.toLocaleTimeString()}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    {connected && (
                      <td>
                        {job.status === "pending" && (
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={state?.loading}
                            onClick={() => handleClaim(job.jobId)}
                          >
                            {state?.loading ? <span className="spinner" /> : "Claim"}
                          </button>
                        )}
                        {job.status === "processing" && (
                          <button
                            className="btn btn-sm"
                            style={{
                              background: "#002a15",
                              border: "1px solid #14f195",
                              color: "#14f195",
                            }}
                            onClick={() =>
                              setCompletingJob(
                                completingJob === job.jobId ? null : job.jobId
                              )
                            }
                          >
                            Complete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {/* Complete job inline form */}
                  {completingJob === job.jobId && (
                    <tr>
                      <td colSpan={7} style={{ paddingTop: 4 }}>
                        <div
                          style={{
                            background: "#12121f",
                            border: "1px solid #2a2a4a",
                            borderRadius: 8,
                            padding: "12px",
                            display: "flex",
                            gap: 8,
                          }}
                        >
                          <input
                            style={{
                              flex: 1,
                              background: "#0a0a15",
                              border: "1px solid #2a2a4a",
                              borderRadius: 6,
                              color: "#e0e0f0",
                              padding: "6px 10px",
                              fontSize: "0.8rem",
                            }}
                            placeholder="Result data (will be hashed)"
                            value={resultInput}
                            onChange={(e) => setResultInput(e.target.value)}
                          />
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={!resultInput.trim() || state?.loading}
                            onClick={() => handleComplete(job.jobId)}
                          >
                            {state?.loading ? <span className="spinner" /> : "✓ Submit"}
                          </button>
                          <button
                            className="btn btn-sm"
                            style={{
                              background: "transparent",
                              border: "1px solid #2a2a4a",
                              color: "#666",
                            }}
                            onClick={() => setCompletingJob(null)}
                          >
                            Cancel
                          </button>
                        </div>
                        {state?.error && (
                          <div className="alert error" style={{ marginTop: 6 }}>
                            {state.error}
                          </div>
                        )}
                        {state?.tx && (
                          <div className="alert success" style={{ marginTop: 6 }}>
                            TX:{" "}
                            <a
                              href={`https://explorer.solana.com/tx/${state.tx}?cluster=devnet`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: "#14f195" }}
                            >
                              {state.tx.substring(0, 16)}...
                            </a>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
