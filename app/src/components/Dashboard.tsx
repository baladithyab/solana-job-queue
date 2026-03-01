import React, { useState, FC } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { QueueStats } from "./QueueStats";
import { JobList } from "./JobList";
import { SubmitJobForm } from "./SubmitJobForm";
import { useJobQueue } from "../hooks/useJobQueue";

const DEFAULT_QUEUE_NAME = "main-queue";

export const Dashboard: FC = () => {
  const { publicKey, connected } = useWallet();
  const [queueName, setQueueName] = useState(DEFAULT_QUEUE_NAME);
  const [inputQueue, setInputQueue] = useState(DEFAULT_QUEUE_NAME);

  const { queueInfo, jobs, loading, error, submitJob, claimJob, completeJob, refresh } =
    useJobQueue(queueName, publicKey ?? undefined);

  const handleQueueLookup = () => {
    setQueueName(inputQueue);
  };

  return (
    <div>
      {/* Header */}
      <header className="app-header">
        <div>
          <h1>⚙️ On-Chain Job Queue</h1>
          <div className="subtitle">Solana Devnet · Reimagining Redis/BullMQ on-chain</div>
        </div>
        <WalletMultiButton />
      </header>

      <div className="container">
        {!connected && (
          <div className="alert info" style={{ marginBottom: 20 }}>
            Connect your wallet to interact with the job queue.
          </div>
        )}

        {/* Queue Selector */}
        <div className="card">
          <h2>🔍 Queue Lookup</h2>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              style={{ flex: 1, background: "#12121f", border: "1px solid #2a2a4a", borderRadius: 6, color: "#e0e0f0", padding: "8px 12px" }}
              value={inputQueue}
              onChange={(e) => setInputQueue(e.target.value)}
              placeholder="Queue name (e.g. main-queue)"
              onKeyDown={(e) => e.key === "Enter" && handleQueueLookup()}
            />
            <button className="btn btn-primary" onClick={handleQueueLookup}>
              Load
            </button>
            <button
              className="btn"
              style={{ background: "#1a1a2e", border: "1px solid #2a2a4a", color: "#888" }}
              onClick={refresh}
            >
              {loading ? <span className="spinner" /> : "↻ Refresh"}
            </button>
          </div>
          {connected && (
            <div style={{ marginTop: 8, fontSize: "0.75rem", color: "#555" }}>
              Owner: {publicKey?.toString().substring(0, 20)}...
            </div>
          )}
        </div>

        {error && (
          <div className="alert error">{error}</div>
        )}

        {/* Queue Stats */}
        {queueInfo && <QueueStats info={queueInfo} />}

        {/* Two-column layout for job list + submit form */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20 }}>
          {/* Job List */}
          <JobList
            jobs={jobs}
            loading={loading}
            onClaim={claimJob}
            onComplete={completeJob}
            connected={connected}
          />

          {/* Submit Job Form */}
          {connected && (
            <SubmitJobForm
              queueInfo={queueInfo}
              onSubmit={submitJob}
              existingJobCount={jobs.length}
            />
          )}
        </div>

        {/* Architecture Note */}
        <div className="card" style={{ marginTop: 20 }}>
          <h2>📐 Architecture</h2>
          <div style={{ fontSize: "0.8rem", color: "#888", lineHeight: 1.7 }}>
            <p><strong style={{ color: "#9945ff" }}>Web2 (Redis/BullMQ):</strong> Jobs stored as Redis hashes. Queues are sorted sets. Workers use BRPOPLPUSH for atomic claims. Background timer detects stalled jobs.</p>
            <br />
            <p><strong style={{ color: "#14f195" }}>Solana (this program):</strong> Jobs are PDA accounts (<code>seeds = ["job", queue, job_id]</code>). State transitions via signed instructions. Stale jobs expire via permissionless crank. Rent economic model incentivizes cleanup.</p>
            <br />
            <p><strong style={{ color: "#ffc107" }}>Key Tradeoffs:</strong> On-chain = verifiable + trustless. Cost = rent per job (~0.002 SOL). No FIFO guarantee (processors choose). Clock = Solana slot time (~400ms). Deploy: <code>JQUEueaEf9oHhPZ8fwNe9MF9GEbVUjSBxPQ2CaFH3jKn</code></p>
          </div>
        </div>
      </div>
    </div>
  );
};
