use anchor_lang::prelude::*;
use crate::state::{JobQueueAccount, JobAccount, JobStatus};
use crate::error::JobQueueError;
use crate::constants::*;

#[derive(Accounts)]
pub struct CompleteJob<'info> {
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

    /// Only the processor who claimed the job can complete it
    #[account(
        constraint = processor.key() == job.processor.unwrap_or_default() @ JobQueueError::WrongProcessor
    )]
    pub processor: Signer<'info>,
}

pub fn handler(ctx: Context<CompleteJob>, result_hash: [u8; 32]) -> Result<()> {
    let job = &mut ctx.accounts.job;
    let queue = &mut ctx.accounts.queue;
    let clock = Clock::get()?;

    // Job must be in Processing state
    require!(job.status == JobStatus::Processing, JobQueueError::JobNotProcessing);

    // Check if job is still within deadline (allow completion even if slightly past for grace)
    // In production you might want a small grace period

    // Transition to Completed
    job.status = JobStatus::Completed;
    job.result_hash = Some(result_hash);
    job.finished_at = Some(clock.unix_timestamp);

    // Update queue counters
    queue.active_job_count = queue.active_job_count.saturating_sub(1);
    queue.total_jobs_completed = queue
        .total_jobs_completed
        .checked_add(1)
        .ok_or(crate::error::JobQueueError::ArithmeticOverflow)?;

    emit!(JobCompletedEvent {
        queue: queue.key(),
        job: job.key(),
        job_id: job.job_id,
        processor: ctx.accounts.processor.key(),
        result_hash,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Job #{} completed by {} | result_hash={:?}",
        job.job_id,
        ctx.accounts.processor.key(),
        &result_hash[..8]
    );

    Ok(())
}

#[event]
pub struct JobCompletedEvent {
    pub queue: Pubkey,
    pub job: Pubkey,
    pub job_id: u64,
    pub processor: Pubkey,
    pub result_hash: [u8; 32],
    pub timestamp: i64,
}
