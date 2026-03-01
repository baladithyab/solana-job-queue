use anchor_lang::prelude::*;
use crate::state::JobQueueAccount;
use crate::error::JobQueueError;
use crate::constants::*;

#[derive(Accounts)]
#[instruction(name: String)]
pub struct CreateQueue<'info> {
    #[account(
        init,
        payer = owner,
        space = JobQueueAccount::MAX_SIZE,
        seeds = [QUEUE_SEED, owner.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub queue: Account<'info, JobQueueAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateQueue>,
    name: String,
    max_jobs: u32,
    processing_timeout_seconds: i64,
    submission_fee: u64,
) -> Result<()> {
    // Validate inputs
    require!(name.len() <= MAX_QUEUE_NAME_LEN, JobQueueError::QueueNameTooLong);
    require!(name.len() > 0, JobQueueError::QueueNameTooLong);
    require!(
        max_jobs >= 1 && max_jobs <= GLOBAL_MAX_JOBS,
        JobQueueError::InvalidMaxJobs
    );
    require!(
        processing_timeout_seconds >= MIN_PROCESSING_TIMEOUT
            && processing_timeout_seconds <= MAX_PROCESSING_TIMEOUT,
        JobQueueError::InvalidProcessingTimeout
    );

    let queue = &mut ctx.accounts.queue;
    let clock = Clock::get()?;

    queue.owner = ctx.accounts.owner.key();
    queue.name = name;
    queue.bump = ctx.bumps.queue;
    queue.max_jobs = max_jobs;
    queue.active_job_count = 0;
    queue.total_jobs_submitted = 0;
    queue.total_jobs_completed = 0;
    queue.total_fees_collected = 0;
    queue.processing_timeout_seconds = processing_timeout_seconds;
    queue.submission_fee = submission_fee;
    queue.paused = false;
    queue.created_at = clock.unix_timestamp;
    queue.callback_program = None;
    queue._padding = [0u8; 32];

    emit!(QueueCreatedEvent {
        queue: queue.key(),
        owner: queue.owner,
        name: queue.name.clone(),
        max_jobs,
        processing_timeout_seconds,
        submission_fee,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Queue '{}' created by {} | max_jobs={} timeout={}s fee={}",
        queue.name,
        queue.owner,
        max_jobs,
        processing_timeout_seconds,
        submission_fee
    );

    Ok(())
}

#[event]
pub struct QueueCreatedEvent {
    pub queue: Pubkey,
    pub owner: Pubkey,
    pub name: String,
    pub max_jobs: u32,
    pub processing_timeout_seconds: i64,
    pub submission_fee: u64,
    pub timestamp: i64,
}
