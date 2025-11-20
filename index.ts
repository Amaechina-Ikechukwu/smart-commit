#!/usr/bin/env bun
import { GoogleGenerativeAI } from "@google/generative-ai";
import { execSync, spawnSync } from "node:child_process"; // Bun supports node built-ins
import inquirer from "inquirer";
import ora from "ora";

// 1. Configuration (Bun loads .env automatically)
const API_KEY = Bun.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error("❌ Error: GEMINI_API_KEY is missing from your .env file.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);

async function main() {
  try {
    // 2. Verify Git Repo
    try {
      execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
    } catch {
      console.error("❌ Error: This is not a git repository.");
      return;
    }

    // 3. Get the Git Diff (With Fixes)
    // FIX A: Exclude lockfiles so they don't pollute the context
    const exclusions = [
      ":(exclude)package-lock.json",
      ":(exclude)yarn.lock",
      ":(exclude)bun.lockb",
      ":(exclude)pnpm-lock.yaml",
    ];
    
    const diffCommand = `git diff --cached -- . ${exclusions.join(" ")}`;

    // FIX B: Increase buffer to 10MB to prevent crash on large files
    const diff = execSync(diffCommand, { 
      maxBuffer: 1024 * 1024 * 10,
      encoding: 'utf-8' 
    });

    if (!diff.trim()) {
      console.log("⚠️  No staged changes found (excluding lockfiles).");
      
      const addAnswer = await inquirer.prompt([
        {
          type: "confirm",
          name: "autoAdd",
          message: "Would you like to stage all changes (git add *)?",
          default: false,
        },
      ]);

      if (addAnswer.autoAdd) {
        try {
          const addSpinner = ora("Staging all changes...").start();
          execSync("git add *", { stdio: "ignore" });
          addSpinner.succeed("All changes staged!");
          
          // Re-fetch the diff after staging
          const newDiff = execSync(diffCommand, { 
            maxBuffer: 1024 * 1024 * 10,
            encoding: 'utf-8' 
          });
          
          if (!newDiff.trim()) {
            console.log("⚠️  Still no changes to commit.");
            return;
          }
          
          // Continue with the newly staged changes
          return processDiffAndCommit(newDiff);
        } catch (error: any) {
          console.error("❌ Error staging files:", error.message);
          return;
        }
      } else {
        console.log("ℹ️  Please run 'git add' manually and try again.");
        return;
      }
    }

    // Process the diff and commit
    await processDiffAndCommit(diff);

  } catch (error: any) {
    console.error("\n❌ Error:", error.message || error);
  }
}

async function processDiffAndCommit(diff: string) {
  try {

    // Start Processing
    const spinner = ora("Gemini 2.5 is analyzing changes...").start();

    // Note: If 'gemini-2.5' is not yet active for your key, fallback to 'gemini-1.5-flash'
    const model = genAI.getGenerativeModel({ model: "gemini-2.5" });

    const prompt = `
      You are an expert developer. 
      Review the following git diff and generate a concise, meaningful git commit message.
      
      Rules:
      1. Use the "Conventional Commits" format (e.g., feat: ..., fix: ..., chore: ...).
      2. Keep the subject line under 50 characters.
      3. Do not include markdown code blocks, backticks, or quotes. Just the raw text.
      
      Git Diff:
      ${diff.slice(0, 30000)}
    `;

    const result = await model.generateContent(prompt);
    const generatedMessage = result.response.text().trim();

    spinner.stop();

    // Display Result
    console.log("\n--------------------------------------------------");
    console.log("\x1b[36m%s\x1b[0m", generatedMessage); // Cyan color
    console.log("--------------------------------------------------\n");

    // Interactive Menu (Single Letter)
    const answer = await inquirer.prompt([
      {
        type: "expand",
        name: "action",
        message: "Commit this?",
        choices: [
          { key: "y", name: "Yes (commit)", value: "commit" },
          { key: "e", name: "Edit message", value: "edit" },
          { key: "c", name: "Cancel", value: "cancel" },
        ],
      },
    ]);

    if (answer.action === "commit") {
      runCommit(generatedMessage);
    } else if (answer.action === "edit") {
      const editAnswer = await inquirer.prompt([
        {
          type: "input",
          name: "customMessage",
          message: "Enter new message:",
          default: generatedMessage,
        },
      ]);
      runCommit(editAnswer.customMessage);
    } else {
      console.log("🚫 Operation cancelled.");
    }

  } catch (error: any) {
    console.error("\n❌ Error:", error.message || error);
  }
}

function runCommit(message: string) {
  // Using spawnSync for safe argument handling
  const result = spawnSync("git", ["commit", "-m", message], {
    stdio: "inherit",
  });

  if (result.status === 0) {
    console.log("\n✅ Committed!");
  } else {
    console.log("\n❌ Failed.");
  }
}

main();