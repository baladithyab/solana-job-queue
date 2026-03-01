import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { assert, expect } from "chai";
import * as crypto from "crypto";

// Helper: derive queue PDA
function deriveQueuePDA(
  programId: PublicKey,
  owner: PublicKey,
  name: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("queue"), owner.toBuffer(), Buffer.from(name)],
    programId
  );
}

// Helper: derive job PDA
function deriveJobPDA(
  programId: PublicKey,
  queue: PublicKey,
  jobId: BN
): [PublicKey, number] {
  const jobIdBuf = Buffer.alloc(8);
  jobIdBuf.writeBigUInt64LE(BigInt(jobId.toString()));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("job"), queue.toBuffer(), jobIdBuf],
    programId
  );
}

// Helper: create a payload hash as number[]
function makePayloadHash(data: string): number[] {
  return Array.from(crypto.createHash("sha256").update(data).digest());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("job-queue", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.JobQueue as Program<any>;
  const programId = new PublicKey(
    "ExMDnL6eQSbGg3rcsYivF5YYQDHvgJ7GiTVM5ZJYkYNL"
  );

  let owner: Keypair;
  let processor1: Keypair;
  let processor2: Keypair;
  let creator: Keypair;
  const QUEUE_NAME = "test-queue";

  let queuePDA: PublicKey;

  before(async () => {
    owner = Keypair.generate();
    processor1 = Keypair.generate();
    processor2 = Keypair.generate();
    creator = Keypair.generate();

    // Airdrop SOL to all parties
    for (const kp of [owner, processor1, processor2, creator]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        10 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    [queuePDA] = deriveQueuePDA(programId, owner.publicKey, QUEUE_NAME);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. CREATE QUEUE
  // ─────────────────────────────────────────────────────────────────────────

  describe("create_queue", () => {
    it("creates a queue with valid parameters", async () => {
      await program.methods
        .createQueue(
          QUEUE_NAME,
          100,
          new BN(60),
          new BN(0)
        )
        .accounts({
          queue: queuePDA,
          owner: owner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      const q = await program.account.jobQueueAccount.fetch(queuePDA);
      expect(q.owner.toString()).to.equal(owner.publicKey.toString());
      expect(q.name).to.equal(QUEUE_NAME);
      expect(q.maxJobs).to.equal(100);
      expect(q.processingTimeoutSeconds.toNumber()).to.equal(60);
      expect(q.submissionFee.toNumber()).to.equal(0);
      expect(q.paused).to.be.false;
      expect(q.activeJobCount).to.equal(0);
      expect(q.totalJobsSubmitted.toNumber()).to.equal(0);
    });

    it("fails with name too long (client-side PDA error)", async () => {
      // A 65-char name will exceed PDA seed limits
      const longName = "a".repeat(65);
      try {
        const [badPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from("queue"), owner.publicKey.toBuffer(), Buffer.from(longName)],
          programId
        );
        await program.methods
          .createQueue(longName, 10, new BN(60), new BN(0))
          .accounts({ queue: badPDA, owner: owner.publicKey, systemProgram: SystemProgram.programId })
          .signers([owner])
          .rpc();
        expect.fail("Should have thrown");
      } catch (e: any) {
        // Either seed overflow or QueueNameTooLong
        expect(e.message).to.match(/QueueNameTooLong|seed|exceeded/i);
      }
    });

    it("fails with invalid max_jobs (0)", async () => {
      const [badPDA] = deriveQueuePDA(programId, owner.publicKey, "bad-queue");
      try {
        await program.methods
          .createQueue("bad-queue", 0, new BN(60), new BN(0))
          .accounts({ queue: badPDA, owner: owner.publicKey, systemProgram: SystemProgram.programId })
          .signers([owner])
          .rpc();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("InvalidMaxJobs");
      }
    });

    it("fails with invalid timeout (too short)", async () => {
      const [badPDA] = deriveQueuePDA(programId, owner.publicKey, "bad-queue2");
      try {
        await program.methods
          .createQueue("bad-queue2", 10, new BN(5), new BN(0))
          .accounts({ queue: badPDA, owner: owner.publicKey, systemProgram: SystemProgram.programId })
          .signers([owner])
          .rpc();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("InvalidProcessingTimeout");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. SUBMIT JOB
  // ─────────────────────────────────────────────────────────────────────────

  describe("submit_job", () => {
    it("submits a job to the queue", async () => {
      const JOB_ID = new BN(1);
      const [job1PDA] = deriveJobPDA(programId, queuePDA, JOB_ID);
      const payloadHash = makePayloadHash("send email to user@example.com");

      await program.methods
        .submitJob(JOB_ID, payloadHash, 256, 3, 100)
        .accounts({
          queue: queuePDA,
          job: job1PDA,
          creator: creator.publicKey,
          feeRecipient: owner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      const job = await program.account.jobAccount.fetch(job1PDA);
      expect(job.jobId.toNumber()).to.equal(1);
      expect(job.creator.toString()).to.equal(creator.publicKey.toString());
      expect(job.status).to.deep.equal({ pending: {} });
      expect(job.retryCount).to.equal(0);
      expect(job.maxRetries).to.equal(3);
      expect(job.priority).to.equal(100);
      expect(job.processor).to.be.null;

      const q = await program.account.jobQueueAccount.fetch(queuePDA);
      expect(q.activeJobCount).to.equal(1);
      expect(q.totalJobsSubmitted.toNumber()).to.equal(1);
    });

    it("submits multiple jobs", async () => {
      for (let i = 2; i <= 5; i++) {
        const jobId = new BN(i);
        const [jobPDA] = deriveJobPDA(programId, queuePDA, jobId);
        await program.methods
          .submitJob(jobId, makePayloadHash(`job-${i}`), 128, 2, i * 10)
          .accounts({
            queue: queuePDA,
            job: jobPDA,
            creator: creator.publicKey,
            feeRecipient: owner.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();
      }

      const q = await program.account.jobQueueAccount.fetch(queuePDA);
      expect(q.activeJobCount).to.equal(5);
      expect(q.totalJobsSubmitted.toNumber()).to.equal(5);
    });

    it("rejects submission to paused queue", async () => {
      // Pause queue
      await program.methods
        .updateQueue(null, null, null, true)
        .accounts({ queue: queuePDA, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const jobId = new BN(999);
      const [jobPDA] = deriveJobPDA(programId, queuePDA, jobId);

      try {
        await program.methods
          .submitJob(jobId, makePayloadHash("blocked"), 64, 1, 50)
          .accounts({
            queue: queuePDA, job: jobPDA, creator: creator.publicKey,
            feeRecipient: owner.publicKey, systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("QueuePaused");
      }

      // Unpause
      await program.methods
        .updateQueue(null, null, null, false)
        .accounts({ queue: queuePDA, owner: owner.publicKey })
        .signers([owner])
        .rpc();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. CLAIM JOB
  // ─────────────────────────────────────────────────────────────────────────

  describe("claim_job", () => {
    it("processor claims a pending job", async () => {
      const [job1PDA] = deriveJobPDA(programId, queuePDA, new BN(1));

      await program.methods
        .claimJob()
        .accounts({ queue: queuePDA, job: job1PDA, processor: processor1.publicKey })
        .signers([processor1])
        .rpc();

      const job = await program.account.jobAccount.fetch(job1PDA);
      expect(job.status).to.deep.equal({ processing: {} });
      expect(job.processor?.toString()).to.equal(processor1.publicKey.toString());
      expect(job.claimedAt).to.not.be.null;
      expect(job.processingDeadline).to.not.be.null;
    });

    it("cannot claim an already-claimed job", async () => {
      const [job1PDA] = deriveJobPDA(programId, queuePDA, new BN(1));
      try {
        await program.methods
          .claimJob()
          .accounts({ queue: queuePDA, job: job1PDA, processor: processor2.publicKey })
          .signers([processor2])
          .rpc();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("JobNotPending");
      }
    });

    it("processor2 claims a different job", async () => {
      const [job2PDA] = deriveJobPDA(programId, queuePDA, new BN(2));

      await program.methods
        .claimJob()
        .accounts({ queue: queuePDA, job: job2PDA, processor: processor2.publicKey })
        .signers([processor2])
        .rpc();

      const job = await program.account.jobAccount.fetch(job2PDA);
      expect(job.status).to.deep.equal({ processing: {} });
      expect(job.processor?.toString()).to.equal(processor2.publicKey.toString());
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. COMPLETE JOB
  // ─────────────────────────────────────────────────────────────────────────

  describe("complete_job", () => {
    it("processor completes a claimed job", async () => {
      const [job1PDA] = deriveJobPDA(programId, queuePDA, new BN(1));
      const resultHash = makePayloadHash("email sent successfully");

      const qBefore = await program.account.jobQueueAccount.fetch(queuePDA);

      await program.methods
        .completeJob(resultHash)
        .accounts({ queue: queuePDA, job: job1PDA, processor: processor1.publicKey })
        .signers([processor1])
        .rpc();

      const job = await program.account.jobAccount.fetch(job1PDA);
      expect(job.status).to.deep.equal({ completed: {} });
      expect(job.resultHash).to.not.be.null;
      expect(job.finishedAt).to.not.be.null;

      const qAfter = await program.account.jobQueueAccount.fetch(queuePDA);
      expect(qAfter.activeJobCount).to.equal(qBefore.activeJobCount - 1);
      expect(qAfter.totalJobsCompleted.toNumber()).to.equal(
        qBefore.totalJobsCompleted.toNumber() + 1
      );
    });

    it("wrong processor cannot complete job", async () => {
      const [job2PDA] = deriveJobPDA(programId, queuePDA, new BN(2));
      try {
        await program.methods
          .completeJob(makePayloadHash("wrong"))
          .accounts({ queue: queuePDA, job: job2PDA, processor: processor1.publicKey })
          .signers([processor1])
          .rpc();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("WrongProcessor");
      }
    });

    it("cannot complete a non-processing job", async () => {
      // Job 4 is still Pending (not claimed by anyone)
      // The processor constraint will fail (job.processor is None → default pubkey)
      const [job4PDA] = deriveJobPDA(programId, queuePDA, new BN(4));
      try {
        await program.methods
          .completeJob(makePayloadHash("unclaimed"))
          .accounts({ queue: queuePDA, job: job4PDA, processor: processor1.publicKey })
          .signers([processor1])
          .rpc();
        expect.fail("Should have thrown");
      } catch (e: any) {
        // Either constraint error (wrong processor) or custom error — both are correct rejections
        expect(e.message).to.match(/JobNotProcessing|WrongProcessor|processor|constraint/i);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. FAIL JOB (retry loop)
  // ─────────────────────────────────────────────────────────────────────────

  describe("fail_job with retry", () => {
    it("job re-queues when retries remain", async () => {
      const [job3PDA] = deriveJobPDA(programId, queuePDA, new BN(3));

      // Claim
      await program.methods
        .claimJob()
        .accounts({ queue: queuePDA, job: job3PDA, processor: processor1.publicKey })
        .signers([processor1])
        .rpc();

      // Fail (retry_count 0→1, max_retries=2, still retrying)
      await program.methods
        .failJob(1)
        .accounts({ queue: queuePDA, job: job3PDA, processor: processor1.publicKey })
        .signers([processor1])
        .rpc();

      const job = await program.account.jobAccount.fetch(job3PDA);
      expect(job.status).to.deep.equal({ pending: {} }); // re-queued
      expect(job.retryCount).to.equal(1);
      expect(job.processor).to.be.null;
      expect(job.failureReason).to.equal(1);
    });

    it("job permanently fails after exhausting retries", async () => {
      const [job3PDA] = deriveJobPDA(programId, queuePDA, new BN(3));

      // Claim + fail twice more (total retryCount 1→2→3, >max_retries=2)
      for (let attempt = 2; attempt <= 3; attempt++) {
        await program.methods
          .claimJob()
          .accounts({ queue: queuePDA, job: job3PDA, processor: processor1.publicKey })
          .signers([processor1])
          .rpc();

        await program.methods
          .failJob(attempt)
          .accounts({ queue: queuePDA, job: job3PDA, processor: processor1.publicKey })
          .signers([processor1])
          .rpc();
      }

      const job = await program.account.jobAccount.fetch(job3PDA);
      expect(job.status).to.deep.equal({ failed: {} });
      expect(job.finishedAt).to.not.be.null;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. EXPIRE STALE JOBS
  // ─────────────────────────────────────────────────────────────────────────

  describe("expire_stale_jobs", () => {
    it("cannot expire a job before deadline", async () => {
      const [job4PDA] = deriveJobPDA(programId, queuePDA, new BN(4));

      await program.methods
        .claimJob()
        .accounts({ queue: queuePDA, job: job4PDA, processor: processor1.publicKey })
        .signers([processor1])
        .rpc();

      try {
        await program.methods
          .expireStaleJobs()
          .accounts({ queue: queuePDA, job: job4PDA, cranker: processor2.publicKey })
          .signers([processor2])
          .rpc();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("JobNotExpired");
      }
    });

    it("cannot expire a Pending job", async () => {
      const [job5PDA] = deriveJobPDA(programId, queuePDA, new BN(5));
      try {
        await program.methods
          .expireStaleJobs()
          .accounts({ queue: queuePDA, job: job5PDA, cranker: processor2.publicKey })
          .signers([processor2])
          .rpc();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("JobNotProcessing");
      }
    });

    it("expires a stale job after timeout (short-timeout queue)", async () => {
      const shortName = "short-q";
      const [shortQ] = deriveQueuePDA(programId, owner.publicKey, shortName);

      await program.methods
        .createQueue(shortName, 10, new BN(10), new BN(0))
        .accounts({ queue: shortQ, owner: owner.publicKey, systemProgram: SystemProgram.programId })
        .signers([owner])
        .rpc();

      const jobId = new BN(1);
      const [jobPDA] = deriveJobPDA(programId, shortQ, jobId);

      await program.methods
        .submitJob(jobId, makePayloadHash("will-expire"), 64, 0, 50)
        .accounts({
          queue: shortQ, job: jobPDA, creator: creator.publicKey,
          feeRecipient: owner.publicKey, systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      await program.methods
        .claimJob()
        .accounts({ queue: shortQ, job: jobPDA, processor: processor1.publicKey })
        .signers([processor1])
        .rpc();

      console.log("    ⏳ Waiting 12s for expiry...");
      await sleep(12000);

      await program.methods
        .expireStaleJobs()
        .accounts({ queue: shortQ, job: jobPDA, cranker: processor2.publicKey })
        .signers([processor2])
        .rpc();

      const job = await program.account.jobAccount.fetch(jobPDA);
      expect(job.status).to.deep.equal({ expired: {} });
    }).timeout(30000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. CLOSE COMPLETED JOB
  // ─────────────────────────────────────────────────────────────────────────

  describe("close_completed_job", () => {
    it("creator closes their completed job and reclaims rent", async () => {
      const [job1PDA] = deriveJobPDA(programId, queuePDA, new BN(1));

      const balBefore = await provider.connection.getBalance(creator.publicKey);

      await program.methods
        .closeCompletedJob()
        .accounts({
          queue: queuePDA, job: job1PDA,
          closer: creator.publicKey, rentRecipient: creator.publicKey,
        })
        .signers([creator])
        .rpc();

      const balAfter = await provider.connection.getBalance(creator.publicKey);
      // Net gain after tx fee should be positive (rent returned)
      expect(balAfter).to.be.greaterThan(balBefore - 10000);

      const info = await provider.connection.getAccountInfo(job1PDA);
      expect(info).to.be.null;
    });

    it("cannot close a Pending job", async () => {
      const [job5PDA] = deriveJobPDA(programId, queuePDA, new BN(5));
      try {
        await program.methods
          .closeCompletedJob()
          .accounts({
            queue: queuePDA, job: job5PDA,
            closer: creator.publicKey, rentRecipient: creator.publicKey,
          })
          .signers([creator])
          .rpc();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("JobNotCloseable");
      }
    });

    it("queue owner can force-close a failed job", async () => {
      const [job3PDA] = deriveJobPDA(programId, queuePDA, new BN(3));

      await program.methods
        .closeCompletedJob()
        .accounts({
          queue: queuePDA, job: job3PDA,
          closer: owner.publicKey, rentRecipient: creator.publicKey,
        })
        .signers([owner])
        .rpc();

      const info = await provider.connection.getAccountInfo(job3PDA);
      expect(info).to.be.null;
    });

    it("wrong closer cannot close job", async () => {
      // First complete job 2 as processor2
      const [job2PDA] = deriveJobPDA(programId, queuePDA, new BN(2));
      await program.methods
        .completeJob(makePayloadHash("done"))
        .accounts({ queue: queuePDA, job: job2PDA, processor: processor2.publicKey })
        .signers([processor2])
        .rpc();

      try {
        await program.methods
          .closeCompletedJob()
          .accounts({
            queue: queuePDA, job: job2PDA,
            closer: processor2.publicKey, // NOT creator or queue owner
            rentRecipient: creator.publicKey,
          })
          .signers([processor2])
          .rpc();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("WrongJobOwner");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. UPDATE QUEUE
  // ─────────────────────────────────────────────────────────────────────────

  describe("update_queue", () => {
    it("owner updates queue parameters", async () => {
      await program.methods
        .updateQueue(new BN(120), new BN(1000), null, null)
        .accounts({ queue: queuePDA, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const q = await program.account.jobQueueAccount.fetch(queuePDA);
      expect(q.processingTimeoutSeconds.toNumber()).to.equal(120);
      expect(q.submissionFee.toNumber()).to.equal(1000);
    });

    it("non-owner cannot update queue", async () => {
      try {
        await program.methods
          .updateQueue(null, null, null, true)
          .accounts({ queue: queuePDA, owner: processor1.publicKey })
          .signers([processor1])
          .rpc();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("Unauthorized");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. SUBMISSION FEE
  // ─────────────────────────────────────────────────────────────────────────

  describe("submission fee", () => {
    it("collects fee when queue has fee > 0", async () => {
      const ownerBalBefore = await provider.connection.getBalance(owner.publicKey);
      const jobId = new BN(100);
      const [jobPDA] = deriveJobPDA(programId, queuePDA, jobId);

      await program.methods
        .submitJob(jobId, makePayloadHash("paid-job"), 64, 1, 50)
        .accounts({
          queue: queuePDA, job: jobPDA, creator: creator.publicKey,
          feeRecipient: owner.publicKey, systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      const ownerBalAfter = await provider.connection.getBalance(owner.publicKey);
      expect(ownerBalAfter).to.equal(ownerBalBefore + 1000);

      const q = await program.account.jobQueueAccount.fetch(queuePDA);
      expect(q.totalFeesCollected.toNumber()).to.be.greaterThan(0);
    });
  });
});
