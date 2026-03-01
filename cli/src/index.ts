#!/usr/bin/env ts-node
/**
 * Job Queue CLI
 *
 * A command-line interface for interacting with the on-chain job queue program.
 *
 * Usage:
 *   ts-node cli/src/index.ts <command> [options]
 *
 * Commands:
 *   create-queue   Create a new job queue
 *   submit-job     Submit a new job to a queue
 *   claim-job      Claim a pending job for processing
 *   complete-job   Mark a job as completed
 *   list-jobs      List jobs in a queue
 *   queue-status   Show queue statistics
 */

import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import chalk from "chalk";

// ─── Config ────────────────────────────────────────────────────────────────

const DEFAULT_RPC = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
const PROGRAM_ID = new PublicKey(
  "JQUEueaEf9oHhPZ8fwNe9MF9GEbVUjSBxPQ2CaFH3jKn"
);

function loadKeypair(keypairPath: string): Keypair {
  const resolved = keypairPath.replace("~", process.env.HOME || "");
  const raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

function loadIDL(): any {
  const idlPath = path.join(__dirname, "../../target/idl/job_queue.json");
  if (!fs.existsSync(idlPath)) {
    console.error(
      chalk.red(
        `IDL not found at ${idlPath}. Run 'anchor build' first.`
      )
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
}

function getProvider(keypairPath: string): anchor.AnchorProvider {
  const connection = new Connection(DEFAULT_RPC, "confirmed");
  const wallet = new anchor.Wallet(loadKeypair(keypairPath));
  return new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
}

function getProgram(provider: anchor.AnchorProvider): anchor.Program {
  const idl = loadIDL();
  return new anchor.Program(idl, provider);
}

function deriveQueuePDA(owner: PublicKey, name: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("queue"), owner.toBuffer(), Buffer.from(name)],
    PROGRAM_ID
  );
  return pda;
}

function deriveJobPDA(queue: PublicKey, jobId: anchor.BN): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(jobId.toString()));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("job"), queue.toBuffer(), buf],
    PROGRAM_ID
  );
  return pda;
}

function hashPayload(data: string): number[] {
  return Array.from(crypto.createHash("sha256").update(data).digest());
}

function formatStatus(status: any): string {
  if (status.pending) return chalk.yellow("⏳ Pending");
  if (status.processing) return chalk.blue("⚙️  Processing");
  if (status.completed) return chalk.green("✅ Completed");
  if (status.failed) return chalk.red("❌ Failed");
  if (status.expired) return chalk.gray("⏰ Expired");
  return chalk.gray("Unknown");
}

function formatTimestamp(ts: anchor.BN | null): string {
  if (!ts) return "—";
  return new Date(ts.toNumber() * 1000).toISOString();
}

// ─── CLI Commands ──────────────────────────────────────────────────────────

const program = new Command();

program
  .name("job-queue")
  .description("CLI for the on-chain Solana job queue")
  .version("0.1.0")
  .option(
    "-k, --keypair <path>",
    "Path to keypair JSON file",
    "~/.config/solana/id.json"
  );

// ── create-queue ──────────────────────────────────────────────────────────

program
  .command("create-queue")
  .description("Create a new job queue")
  .requiredOption("-n, --name <name>", "Queue name (max 64 chars)")
  .option("-m, --max-jobs <n>", "Max concurrent jobs", "100")
  .option(
    "-t, --timeout <seconds>",
    "Processing timeout in seconds",
    "300"
  )
  .option("-f, --fee <lamports>", "Submission fee in lamports", "0")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent!.opts();
    const provider = getProvider(globalOpts.keypair);
    const prog = getProgram(provider);

    console.log(chalk.bold("\n🏗️  Creating queue..."));
    console.log(`  Name:    ${chalk.cyan(opts.name)}`);
    console.log(`  Max jobs: ${opts.maxJobs}`);
    console.log(`  Timeout:  ${opts.timeout}s`);
    console.log(`  Fee:      ${opts.fee} lamports\n`);

    const owner = provider.wallet.publicKey;
    const queuePDA = deriveQueuePDA(owner, opts.name);

    try {
      const tx = await prog.methods
        .createQueue(
          opts.name,
          parseInt(opts.maxJobs),
          new anchor.BN(opts.timeout),
          new anchor.BN(opts.fee)
        )
        .accounts({
          queue: queuePDA,
          owner,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log(chalk.green("✅ Queue created!"));
      console.log(`  Queue PDA: ${chalk.cyan(queuePDA.toString())}`);
      console.log(
        `  TX: ${chalk.dim(`https://explorer.solana.com/tx/${tx}?cluster=devnet`)}`
      );
    } catch (e: any) {
      console.error(chalk.red(`❌ Error: ${e.message}`));
      process.exit(1);
    }
  });

// ── queue-status ──────────────────────────────────────────────────────────

program
  .command("queue-status")
  .description("Show queue statistics")
  .requiredOption("-n, --name <name>", "Queue name")
  .option("-o, --owner <pubkey>", "Queue owner pubkey (defaults to wallet)")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent!.opts();
    const provider = getProvider(globalOpts.keypair);
    const prog = getProgram(provider);

    const owner = opts.owner
      ? new PublicKey(opts.owner)
      : provider.wallet.publicKey;
    const queuePDA = deriveQueuePDA(owner, opts.name);

    try {
      const queue = await prog.account.jobQueueAccount.fetch(queuePDA);

      console.log(chalk.bold(`\n📊 Queue: ${chalk.cyan(queue.name)}`));
      console.log(`  Address:     ${chalk.dim(queuePDA.toString())}`);
      console.log(`  Owner:       ${chalk.dim(queue.owner.toString())}`);
      console.log(`  Status:      ${queue.paused ? chalk.red("⏸️  Paused") : chalk.green("▶️  Active")}`);
      console.log(`  Active Jobs: ${chalk.yellow(queue.activeJobCount)} / ${queue.maxJobs}`);
      console.log(`  Total Submitted: ${queue.totalJobsSubmitted.toString()}`);
      console.log(`  Total Completed: ${chalk.green(queue.totalJobsCompleted.toString())}`);
      console.log(`  Timeout:     ${queue.processingTimeoutSeconds.toString()}s`);
      console.log(`  Submit Fee:  ${queue.submissionFee.toString()} lamports`);
      console.log(`  Fees Collected: ${(queue.totalFeesCollected.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      console.log(`  Created:     ${formatTimestamp(queue.createdAt)}`);
    } catch (e: any) {
      console.error(chalk.red(`❌ Error: ${e.message}`));
      process.exit(1);
    }
  });

// ── submit-job ────────────────────────────────────────────────────────────

program
  .command("submit-job")
  .description("Submit a new job to a queue")
  .requiredOption("-q, --queue <name>", "Queue name")
  .requiredOption("-i, --job-id <n>", "Job ID (unique within queue)")
  .requiredOption("-p, --payload <data>", "Job payload (will be hashed)")
  .option("--priority <n>", "Priority 0-255 (higher = more urgent)", "50")
  .option("--max-retries <n>", "Max retry attempts", "3")
  .option("-o, --owner <pubkey>", "Queue owner pubkey (defaults to wallet)")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent!.opts();
    const provider = getProvider(globalOpts.keypair);
    const prog = getProgram(provider);

    const creator = provider.wallet.publicKey;
    const owner = opts.owner ? new PublicKey(opts.owner) : creator;
    const queuePDA = deriveQueuePDA(owner, opts.queue);
    const jobId = new anchor.BN(opts.jobId);
    const jobPDA = deriveJobPDA(queuePDA, jobId);
    const payloadHash = hashPayload(opts.payload);

    console.log(chalk.bold("\n📬 Submitting job..."));
    console.log(`  Queue: ${chalk.cyan(opts.queue)}`);
    console.log(`  Job ID: ${opts.jobId}`);
    console.log(`  Payload hash: ${chalk.dim(Buffer.from(payloadHash).toString("hex").substring(0, 16) + "...")}`);
    console.log(`  Priority: ${opts.priority}`);
    console.log(`  Max retries: ${opts.maxRetries}\n`);

    try {
      const tx = await prog.methods
        .submitJob(
          jobId,
          payloadHash,
          Buffer.byteLength(opts.payload),
          parseInt(opts.maxRetries),
          parseInt(opts.priority)
        )
        .accounts({
          queue: queuePDA,
          job: jobPDA,
          creator,
          feeRecipient: owner,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log(chalk.green("✅ Job submitted!"));
      console.log(`  Job PDA: ${chalk.cyan(jobPDA.toString())}`);
      console.log(`  TX: ${chalk.dim(`https://explorer.solana.com/tx/${tx}?cluster=devnet`)}`);
    } catch (e: any) {
      console.error(chalk.red(`❌ Error: ${e.message}`));
      process.exit(1);
    }
  });

// ── claim-job ─────────────────────────────────────────────────────────────

program
  .command("claim-job")
  .description("Claim a pending job for processing")
  .requiredOption("-q, --queue <name>", "Queue name")
  .requiredOption("-i, --job-id <n>", "Job ID to claim")
  .option("-o, --owner <pubkey>", "Queue owner pubkey (defaults to wallet)")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent!.opts();
    const provider = getProvider(globalOpts.keypair);
    const prog = getProgram(provider);

    const processor = provider.wallet.publicKey;
    const owner = opts.owner ? new PublicKey(opts.owner) : processor;
    const queuePDA = deriveQueuePDA(owner, opts.queue);
    const jobId = new anchor.BN(opts.jobId);
    const jobPDA = deriveJobPDA(queuePDA, jobId);

    console.log(chalk.bold(`\n🔒 Claiming job #${opts.jobId}...`));

    try {
      const tx = await prog.methods
        .claimJob()
        .accounts({
          queue: queuePDA,
          job: jobPDA,
          processor,
        })
        .rpc();

      const job = await prog.account.jobAccount.fetch(jobPDA);

      console.log(chalk.green("✅ Job claimed!"));
      console.log(`  Processor: ${chalk.cyan(processor.toString())}`);
      console.log(`  Deadline:  ${formatTimestamp(job.processingDeadline)}`);
      console.log(`  TX: ${chalk.dim(`https://explorer.solana.com/tx/${tx}?cluster=devnet`)}`);
    } catch (e: any) {
      console.error(chalk.red(`❌ Error: ${e.message}`));
      process.exit(1);
    }
  });

// ── complete-job ──────────────────────────────────────────────────────────

program
  .command("complete-job")
  .description("Mark a claimed job as completed")
  .requiredOption("-q, --queue <name>", "Queue name")
  .requiredOption("-i, --job-id <n>", "Job ID")
  .requiredOption("-r, --result <data>", "Result data (will be hashed)")
  .option("-o, --owner <pubkey>", "Queue owner pubkey (defaults to wallet)")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent!.opts();
    const provider = getProvider(globalOpts.keypair);
    const prog = getProgram(provider);

    const processor = provider.wallet.publicKey;
    const owner = opts.owner ? new PublicKey(opts.owner) : processor;
    const queuePDA = deriveQueuePDA(owner, opts.queue);
    const jobId = new anchor.BN(opts.jobId);
    const jobPDA = deriveJobPDA(queuePDA, jobId);
    const resultHash = hashPayload(opts.result);

    console.log(chalk.bold(`\n✅ Completing job #${opts.jobId}...`));

    try {
      const tx = await prog.methods
        .completeJob(resultHash)
        .accounts({
          queue: queuePDA,
          job: jobPDA,
          processor,
        })
        .rpc();

      console.log(chalk.green("✅ Job completed!"));
      console.log(`  Result hash: ${chalk.dim(Buffer.from(resultHash).toString("hex").substring(0, 16) + "...")}`);
      console.log(`  TX: ${chalk.dim(`https://explorer.solana.com/tx/${tx}?cluster=devnet`)}`);
    } catch (e: any) {
      console.error(chalk.red(`❌ Error: ${e.message}`));
      process.exit(1);
    }
  });

// ── list-jobs ─────────────────────────────────────────────────────────────

program
  .command("list-jobs")
  .description("List jobs in a queue")
  .requiredOption("-q, --queue <name>", "Queue name")
  .option("-i, --job-ids <ids>", "Comma-separated list of job IDs to fetch")
  .option("-s, --status <status>", "Filter by status: pending|processing|completed|failed|expired")
  .option("-o, --owner <pubkey>", "Queue owner pubkey (defaults to wallet)")
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent!.opts();
    const provider = getProvider(globalOpts.keypair);
    const prog = getProgram(provider);

    const owner = opts.owner
      ? new PublicKey(opts.owner)
      : provider.wallet.publicKey;
    const queuePDA = deriveQueuePDA(owner, opts.queue);

    console.log(chalk.bold(`\n📋 Jobs in queue: ${chalk.cyan(opts.queue)}\n`));

    try {
      // Fetch specific job IDs if provided
      if (opts.jobIds) {
        const ids = opts.jobIds.split(",").map((id: string) => parseInt(id.trim()));

        for (const id of ids) {
          try {
            const jobId = new anchor.BN(id);
            const jobPDA = deriveJobPDA(queuePDA, jobId);
            const job = await prog.account.jobAccount.fetch(jobPDA);

            const statusStr = formatStatus(job.status);
            if (opts.status && !Object.keys(job.status)[0].includes(opts.status)) {
              continue;
            }

            console.log(
              `  [#${id}] ${statusStr.padEnd(20)} | priority: ${job.priority} | retries: ${job.retryCount}/${job.maxRetries}`
            );
            console.log(
              `         submitted: ${formatTimestamp(job.submittedAt)} | claimed: ${formatTimestamp(job.claimedAt)}`
            );
            if (job.processor) {
              console.log(`         processor: ${chalk.dim(job.processor.toString())}`);
            }
            console.log("");
          } catch (e) {
            console.log(`  [#${id}] ${chalk.red("Not found or closed")}`);
          }
        }
      } else {
        // Fetch all job accounts for this queue using memcmp filter
        const accounts = await prog.account.jobAccount.all([
          {
            memcmp: {
              offset: 8, // after discriminator
              bytes: queuePDA.toBase58(),
            },
          },
        ]);

        if (accounts.length === 0) {
          console.log(chalk.dim("  No jobs found."));
          return;
        }

        const filtered = opts.status
          ? accounts.filter((a) => Object.keys(a.account.status)[0] === opts.status)
          : accounts;

        filtered
          .sort((a, b) => a.account.jobId.cmp(b.account.jobId))
          .forEach(({ account: job }) => {
            const statusStr = formatStatus(job.status);
            console.log(
              `  [#${job.jobId}] ${statusStr.padEnd(20)} | priority: ${job.priority} | retries: ${job.retryCount}/${job.maxRetries}`
            );
          });
      }
    } catch (e: any) {
      console.error(chalk.red(`❌ Error: ${e.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
