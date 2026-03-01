use anchor_lang::prelude::*;
use crate::state::JobQueueAccount;
use crate::error::JobQueueError;
use crate::constants::*;

#[derive(Accounts)]
pub struct UpdateQueue<'info> {
    #[account(
        mut,
        seeds = [QUEUE_SEED, queue.owner.as_ref(), queue.name.as_bytes()],
        bump = queue.bump,
        constraint = owner.key() == queue.owner @ JobQueueError::Unauthorized
    )]
    pub queue: Account<'info, JobQueueAccount>,

    pub owner: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateQueue>,
    new_processing_timeout: Option<i64>,
    new_submission_fee: Option<u64>,
    new_max_jobs: Option<u32>,
    paused: Option<bool>,
) -> Result<()> {
    let queue = &mut ctx.accounts.queue;

    if let Some(timeout) = new_processing_timeout {
        require!(
            timeout >= MIN_PROCESSING_TIMEOUT && timeout <= MAX_PROCESSING_TIMEOUT,
            JobQueueError::InvalidProcessingTimeout
        );
        queue.processing_timeout_seconds = timeout;
    }

    if let Some(fee) = new_submission_fee {
        queue.submission_fee = fee;
    }

    if let Some(max_jobs) = new_max_jobs {
        require!(
            max_jobs >= 1 && max_jobs <= GLOBAL_MAX_JOBS,
            JobQueueError::InvalidMaxJobs
        );
        queue.max_jobs = max_jobs;
    }

    if let Some(is_paused) = paused {
        queue.paused = is_paused;
        if is_paused {
            msg!("Queue '{}' paused", queue.name);
        } else {
            msg!("Queue '{}' resumed", queue.name);
        }
    }

    emit!(QueueUpdatedEvent {
        queue: queue.key(),
        owner: queue.owner,
        processing_timeout_seconds: queue.processing_timeout_seconds,
        submission_fee: queue.submission_fee,
        max_jobs: queue.max_jobs,
        paused: queue.paused,
    });

    Ok(())
}

#[event]
pub struct QueueUpdatedEvent {
    pub queue: Pubkey,
    pub owner: Pubkey,
    pub processing_timeout_seconds: i64,
    pub submission_fee: u64,
    pub max_jobs: u32,
    pub paused: bool,
}
