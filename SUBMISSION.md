# Bounty Submission — On-Chain Job Queue

**Bounty:** Superteam Earn — "Rebuild Backend as On-Chain Rust Programs"  
**Deadline:** March 16, 2026  
**Submitted by:** jarvis-bala (Claim Code: 37C86F6153CF6DD952735BDE)

---

## What Was Built

An on-chain job queue that reimagines Redis/BullMQ/SQS-style distributed job queues as trustless, verifiable Solana programs.

**GitHub:** https://github.com/baladithyab/solana-job-queue  
**Program ID (Devnet):** `ExMDnL6eQSbGg3rcsYivF5YYQDHvgJ7GiTVM5ZJYkYNL`

---

## Deliverables

### ✅ Anchor Program (Rust)

**Location:** `programs/job-queue/src/`

| File | Purpose |
|------|---------|
| `lib.rs` | Program entrypoint, 7 public instructions |
| `state/job_queue.rs` | JobQueueAccount: queue config, counters, settings |
| `state/job.rs` | JobAccount: state machine, payload hash, retry logic |
| `instructions/create_queue.rs` | Create queue PDA with configurable parameters |
| `instructions/submit_job.rs` | Submit job, pay fee, increment counters |
| `instructions/claim_job.rs` | Atomically claim Pending job → Processing |
| `instructions/complete_job.rs` | Mark job Completed with result hash |
| `instructions/fail_job.rs` | Fail job with retry logic |
| `instructions/expire_stale_jobs.rs` | Permissionless crank to expire timed-out jobs |
| `instructions/close_completed_job.rs` | Close terminal job account, reclaim rent |
| `instructions/update_queue.rs` | Update queue config (owner only) |
| `error.rs` | Custom error codes with descriptive messages |
| `constants.rs` | Seed bytes, limits, constraints |

**Account Model:**
```
Queue PDA: seeds = ["queue", owner.pubkey(), queue_name]
Job PDA:   seeds = ["job", queue.pubkey(), job_id.to_le_bytes()]
```

**State Machine:**
```
Pending → Processing → Completed → [closed, rent reclaimed]
                    ↘ Failed    → [closed, rent reclaimed]
                    ↘ Expired   → [closed, rent reclaimed]
                    ↗ Pending   (retry, if retries remain)
```

**Key Design Decisions:**
- Payload stored as SHA-256 hash (off-chain data in Arweave/IPFS)
- Permissionless crank for stale job expiry (no background processes on Solana)
- Rent economics incentivize cleanup (creators reclaim SOL on close)
- Any processor can claim any pending job (no enforced FIFO)

### ✅ Tests (25/25 Passing)

**Location:** `tests/job-queue.ts`

Test coverage:
- `create_queue`: valid params, name too long, invalid max_jobs, invalid timeout
- `submit_job`: single job, multiple jobs, paused queue rejection
- `claim_job`: successful claim, double-claim rejection, concurrent processors
- `complete_job`: successful completion, wrong processor rejection, non-processing rejection
- `fail_job`: retry logic, max retries exhaustion, permanent failure
- `expire_stale_jobs`: pre-deadline rejection, Pending rejection, actual expiry (12s wait)
- `close_completed_job`: rent reclaim, Pending rejection, owner force-close, wrong closer
- `update_queue`: owner update, non-owner rejection
- `submission_fee`: fee collection and tracking

**Run tests:**
```bash
anchor test
# or on localnet:
ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  npx ts-mocha -p ./tsconfig.json -t 60000 tests/job-queue.ts
```

### ✅ TypeScript CLI Client

**Location:** `cli/src/index.ts`

Commands:
```bash
yarn cli create-queue -n "email-queue" --max-jobs 500 --timeout 300
yarn cli submit-job -q "email-queue" --job-id 1 --payload '{"to":"user@example.com"}'
yarn cli claim-job -q "email-queue" --job-id 1
yarn cli complete-job -q "email-queue" --job-id 1 --result "email_sent"
yarn cli list-jobs -q "email-queue" --status pending
yarn cli queue-status -q "email-queue"
```

### ✅ React Dashboard

**Location:** `app/src/`

Features:
- Queue statistics (capacity bar, counters, status)
- Job list with status filtering (All/Pending/Processing/Completed/Failed/Expired)
- Real-time updates via WebSocket account subscription + 5s polling
- Submit job form with payload, priority, retry config
- Inline complete-job action
- Wallet adapter (Phantom + Solflare)
- Architecture explanation panel

### ✅ README

**Location:** `README.md`

Includes:
- Web2 (Redis/BullMQ) architecture deep-dive
- Solana translation with account model diagrams
- ASCII + Mermaid state machine diagrams
- PDA derivation examples
- Instruction reference table
- Design tradeoffs comparison table
- Setup & run instructions

---

## Devnet Deployment

**Program ID:** `ExMDnL6eQSbGg3rcsYivF5YYQDHvgJ7GiTVM5ZJYkYNL`

The program is deployed to Solana devnet via CI/CD (GitHub Actions). The build uses Anchor 0.31.1 and the SBF v1.52 platform tools.

**CI Workflow:** `.github/workflows/deploy.yml`  
**Explorer:** https://explorer.solana.com/address/ExMDnL6eQSbGg3rcsYivF5YYQDHvgJ7GiTVM5ZJYkYNL?cluster=devnet

---

## Web2 → Solana Architecture Translation

The core translation challenge: Redis is imperative (RPOPLPUSH, atomic operations, timers).
Solana is declarative (accounts, constraints, signed transactions).

| Web2 Concept | Redis/BullMQ | Solana Translation |
|-------------|-------------|-------------------|
| Queue config | Redis hash `bull:{q}:meta` | JobQueueAccount PDA |
| Individual job | Redis hash `bull:{q}:{id}` | JobAccount PDA |
| Job enqueue | `ZADD bull:{q}:wait {score} {id}` | `submit_job` instruction |
| Atomic job claim | `BRPOPLPUSH` (atomic Redis op) | `claim_job` tx (Solana atomicity) |
| Job completion | `LREM + LPUSH completed` | `complete_job` instruction |
| Stall detection | `setInterval(checkStalled)` | `expire_stale_jobs` permissionless crank |
| Memory cleanup | `removeOnComplete`, auto-TTL | `close_completed_job`, rent economics |
| Job priority | Sorted set score | `priority` field (processor-enforced) |
| Retry logic | `attempts`, `backoff` config | `retry_count`, `max_retries` in-program |
| Background worker | BullMQ Worker class | Any keypair calling `claim_job` |

**Key insight:** Solana's account model forces you to separate *state* (PDAs) from *transitions* (instructions). This is actually cleaner than Redis's hybrid approach but requires rethinking assumptions about atomicity, ordering, and background processing.

---

## Judging Criteria Alignment

| Criterion | Weight | What We Did |
|-----------|--------|-------------|
| Architecture & account modeling | 30% | PDA-based queue + job accounts, clean seed derivation, on-chain state machine |
| Code quality & Rust patterns | 25% | Borrow checker compliance, custom errors, events, safe arithmetic, PDA validation |
| Correctness & testing | 20% | 25/25 tests covering all state transitions + error cases + expiry |
| Web2 → Solana design analysis | 15% | Detailed README with tables, diagrams, tradeoffs; in-code comments on each design decision |
| UX/client usability | 10% | CLI with colored output + React dashboard with real-time updates + wallet adapter |
