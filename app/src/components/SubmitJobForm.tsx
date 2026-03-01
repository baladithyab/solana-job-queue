import React, { FC, useState } from "react";
import { QueueInfo } from "../hooks/useJobQueue";

interface Props {
  queueInfo: QueueInfo | null;
  onSubmit: (
    jobId: number,
    payload: string,
    priority: number,
    maxRetries: number
  ) => Promise<string>;
  existingJobCount: number;
}

export const SubmitJobForm: FC<Props> = ({
  queueInfo,
  onSubmit,
  existingJobCount,
}) => {
  const [payload, setPayload] = useState("");
  const [priority, setPriority] = useState(50);
  const [maxRetries, setMaxRetries] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  const nextJobId = existingJobCount + 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payload.trim() || !queueInfo) return;

    setLoading(true);
    setError(null);
    setLastTx(null);

    try {
      const tx = await onSubmit(nextJobId, payload, priority, maxRetries);
      setLastTx(tx);
      setPayload("");
    } catch (e: any) {
      setError(e.message || "Transaction failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>📬 Submit Job</h2>

      {!queueInfo ? (
        <div style={{ color: "#555", fontSize: "0.85rem" }}>
          Load a queue first to submit jobs.
        </div>
      ) : queueInfo.paused ? (
        <div className="alert error">Queue is paused — cannot submit jobs</div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Job ID (auto)</label>
            <input
              value={`#${nextJobId}`}
              disabled
              style={{ opacity: 0.5 }}
            />
          </div>

          <div className="form-group">
            <label>Payload *</label>
            <textarea
              style={{
                width: "100%",
                background: "#12121f",
                border: "1px solid #2a2a4a",
                borderRadius: 6,
                color: "#e0e0f0",
                padding: "8px 12px",
                fontSize: "0.82rem",
                minHeight: 80,
                resize: "vertical",
              }}
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              placeholder={`e.g. {"action": "send-email", "to": "user@example.com", "subject": "Welcome!"}`}
              required
            />
            <div style={{ fontSize: "0.68rem", color: "#555", marginTop: 4 }}>
              Payload is hashed (SHA-256) before storing. Store the full data off-chain (IPFS/Arweave/DB).
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Priority (0–255)</label>
              <input
                type="number"
                min={0}
                max={255}
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="form-group">
              <label>Max Retries (0–10)</label>
              <input
                type="number"
                min={0}
                max={10}
                value={maxRetries}
                onChange={(e) => setMaxRetries(parseInt(e.target.value) || 0)}
              />
            </div>
          </div>

          {queueInfo.submissionFee > 0 && (
            <div className="alert info" style={{ marginBottom: 12 }}>
              Submission fee: {queueInfo.submissionFee} lamports
            </div>
          )}

          {error && <div className="alert error">{error}</div>}

          {lastTx && (
            <div className="alert success">
              ✅ Job submitted!{" "}
              <a
                href={`https://explorer.solana.com/tx/${lastTx}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#14f195" }}
              >
                View TX →
              </a>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !payload.trim()}
            style={{ width: "100%" }}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ marginRight: 8 }} />
                Submitting...
              </>
            ) : (
              "Submit Job"
            )}
          </button>
        </form>
      )}
    </div>
  );
};
