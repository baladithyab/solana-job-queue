use anchor_lang::prelude::*;

/// The state machine for a single job.
///
/// ## State Transitions (Web2 Analogy → BullMQ states)
///
/// ```
/// Pending ──────────► Processing ──────► Completed
///    ▲                    │                   │
///    │                    │ (fail_job)         │ (close_completed_job)
///    │                    ▼                   ▼
///    └──(retry)──── Failed         [account closed, rent reclaimed]
///                       │
///                       ▼
///                   Expired (via expire_stale_jobs crank)
/// ```
///
/// BullMQ equivalent states:
/// - Pending   → "waiting"
/// - Processing → "active"
/// - Completed → "completed"
/// - Failed    → "failed"
/// - Expired   → "stalled" (then moved to failed in BullMQ, stays separate here)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum JobStatus {
    /// Job is waiting to be claimed by a processor.
    /// In BullMQ: "waiting" state, stored in sorted set bull:{q}:wait
    Pending = 0,

    /// Job is actively being processed by a worker.
    /// In BullMQ: "active" state, stored in list bull:{q}:active
    Processing = 1,

    /// Job completed successfully.
    /// In BullMQ: "completed" state
    Completed = 2,

    /// Job failed (max retries exhausted or explicitly failed).
    /// In BullMQ: "failed" state
    Failed = 3,

    /// Job was not completed within the processing_timeout window.
    /// In BullMQ: "stalled" → auto-moved to failed
    Expired = 4,
}

impl Default for JobStatus {
    fn default() -> Self {
        JobStatus::Pending
    }
}

/// A single job account.
///
/// ## PDA Derivation
/// seeds = ["job", queue_pubkey, job_id.to_le_bytes()]
///
/// ## Web2 Analogy
/// In Redis/BullMQ, a job is stored as:
/// - Hash: bull:{queue}:{job_id} with fields (name, data, opts, timestamp, etc.)
/// - Entry in sorted set: bull:{queue}:wait (score = priority/timestamp)
///
/// On Solana, each job is a separate PDA account with O(1) lookup by queue + job_id.
/// This trades Redis's memory efficiency for deterministic addressing and trustlessness.
#[account]
#[derive(Default)]
pub struct JobAccount {
    /// The queue this job belongs to
    pub queue: Pubkey,

    /// Unique sequential job ID within the queue
    pub job_id: u64,

    /// The account that submitted this job (pays for account rent)
    pub creator: Pubkey,

    /// The account currently processing this job (None if Pending)
    pub processor: Option<Pubkey>,

    /// SHA-256 hash of the off-chain payload (stored in Arweave/IPFS/API)
    /// Analogous to Bull's job.data field, but we store only a verifiable hash
    pub payload_hash: [u8; 32],

    /// Size of the off-chain payload in bytes (for informational purposes)
    pub payload_size: u32,

    /// Optional hash of the job result (set on completion)
    pub result_hash: Option<[u8; 32]>,

    /// Current state in the state machine
    pub status: JobStatus,

    /// Number of times this job has been retried
    pub retry_count: u8,

    /// Maximum retry attempts before marking as permanently failed
    pub max_retries: u8,

    /// Job priority (higher = processed first by well-behaved processors)
    /// Analogous to Bull's priority option
    pub priority: u8,

    /// Unix timestamp when job was submitted
    pub submitted_at: i64,

    /// Unix timestamp when processing started (None if not yet claimed)
    pub claimed_at: Option<i64>,

    /// Unix timestamp when job was completed/failed/expired
    pub finished_at: Option<i64>,

    /// Deadline by which the job must be completed (submitted_at + timeout)
    pub processing_deadline: Option<i64>,

    /// Failure reason code (app-defined)
    pub failure_reason: Option<u8>,

    /// Bump seed for PDA validation
    pub bump: u8,
}

impl JobAccount {
    /// Fixed account size
    pub const SIZE: usize =
        8 +   // discriminator
        32 +  // queue
        8 +   // job_id
        32 +  // creator
        (1 + 32) + // processor: Option<Pubkey>
        32 +  // payload_hash
        4 +   // payload_size
        (1 + 32) + // result_hash: Option<[u8; 32]>
        1 +   // status (enum as u8)
        1 +   // retry_count
        1 +   // max_retries
        1 +   // priority
        8 +   // submitted_at
        (1 + 8) + // claimed_at: Option<i64>
        (1 + 8) + // finished_at: Option<i64>
        (1 + 8) + // processing_deadline: Option<i64>
        (1 + 1) + // failure_reason: Option<u8>
        1;    // bump
    // Total: ~192 bytes
}
