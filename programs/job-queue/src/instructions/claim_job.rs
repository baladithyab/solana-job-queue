use anchor_lang::prelude::*;
use crate::state::{JobQueueAccount, JobAccount, JobStatus};
use crate::error::JobQueueError;
use crate::constants::*;

/// Claim a pending job for processing.
///
/// ## Design Note (Web2 vs On-Chain)
/// In BullMQ, a worker atomically pops from the "waiting" list using BRPOPLPUSH.
/// This atomic operation is a Redis primitive — it's impossible on Solana because
/// of the account model. Instead, we use optimistic claiming:
///
/// 1. Any processor can call claim_job on any Pending job (they know the job PDA)
/// 2. The job transitions to Processing atomically within the transaction
/// 3. If two processors race, only one transaction will succeed (Solana's single-leader
///    block production ensures exactly-once execution per transaction)
///
/// The key difference: BullMQ's FIFO is enforced by Redis sorted sets. On Solana,
/// we can't enforce ordering (processors must discover and choose which job to claim).
/// This is a tradeoff: we get trustlessness and verifiability at the cost of FIFO order.
#[derive(Accounts)]
pub struct ClaimJob<'info> {
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

    pub processor: Signer<'info>,
}

pub fn handler(ctx: Context<ClaimJob>) -> Result<()> {
    let job = &mut ctx.accounts.job;
    let queue = &ctx.accounts.queue;
    let clock = Clock::get()?;

    // Job must be in Pending state to be claimed
    require!(job.status == JobStatus::Pending, JobQueueError::JobNotPending);

    // Transition to Processing
    job.status = JobStatus::Processing;
    job.processor = Some(ctx.accounts.processor.key());
    job.claimed_at = Some(clock.unix_timestamp);
    job.processing_deadline = Some(
        clock.unix_timestamp
            .checked_add(queue.processing_timeout_seconds)
            .ok_or(JobQueueError::ArithmeticOverflow)?
    );

    emit!(JobClaimedEvent {
        queue: queue.key(),
        job: job.key(),
        job_id: job.job_id,
        processor: ctx.accounts.processor.key(),
        deadline: job.processing_deadline.unwrap(),
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Job #{} claimed by {} | deadline={}",
        job.job_id,
        ctx.accounts.processor.key(),
        job.processing_deadline.unwrap()
    );

    Ok(())
}

#[event]
pub struct JobClaimedEvent {
    pub queue: Pubkey,
    pub job: Pubkey,
    pub job_id: u64,
    pub processor: Pubkey,
    pub deadline: i64,
    pub timestamp: i64,
}
