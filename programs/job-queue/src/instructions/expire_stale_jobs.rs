use anchor_lang::prelude::*;
use crate::state::{JobQueueAccount, JobAccount, JobStatus};
use crate::error::JobQueueError;
use crate::constants::*;

/// Expire stale jobs that exceeded their processing deadline.
///
/// ## Design: The Crank Pattern
/// This is a permissionless "crank" instruction — ANYONE can call it,
/// including automated keepers, bots, or even the original job creator.
///
/// ## Web2 Analogy
/// In BullMQ, stalled job detection runs in a background timer within the worker process:
/// ```javascript
/// // BullMQ internals: checks every stalledInterval milliseconds
/// setInterval(async () => {
///   const stalled = await queue.getStalled();
///   for (const job of stalled) await job.moveToFailed(new Error('stalled'));
/// }, stalledInterval);
/// ```
///
/// On Solana, there are no timers or background processes. Instead, we use
/// the "crank" pattern: a permissionless instruction that anyone can call to
/// advance program state. Keepers earn fees (or SOL from closed accounts) for
/// maintaining liveness.
///
/// ## Key Constraint
/// Solana transactions must specify all accounts upfront, so this instruction
/// only processes ONE job per call. For multiple stale jobs, call it multiple times
/// or create a batch version. This is fundamentally different from BullMQ's
/// batched stall detection.
#[derive(Accounts)]
pub struct ExpireStaleJobs<'info> {
    #[account(
        mut,
        seeds = [QUEUE_SEED, queue.owner.as_ref(), queue.name.as_bytes()],
        bump = queue.bump
    )]
    pub queue: Account<'info, JobQueueAccount>,

    #[account(
        mut,
        seeds = [JOB_SEED, queue.key().as_ref(), &job.job_id.to_le_bytes()],
        bump = job.bump,
        constraint = job.queue == queue.key()
    )]
    pub job: Account<'info, JobAccount>,

    /// Anyone can call this instruction (permissionless crank)
    pub cranker: Signer<'info>,
}

pub fn handler(ctx: Context<ExpireStaleJobs>) -> Result<()> {
    let job = &mut ctx.accounts.job;
    let queue = &mut ctx.accounts.queue;
    let clock = Clock::get()?;

    // Only Processing jobs can be expired
    require!(job.status == JobStatus::Processing, JobQueueError::JobNotProcessing);

    // Check if deadline has passed
    let deadline = job.processing_deadline.ok_or(JobQueueError::JobNotStale)?;
    require!(clock.unix_timestamp > deadline, JobQueueError::JobNotExpired);

    // Transition to Expired
    // In BullMQ this would auto-retry; here we leave it as Expired for explicit handling
    job.status = JobStatus::Expired;
    job.finished_at = Some(clock.unix_timestamp);
    queue.active_job_count = queue.active_job_count.saturating_sub(1);

    emit!(JobExpiredEvent {
        queue: queue.key(),
        job: job.key(),
        job_id: job.job_id,
        processor: job.processor,
        deadline,
        expired_at: clock.unix_timestamp,
        cranker: ctx.accounts.cranker.key(),
    });

    msg!(
        "Job #{} expired | was claimed by {:?} | deadline was {}",
        job.job_id,
        job.processor,
        deadline
    );

    Ok(())
}

#[event]
pub struct JobExpiredEvent {
    pub queue: Pubkey,
    pub job: Pubkey,
    pub job_id: u64,
    pub processor: Option<Pubkey>,
    pub deadline: i64,
    pub expired_at: i64,
    pub cranker: Pubkey,
}
