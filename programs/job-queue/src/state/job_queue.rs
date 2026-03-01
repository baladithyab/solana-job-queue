use anchor_lang::prelude::*;
use crate::constants::MAX_QUEUE_NAME_LEN;

/// On-chain representation of a job queue.
///
/// ## Web2 Analogy
/// In Redis/BullMQ, queue metadata is stored as Redis keys:
/// - `bull:{queue}:meta` (JSON string with queue config)
/// - `bull:{queue}:stalled-check` (timestamp)
///
/// On Solana, we use a PDA account with deterministic address:
/// seeds = ["queue", owner, queue_name]
///
/// ## Account Space
/// Discriminator: 8 bytes
/// owner: 32 bytes (Pubkey)
/// name: 4 + 64 bytes (String with length prefix)
/// authority_bump: 1 byte
/// max_jobs: 4 bytes (u32)
/// active_job_count: 4 bytes (u32)
/// total_jobs_submitted: 8 bytes (u64)
/// total_jobs_completed: 8 bytes (u64)
/// total_fees_collected: 8 bytes (u64)
/// processing_timeout_seconds: 8 bytes (i64)
/// submission_fee: 8 bytes (u64)
/// paused: 1 byte (bool)
/// created_at: 8 bytes (i64)
/// bump: 1 byte
/// padding: 64 bytes (for future use)
/// Total: ~233 bytes
#[account]
#[derive(Default)]
pub struct JobQueueAccount {
    /// The owner/admin of this queue
    pub owner: Pubkey,

    /// Human-readable name for the queue (e.g., "email-notifications", "image-processing")
    pub name: String,

    /// The queue's bump seed for PDA validation
    pub bump: u8,

    /// Maximum number of active (pending + processing) jobs at once
    /// Analogous to Bull's concurrency limit
    pub max_jobs: u32,

    /// Number of currently active (Pending or Processing) jobs
    pub active_job_count: u32,

    /// Lifetime total jobs submitted to this queue
    pub total_jobs_submitted: u64,

    /// Lifetime total jobs completed successfully
    pub total_jobs_completed: u64,

    /// Total SOL fees collected (in lamports)
    pub total_fees_collected: u64,

    /// How long a processor has to complete a job before it's considered stale
    /// Analogous to Bull's lockDuration / stalledInterval
    pub processing_timeout_seconds: i64,

    /// Fee in lamports required to submit a job (0 = free)
    /// Spam prevention mechanism — analogous to API rate limiting
    pub submission_fee: u64,

    /// Whether the queue is accepting new jobs
    /// Analogous to queue.pause() in BullMQ
    pub paused: bool,

    /// Unix timestamp when this queue was created
    pub created_at: i64,

    /// Optional callback program ID to invoke on job completion
    /// Analogous to BullMQ's completion event listener
    pub callback_program: Option<Pubkey>,

    /// Reserved space for future fields
    pub _padding: [u8; 32],
}

impl JobQueueAccount {
    /// Calculate the account size for a given queue name length
    pub fn size(name_len: usize) -> usize {
        8 +  // discriminator
        32 + // owner
        4 + name_len + // name (String)
        1 +  // bump
        4 +  // max_jobs
        4 +  // active_job_count
        8 +  // total_jobs_submitted
        8 +  // total_jobs_completed
        8 +  // total_fees_collected
        8 +  // processing_timeout_seconds
        8 +  // submission_fee
        1 +  // paused
        8 +  // created_at
        1 + 32 + // callback_program (Option<Pubkey>)
        32   // _padding
    }

    /// Capped size using MAX_QUEUE_NAME_LEN
    pub const MAX_SIZE: usize = 8 + 32 + (4 + MAX_QUEUE_NAME_LEN) + 1 + 4 + 4 + 8 + 8 + 8 + 8 + 8 + 1 + 8 + (1 + 32) + 32;
}
