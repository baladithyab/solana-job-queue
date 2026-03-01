import React, { FC } from "react";
import { QueueInfo } from "../hooks/useJobQueue";

interface Props {
  info: QueueInfo;
}

export const QueueStats: FC<Props> = ({ info }) => {
  const fillPercent = Math.round((info.activeJobCount / info.maxJobs) * 100);

  return (
    <div className="card">
      <h2>
        📊 Queue: {info.name}
        <span
          className="badge"
          style={{ marginLeft: 8 }}
          {...(info.paused ? { className: "badge expired" } : { className: "badge completed" })}
        >
          {info.paused ? "⏸ Paused" : "▶ Active"}
        </span>
      </h2>

      <div className="stats-grid">
        <div className="stat-item">
          <div className="label">Active Jobs</div>
          <div className={`value ${fillPercent > 80 ? "warning" : ""}`}>
            {info.activeJobCount}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#555" }}>
            / {info.maxJobs} max ({fillPercent}%)
          </div>
        </div>
        <div className="stat-item">
          <div className="label">Total Submitted</div>
          <div className="value info">{info.totalJobsSubmitted}</div>
        </div>
        <div className="stat-item">
          <div className="label">Completed</div>
          <div className="value">{info.totalJobsCompleted}</div>
        </div>
        <div className="stat-item">
          <div className="label">Success Rate</div>
          <div className="value">
            {info.totalJobsSubmitted > 0
              ? Math.round((info.totalJobsCompleted / info.totalJobsSubmitted) * 100)
              : 0}%
          </div>
        </div>
        <div className="stat-item">
          <div className="label">Timeout</div>
          <div className="value info">{info.processingTimeoutSeconds}s</div>
        </div>
        <div className="stat-item">
          <div className="label">Submit Fee</div>
          <div className={`value ${info.submissionFee > 0 ? "warning" : ""}`}>
            {info.submissionFee > 0 ? `${info.submissionFee} lmp` : "Free"}
          </div>
        </div>
      </div>

      {/* Capacity bar */}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: "0.72rem", color: "#666", marginBottom: 4 }}>
          Queue Capacity
        </div>
        <div
          style={{
            height: 6,
            background: "#12121f",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${fillPercent}%`,
              background:
                fillPercent > 80
                  ? "#ff4757"
                  : fillPercent > 50
                  ? "#ffc107"
                  : "#14f195",
              borderRadius: 3,
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: "0.7rem", color: "#555" }}>
        <span>PDA: {info.address.substring(0, 24)}...</span>
        <span style={{ marginLeft: 16 }}>
          Created: {new Date(info.createdAt * 1000).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
};
