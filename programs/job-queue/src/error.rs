use anchor_lang::prelude::*;

#[error_code]
pub enum JobQueueError {
    // Queue errors
    #[msg("Queue name exceeds maximum length of 64 characters")]
    QueueNameTooLong,

    #[msg("Queue is full — max job capacity reached")]
    QueueFull,

    #[msg("Queue is paused — no new jobs can be submitted")]
    QueuePaused,

    #[msg("Invalid max jobs: must be between 1 and 10,000")]
    InvalidMaxJobs,

    #[msg("Processing timeout must be between 10 seconds and 86,400 seconds (24h)")]
    InvalidProcessingTimeout,

    #[msg("Unauthorized: only the queue owner can perform this action")]
    Unauthorized,

    // Job errors
    #[msg("Job is not in the Pending state — cannot be claimed")]
    JobNotPending,

    #[msg("Job is not in the Processing state — cannot be completed or failed")]
    JobNotProcessing,

    #[msg("Job must be Completed, Failed, or Expired to be closed")]
    JobNotCloseable,

    #[msg("Job has not yet exceeded its processing timeout")]
    JobNotExpired,

    #[msg("Job is not stale — processing deadline has not passed")]
    JobNotStale,

    #[msg("Only the processor who claimed the job can complete or fail it")]
    WrongProcessor,

    #[msg("Max retries exceeded maximum allowed value of 10")]
    MaxRetriesExceeded,

    #[msg("Only the job creator can close their completed job")]
    WrongJobOwner,

    // Fee errors
    #[msg("Insufficient fee — must send at least the queue submission fee")]
    InsufficientFee,

    // Arithmetic errors
    #[msg("Arithmetic overflow in job count or fee calculation")]
    ArithmeticOverflow,

    // CPI errors
    #[msg("Callback CPI invocation failed")]
    CallbackFailed,
}
