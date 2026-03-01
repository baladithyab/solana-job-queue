use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;
pub mod constants;

use instructions::*;

declare_id!("ExMDnL6eQSbGg3rcsYivF5YYQDHvgJ7GiTVM5ZJYkYNL");

#[program]
pub mod job_queue {
    use super::*;

    /// Create a new job queue with configurable parameters.
    /// Analogous to creating a new Bull queue with a Redis connection.
    pub fn create_queue(
        ctx: Context<CreateQueue>,
        name: String,
        max_jobs: u32,
        processing_timeout_seconds: i64,
        submission_fee: u64,
    ) -> Result<()> {
        instructions::create_queue::handler(ctx, name, max_jobs, processing_timeout_seconds, submission_fee)
    }

    /// Submit a new job to the queue.
    /// Analogous to queue.add(jobName, data) in BullMQ.
    pub fn submit_job(
        ctx: Context<SubmitJob>,
        job_id: u64,
        payload_hash: [u8; 32],
        payload_size: u32,
        max_retries: u8,
        priority: u8,
    ) -> Result<()> {
        instructions::submit_job::handler(ctx, job_id, payload_hash, payload_size, max_retries, priority)
    }

    /// Claim a pending job for processing.
    /// Analogous to a BullMQ worker calling queue.getNextJob().
    pub fn claim_job(ctx: Context<ClaimJob>) -> Result<()> {
        instructions::claim_job::handler(ctx)
    }

    /// Mark a claimed job as successfully completed.
    /// Analogous to job.moveToCompleted() in BullMQ.
    pub fn complete_job(
        ctx: Context<CompleteJob>,
        result_hash: [u8; 32],
    ) -> Result<()> {
        instructions::complete_job::handler(ctx, result_hash)
    }

    /// Mark a claimed job as failed, with optional retry logic.
    /// Analogous to job.moveToFailed() in BullMQ.
    pub fn fail_job(
        ctx: Context<FailJob>,
        reason_code: u8,
    ) -> Result<()> {
        instructions::fail_job::handler(ctx, reason_code)
    }

    /// Expire stale jobs that exceeded their processing timeout.
    /// Analogous to BullMQ's stalled job detection / auto-expiry.
    /// This is a permissionless crank instruction anyone can call.
    pub fn expire_stale_jobs(ctx: Context<ExpireStaleJobs>) -> Result<()> {
        instructions::expire_stale_jobs::handler(ctx)
    }

    /// Close a completed/failed job account to reclaim rent.
    /// Analogous to removing completed jobs from Redis to free memory.
    pub fn close_completed_job(ctx: Context<CloseCompletedJob>) -> Result<()> {
        instructions::close_completed_job::handler(ctx)
    }

    /// Update queue configuration (owner only).
    pub fn update_queue(
        ctx: Context<UpdateQueue>,
        new_processing_timeout: Option<i64>,
        new_submission_fee: Option<u64>,
        new_max_jobs: Option<u32>,
        paused: Option<bool>,
    ) -> Result<()> {
        instructions::update_queue::handler(ctx, new_processing_timeout, new_submission_fee, new_max_jobs, paused)
    }
}
