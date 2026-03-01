import { useState, useEffect, useCallback, useRef } from "react";
import * as anchor from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import * as crypto from "crypto";

// The deployed program ID
const PROGRAM_ID = new PublicKey(
  "JQUEueaEf9oHhPZ8fwNe9MF9GEbVUjSBxPQ2CaFH3jKn"
);

export type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "expired";

export interface QueueInfo {
  address: string;
  owner: string;
  name: string;
  activeJobCount: number;
  maxJobs: number;
  totalJobsSubmitted: number;
  totalJobsCompleted: number;
  processingTimeoutSeconds: number;
  submissionFee: number;
  paused: boolean;
  createdAt: number;
}

export interface JobInfo {
  address: string;
  jobId: number;
  creator: string;
  processor: string | null;
  status: JobStatus;
  priority: number;
  retryCount: number;
  maxRetries: number;
  submittedAt: number;
  claimedAt: number | null;
  finishedAt: number | null;
  processingDeadline: number | null;
  payloadHash: string;
  resultHash: string | null;
}

function deriveQueuePDA(owner: PublicKey, name: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("queue"), owner.toBuffer(), Buffer.from(name)],
    PROGRAM_ID
  );
  return pda;
}

function deriveJobPDA(queue: PublicKey, jobId: number): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(jobId));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("job"), queue.toBuffer(), buf],
    PROGRAM_ID
  );
  return pda;
}

function parseJobStatus(status: any): JobStatus {
  if (status.pending !== undefined) return "pending";
  if (status.processing !== undefined) return "processing";
  if (status.completed !== undefined) return "completed";
  if (status.failed !== undefined) return "failed";
  if (status.expired !== undefined) return "expired";
  return "pending";
}

function hashPayload(data: string): number[] {
  return Array.from(crypto.createHash("sha256").update(data).digest());
}

export function useJobQueue(queueName: string, queueOwner?: PublicKey) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [program, setProgram] = useState<anchor.Program | null>(null);
  const [queueInfo, setQueueInfo] = useState<QueueInfo | null>(null);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subscriptionRef = useRef<number | null>(null);

  // Initialize program
  useEffect(() => {
    if (!wallet.publicKey) return;

    const loadProgram = async () => {
      try {
        const idl = await anchor.Program.fetchIdl(PROGRAM_ID, {
          connection,
        } as any);
        if (!idl) {
          setError("Failed to fetch IDL from chain. Is the program deployed?");
          return;
        }
        const provider = new anchor.AnchorProvider(connection, wallet as any, {
          commitment: "confirmed",
        });
        const prog = new anchor.Program(idl, provider);
        setProgram(prog);
      } catch (e: any) {
        setError(`Failed to initialize program: ${e.message}`);
      }
    };

    loadProgram();
  }, [wallet.publicKey, connection]);

  const owner = queueOwner || wallet.publicKey;

  const fetchQueueData = useCallback(async () => {
    if (!program || !owner || !queueName) return;

    setLoading(true);
    setError(null);

    try {
      const queuePDA = deriveQueuePDA(owner, queueName);
      const queue = await program.account.jobQueueAccount.fetch(queuePDA);

      setQueueInfo({
        address: queuePDA.toString(),
        owner: queue.owner.toString(),
        name: queue.name,
        activeJobCount: queue.activeJobCount,
        maxJobs: queue.maxJobs,
        totalJobsSubmitted: queue.totalJobsSubmitted.toNumber(),
        totalJobsCompleted: queue.totalJobsCompleted.toNumber(),
        processingTimeoutSeconds: queue.processingTimeoutSeconds.toNumber(),
        submissionFee: queue.submissionFee.toNumber(),
        paused: queue.paused,
        createdAt: queue.createdAt.toNumber(),
      });

      // Fetch all jobs for this queue
      const jobAccounts = await program.account.jobAccount.all([
        {
          memcmp: {
            offset: 8,
            bytes: queuePDA.toBase58(),
          },
        },
      ]);

      const jobList: JobInfo[] = jobAccounts.map(({ publicKey, account }) => ({
        address: publicKey.toString(),
        jobId: account.jobId.toNumber(),
        creator: account.creator.toString(),
        processor: account.processor?.toString() ?? null,
        status: parseJobStatus(account.status),
        priority: account.priority,
        retryCount: account.retryCount,
        maxRetries: account.maxRetries,
        submittedAt: account.submittedAt.toNumber(),
        claimedAt: account.claimedAt?.toNumber() ?? null,
        finishedAt: account.finishedAt?.toNumber() ?? null,
        processingDeadline: account.processingDeadline?.toNumber() ?? null,
        payloadHash: Buffer.from(account.payloadHash).toString("hex"),
        resultHash: account.resultHash
          ? Buffer.from(account.resultHash).toString("hex")
          : null,
      }));

      setJobs(jobList.sort((a, b) => b.jobId - a.jobId));
    } catch (e: any) {
      setError(`Failed to fetch queue: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [program, owner, queueName]);

  // Subscribe to program events for real-time updates
  useEffect(() => {
    if (!program || !owner || !queueName) return;

    const queuePDA = deriveQueuePDA(owner, queueName);

    // Subscribe to account changes on the queue account
    const subId = connection.onAccountChange(
      queuePDA,
      () => {
        fetchQueueData();
      },
      "confirmed"
    );

    subscriptionRef.current = subId;

    return () => {
      connection.removeAccountChangeListener(subId);
    };
  }, [program, owner, queueName, connection, fetchQueueData]);

  // Initial load
  useEffect(() => {
    fetchQueueData();
  }, [fetchQueueData]);

  // Poll for job updates every 5s
  useEffect(() => {
    const interval = setInterval(fetchQueueData, 5000);
    return () => clearInterval(interval);
  }, [fetchQueueData]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const submitJob = useCallback(
    async (jobId: number, payload: string, priority: number, maxRetries: number) => {
      if (!program || !wallet.publicKey || !owner) throw new Error("Not connected");

      const queuePDA = deriveQueuePDA(owner, queueName);
      const jobPDA = deriveJobPDA(queuePDA, jobId);
      const payloadHash = hashPayload(payload);

      const tx = await program.methods
        .submitJob(
          new anchor.BN(jobId),
          payloadHash,
          Buffer.byteLength(payload),
          maxRetries,
          priority
        )
        .accounts({
          queue: queuePDA,
          job: jobPDA,
          creator: wallet.publicKey,
          feeRecipient: owner,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await fetchQueueData();
      return tx;
    },
    [program, wallet.publicKey, owner, queueName, fetchQueueData]
  );

  const claimJob = useCallback(
    async (jobId: number) => {
      if (!program || !wallet.publicKey || !owner) throw new Error("Not connected");

      const queuePDA = deriveQueuePDA(owner, queueName);
      const jobPDA = deriveJobPDA(queuePDA, jobId);

      const tx = await program.methods
        .claimJob()
        .accounts({
          queue: queuePDA,
          job: jobPDA,
          processor: wallet.publicKey,
        })
        .rpc();

      await fetchQueueData();
      return tx;
    },
    [program, wallet.publicKey, owner, queueName, fetchQueueData]
  );

  const completeJob = useCallback(
    async (jobId: number, result: string) => {
      if (!program || !wallet.publicKey || !owner) throw new Error("Not connected");

      const queuePDA = deriveQueuePDA(owner, queueName);
      const jobPDA = deriveJobPDA(queuePDA, jobId);
      const resultHash = hashPayload(result);

      const tx = await program.methods
        .completeJob(resultHash)
        .accounts({
          queue: queuePDA,
          job: jobPDA,
          processor: wallet.publicKey,
        })
        .rpc();

      await fetchQueueData();
      return tx;
    },
    [program, wallet.publicKey, owner, queueName, fetchQueueData]
  );

  return {
    queueInfo,
    jobs,
    loading,
    error,
    submitJob,
    claimJob,
    completeJob,
    refresh: fetchQueueData,
  };
}
