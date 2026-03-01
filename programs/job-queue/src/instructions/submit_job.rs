use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{JobQueueAccount, JobAccount, JobStatus};
use crate::error::JobQueueError;
use crate::constants::*;

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct SubmitJob<'info> {
    #[account(
        mut,
        seeds = [QUEUE_SEED, queue.owner.as_ref(), queue.name.as_bytes()],
        bump = queue.bump
    )]
    pub queue: Account<'info, JobQueueAccount>,

    #[account(
        init,
        payer = creator,
        space = JobAccount::SIZE,
        seeds = [JOB_SEED, queue.key().as_ref(), &job_id.to_le_bytes()],
        bump
    )]
    pub job: Account<'info, JobAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,

    /// Optional: queue owner receives the submission fee
    /// CHECK: Validated to be queue owner in instruction logic
    #[account(
        mut,
        constraint = fee_recipient.key() == queue.owner @ JobQueueError::Unauthorized
    )]
    pub fee_recipient: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SubmitJob>,
    job_id: u64,
    payload_hash: [u8; 32],
    payload_size: u32,
    max_retries: u8,
    priority: u8,
) -> Result<()> {
    let clock = Clock::get()?;

    // Validate queue state
    require!(!ctx.accounts.queue.paused, JobQueueError::QueuePaused);
    require!(ctx.accounts.queue.active_job_count < ctx.accounts.queue.max_jobs, JobQueueError::QueueFull);
    require!(max_retries <= MAX_JOB_RETRIES, JobQueueError::MaxRetriesExceeded);

    // Cache values we need before mutable borrow
    let queue_key = ctx.accounts.queue.key();
    let submission_fee = ctx.accounts.queue.submission_fee;
    let queue_name = ctx.accounts.queue.name.clone();

    // Collect submission fee if required
    if submission_fee > 0 {
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.fee_recipient.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, submission_fee)?;
    }

    // Update queue counters
    let queue = &mut ctx.accounts.queue;
    if submission_fee > 0 {
        queue.total_fees_collected = queue
            .total_fees_collected
            .checked_add(submission_fee)
            .ok_or(JobQueueError::ArithmeticOverflow)?;
    }
    queue.active_job_count = queue
        .active_job_count
        .checked_add(1)
        .ok_or(JobQueueError::ArithmeticOverflow)?;
    queue.total_jobs_submitted = queue
        .total_jobs_submitted
        .checked_add(1)
        .ok_or(JobQueueError::ArithmeticOverflow)?;

    // Initialize job account
    let job = &mut ctx.accounts.job;
    job.queue = queue_key;
    job.job_id = job_id;
    job.creator = ctx.accounts.creator.key();
    job.processor = None;
    job.payload_hash = payload_hash;
    job.payload_size = payload_size;
    job.result_hash = None;
    job.status = JobStatus::Pending;
    job.retry_count = 0;
    job.max_retries = max_retries;
    job.priority = priority;
    job.submitted_at = clock.unix_timestamp;
    job.claimed_at = None;
    job.finished_at = None;
    job.processing_deadline = None;
    job.failure_reason = None;
    job.bump = ctx.bumps.job;

    let job_key = job.key();
    let job_creator = job.creator;

    emit!(JobSubmittedEvent {
        queue: queue_key,
        job: job_key,
        job_id,
        creator: job_creator,
        priority,
        max_retries,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Job #{} submitted to queue '{}' | priority={} max_retries={}",
        job_id,
        queue_name,
        priority,
        max_retries
    );

    Ok(())
}

#[event]
pub struct JobSubmittedEvent {
    pub queue: Pubkey,
    pub job: Pubkey,
    pub job_id: u64,
    pub creator: Pubkey,
    pub priority: u8,
    pub max_retries: u8,
    pub timestamp: i64,
}
