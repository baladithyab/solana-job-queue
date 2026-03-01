use anchor_lang::prelude::*;
use crate::state::{JobQueueAccount, JobAccount, JobStatus};
use crate::error::JobQueueError;
use crate::constants::*;

/// Fail a job being processed.
///
/// ## Retry Logic (Web2 Analogy)
/// In BullMQ, failed jobs with remaining attempts are automatically re-queued.
/// On Solana, we implement the same logic:
/// - If retry_count < max_retries: reset to Pending, increment retry_count
/// - If retry_count == max_retries: mark as permanently Failed
///
/// The key difference: BullMQ uses exponential backoff timing automatically.
/// On Solana, immediate re-queuing is the default. Time-based backoff would
/// require a separate "scheduled" queue or keeper program.
#[derive(Accounts)]
pub struct FailJob<'info> {
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

    /// Only the processor who claimed the job can fail it
    #[account(
        constraint = processor.key() == job.processor.unwrap_or_default() @ JobQueueError::WrongProcessor
    )]
    pub processor: Signer<'info>,
}

pub fn handler(ctx: Context<FailJob>, reason_code: u8) -> Result<()> {
    let job = &mut ctx.accounts.job;
    let queue = &mut ctx.accounts.queue;
    let clock = Clock::get()?;

    require!(job.status == JobStatus::Processing, JobQueueError::JobNotProcessing);

    job.failure_reason = Some(reason_code);
    job.retry_count = job.retry_count.saturating_add(1);

    if job.retry_count <= job.max_retries {
        // Re-queue: transition back to Pending for another processor to pick up
        // Analogous to BullMQ's "attempts" option
        job.status = JobStatus::Pending;
        job.processor = None;
        job.claimed_at = None;
        job.processing_deadline = None;

        emit!(JobRetriedEvent {
            queue: queue.key(),
            job: job.key(),
            job_id: job.job_id,
            retry_count: job.retry_count,
            max_retries: job.max_retries,
            reason_code,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Job #{} failed, re-queued (attempt {}/{})",
            job.job_id,
            job.retry_count,
            job.max_retries
        );
    } else {
        // Max retries exceeded — permanently failed
        job.status = JobStatus::Failed;
        job.finished_at = Some(clock.unix_timestamp);
        queue.active_job_count = queue.active_job_count.saturating_sub(1);

        emit!(JobFailedEvent {
            queue: queue.key(),
            job: job.key(),
            job_id: job.job_id,
            retry_count: job.retry_count,
            reason_code,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Job #{} permanently failed after {} retries",
            job.job_id,
            job.retry_count
        );
    }

    Ok(())
}

#[event]
pub struct JobRetriedEvent {
    pub queue: Pubkey,
    pub job: Pubkey,
    pub job_id: u64,
    pub retry_count: u8,
    pub max_retries: u8,
    pub reason_code: u8,
    pub timestamp: i64,
}

#[event]
pub struct JobFailedEvent {
    pub queue: Pubkey,
    pub job: Pubkey,
    pub job_id: u64,
    pub retry_count: u8,
    pub reason_code: u8,
    pub timestamp: i64,
}
