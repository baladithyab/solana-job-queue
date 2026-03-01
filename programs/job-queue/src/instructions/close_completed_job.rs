use anchor_lang::prelude::*;
use crate::state::{JobQueueAccount, JobAccount, JobStatus};
use crate::error::JobQueueError;
use crate::constants::*;

/// Close a terminal job account and reclaim rent.
///
/// ## Web2 Analogy
/// In Redis/BullMQ, completed jobs are auto-removed based on:
/// - removeOnComplete: { count: 1000 } — keeps last 1000 completed
/// - removeOnFail: { count: 500 }
/// - Explicit job.remove()
///
/// On Solana, every account has rent. When we're done with a job,
/// we should close the account to return SOL to the creator.
/// This is an economic incentive that doesn't exist in Web2 — in Redis,
/// old jobs just waste memory. On Solana, not cleaning up wastes real money.
///
/// ## Who Can Close
/// - Creator: can close their own completed/failed/expired jobs
/// - Queue Owner: can force-close any terminal job (garbage collection)
#[derive(Accounts)]
pub struct CloseCompletedJob<'info> {
    #[account(
        seeds = [QUEUE_SEED, queue.owner.as_ref(), queue.name.as_bytes()],
        bump = queue.bump
    )]
    pub queue: Account<'info, JobQueueAccount>,

    #[account(
        mut,
        seeds = [JOB_SEED, queue.key().as_ref(), &job.job_id.to_le_bytes()],
        bump = job.bump,
        constraint = job.queue == queue.key(),
        close = rent_recipient
    )]
    pub job: Account<'info, JobAccount>,

    /// Who can close: the original creator OR the queue owner
    #[account(
        constraint = (
            closer.key() == job.creator || closer.key() == queue.owner
        ) @ JobQueueError::WrongJobOwner
    )]
    pub closer: Signer<'info>,

    /// Rent goes back to the job creator (not necessarily the closer)
    /// CHECK: Just a lamport recipient, validated via creator constraint
    #[account(
        mut,
        constraint = rent_recipient.key() == job.creator
    )]
    pub rent_recipient: AccountInfo<'info>,
}

pub fn handler(ctx: Context<CloseCompletedJob>) -> Result<()> {
    let job = &ctx.accounts.job;
    let clock = Clock::get()?;

    // Job must be in a terminal state
    require!(
        matches!(job.status, JobStatus::Completed | JobStatus::Failed | JobStatus::Expired),
        JobQueueError::JobNotCloseable
    );

    // The `close = rent_recipient` constraint handles account closure and lamport transfer
    // Anchor automatically: transfers lamports, zeroes account data, changes owner

    emit!(JobClosedEvent {
        queue: ctx.accounts.queue.key(),
        job: job.key(),
        job_id: job.job_id,
        closer: ctx.accounts.closer.key(),
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Job #{} account closed by {} — rent reclaimed",
        job.job_id,
        ctx.accounts.closer.key()
    );

    Ok(())
}

#[event]
pub struct JobClosedEvent {
    pub queue: Pubkey,
    pub job: Pubkey,
    pub job_id: u64,
    pub closer: Pubkey,
    pub timestamp: i64,
}
