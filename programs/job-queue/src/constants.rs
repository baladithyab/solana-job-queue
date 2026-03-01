/// Seeds for PDA derivation
pub const QUEUE_SEED: &[u8] = b"queue";
pub const JOB_SEED: &[u8] = b"job";

/// Maximum name length for a queue
pub const MAX_QUEUE_NAME_LEN: usize = 64;

/// Maximum number of jobs allowed per queue (can be overridden per queue)
pub const GLOBAL_MAX_JOBS: u32 = 10_000;

/// Maximum processing timeout in seconds (24 hours)
pub const MAX_PROCESSING_TIMEOUT: i64 = 86_400;

/// Minimum processing timeout in seconds (10 seconds)
pub const MIN_PROCESSING_TIMEOUT: i64 = 10;

/// Maximum retries per job
pub const MAX_JOB_RETRIES: u8 = 10;

/// Maximum priority level (0 = lowest, 255 = highest)
pub const MAX_PRIORITY: u8 = 255;
