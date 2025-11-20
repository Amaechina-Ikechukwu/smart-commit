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
  const spinner = ora("Gemini is analyzing changes...").start();
  
  try {
    // Use gemini-2.0-flash-exp (or gemini-1.5-flash for stable version)
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

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

    // Check if README update is needed
    const shouldCheckReadme = await shouldUpdateReadme(diff);
    let readmeUpdated = false;

    if (shouldCheckReadme) {
      readmeUpdated = await handleReadmeUpdate(diff, model);
    }

    // Display Result
    console.log("\n--------------------------------------------------");
    console.log("\x1b[36m%s\x1b[0m", generatedMessage); // Cyan color
    console.log("--------------------------------------------------");
    if (readmeUpdated) {
      console.log("\x1b[32m%s\x1b[0m", "✓ README.md updated"); // Green color
    }
    console.log("");

    // Interactive Menu (Single Letter)
    const answer = await inquirer.prompt([
      {
        type: "expand",
        name: "action",
        message: "What would you like to do? (Y)es, (E)dit, (C)ancel",
        choices: [
          { key: "y", name: "Yes - Commit with this message", value: "commit" },
          { key: "e", name: "Edit - Modify the message", value: "edit" },
          { key: "c", name: "Cancel - Abort commit", value: "cancel" },
        ],
      },
    ]);

    if (answer.action === "commit") {
      await runCommit(generatedMessage);
    } else if (answer.action === "edit") {
      const editAnswer = await inquirer.prompt([
        {
          type: "input",
          name: "customMessage",
          message: "Enter new message:",
          default: generatedMessage,
        },
      ]);
      await runCommit(editAnswer.customMessage);
    } else {
      console.log("🚫 Operation cancelled.");
    }

  } catch (error: any) {
    spinner.stop();
    console.error("\n❌ Error:", error.message || error);
  }
}

// Check if README should be updated based on the diff
async function shouldUpdateReadme(diff: string): Promise<boolean> {
  // Skip if README.md itself is being modified
  if (diff.includes('diff --git a/README.md') || diff.includes('diff --git b/README.md')) {
    return false;
  }

  // Check for significant code changes (new features, API changes, etc.)
  const significantPatterns = [
    /^[+].*function\s+/m,      // New functions
    /^[+].*class\s+/m,         // New classes
    /^[+].*export\s+/m,        // New exports
    /^[+].*interface\s+/m,     // New interfaces
    /^[+].*type\s+\w+\s*=/m,   // New types
    /^[+].*const\s+\w+.*=.*require/m, // New dependencies
    /^[+].*import.*from/m,     // New imports (potential new features)
  ];

  // Only suggest README update if substantial code added
  const addedLines = diff.split('\n').filter(line => line.startsWith('+')).length;
  if (addedLines < 10) return false;

  return significantPatterns.some(pattern => pattern.test(diff));
}

// Handle README.md update with Gemini
async function handleReadmeUpdate(diff: string, model: any): Promise<boolean> {
  try {
    // Ask user first
    const answer = await inquirer.prompt([
      {
        type: "confirm",
        name: "updateReadme",
        message: "Detected significant changes. Update README.md?",
        default: true,
      },
    ]);

    if (!answer.updateReadme) return false;

    const spinner = ora("Analyzing README updates...").start();

    // Read current README
    let currentReadme = "";
    try {
      currentReadme = await Bun.file("README.md").text();
    } catch {
      currentReadme = "# Project\n\nNo README found.";
    }

    // Get project context from package.json
    let packageInfo = "";
    try {
      const pkg = await Bun.file("package.json").json();
      packageInfo = `Project: ${pkg.name || 'unknown'}\nDescription: ${pkg.description || 'N/A'}`;
    } catch {
      packageInfo = "No package.json found";
    }

    const readmePrompt = `
You are a technical writer updating a README.md file.

CURRENT README:
${currentReadme}

PROJECT INFO:
${packageInfo}

RECENT CODE CHANGES:
${diff.slice(0, 20000)}

TASK:
Update the README.md to reflect these changes. Follow these rules:
1. Preserve existing structure and formatting
2. Update installation, usage, or features sections if relevant
3. Add new features/commands if introduced in the diff
4. Keep it concise and developer-friendly
5. Return ONLY the updated README content (no explanations, no markdown code blocks)
6. If no meaningful updates needed, return "NO_UPDATE_NEEDED"

Return the complete updated README or "NO_UPDATE_NEEDED":`;

    const result = await model.generateContent(readmePrompt);
    let updatedReadme = result.response.text().trim();

    // Clean up markdown code blocks if Gemini added them despite instructions
    updatedReadme = updatedReadme.replace(/^```markdown\n?/gm, '').replace(/^```\n?/gm, '').trim();

    spinner.stop();

    if (updatedReadme === "NO_UPDATE_NEEDED" || updatedReadme === currentReadme) {
      console.log("ℹ️  No significant README updates needed.");
      return false;
    }

    // Show preview
    console.log("\n--------------------------------------------------");
    console.log("\x1b[33m%s\x1b[0m", "Proposed README.md changes:"); // Yellow
    console.log("--------------------------------------------------");
    console.log(updatedReadme.slice(0, 500) + (updatedReadme.length > 500 ? '...' : ''));
    console.log("--------------------------------------------------\n");

    const confirmAnswer = await inquirer.prompt([
      {
        type: "confirm",
        name: "applyReadme",
        message: "Apply these README changes?",
        default: true,
      },
    ]);

    if (confirmAnswer.applyReadme) {
      await Bun.write("README.md", updatedReadme);
      // Stage the README
      execSync("git add README.md", { stdio: "ignore" });
      return true;
    }

    return false;
  } catch (error: any) {
    console.error("\n⚠️  README update failed:", error.message);
    return false;
  }
}

async function runCommit(message: string) {
  // Using spawnSync for safe argument handling
  const result = spawnSync("git", ["commit", "-m", message], {
    stdio: "inherit",
  });

  if (result.status === 0) {
    console.log("\n✅ Committed!");
    
    // Ask if user wants to push to GitHub
    const pushAnswer = await inquirer.prompt([
      {
        type: "confirm",
        name: "shouldPush",
        message: "Would you like to push to GitHub?",
        default: true,
      },
    ]);

    if (pushAnswer.shouldPush) {
      const pushSpinner = ora("Pushing to GitHub...").start();
      try {
        // Get current branch name
        const branch = execSync("git rev-parse --abbrev-ref HEAD", {
          encoding: "utf-8",
        }).trim();

        // Push to origin
        execSync(`git push origin ${branch}`, { stdio: "inherit" });
        pushSpinner.succeed("Successfully pushed to GitHub!");
      } catch (error: any) {
        pushSpinner.fail("Failed to push to GitHub");
        console.error("❌ Error:", error.message);
      }
    }
  } else {
    console.log("\n❌ Failed.");
  }
}

main();