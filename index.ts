#!/usr/bin/env node
import { GoogleGenerativeAI } from "@google/generative-ai";
import { execSync, spawnSync } from "node:child_process";
import inquirer from "inquirer";
import ora from "ora";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// 1. Configuration
const CONFIG_DIR = path.join(os.homedir(), ".smart-commit");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface Config {
  apiKey?: string;
  hasSeenWelcome?: boolean;
}

// Read or initialize config
function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    // If config is corrupted, start fresh
  }
  return {};
}

// Save config securely (with restricted permissions)
function saveConfig(config: Config): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  } catch (error: any) {
    console.error("Warning: Could not save config:", error.message);
  }
}

// Display welcome message for first-time users
function showWelcomeMessage(): void {
  console.log(`
${'='.repeat(70)}
`);
  console.log("\x1b[36m%s\x1b[0m", "  Welcome to smart-commit!");
  console.log(`\n${'='.repeat(70)}`);
  console.log(`
  Smart-commit uses AI to generate meaningful commit messages from your
  code changes, saving you time and improving your commit history.
  
  Features:
     - AI-powered commit messages using Google's Gemini
     - Automatic README.md updates when code changes
     - Interactive commit review and editing
     - Supports conventional commits format
  
  About the API Key:
     - Google's Gemini AI offers a generous FREE tier
     - No credit card required to get started
     - 1,500 requests/day & 1M tokens/month
     - Your key is stored securely on your machine
     - Costs almost nothing even with heavy usage
  
${'='.repeat(70)}\n`);
}

// Interactive API key setup
async function setupApiKey(): Promise<string> {
  console.log("\x1b[33m%s\x1b[0m", "\nAPI Key Setup");
  console.log("\nTo use smart-commit, you need a free Gemini API key.\n");
  
  const { shouldGetKey } = await inquirer.prompt([
    {
      type: "confirm",
      name: "shouldGetKey",
      message: "Would you like to get your free API key now?",
      default: true,
    },
  ]);

  if (shouldGetKey) {
    console.log(`\nSteps to get your API key:

   1. Visit: \x1b[36mhttps://aistudio.google.com/app/apikey\x1b[0m
   2. Sign in with your Google account
   3. Click "Create API Key"
   4. Copy the key and paste it below
`);
    console.log("Added for git commit")
    // Give user time to get the key
    const { ready } = await inquirer.prompt([
      {
        type: "confirm",
        name: "ready",
        message: "Have you obtained your API key?",
        default: true,
      },
    ]);

    if (!ready) {
      console.log("\nNo problem! Run \x1b[36msmart-commit\x1b[0m again when you have your key.\n");
      process.exit(0);
    }
  }

  const { apiKey } = await inquirer.prompt([
    {
      type: "password",
      name: "apiKey",
      message: "Enter your Gemini API key:",
      mask: "*",
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return "API key cannot be empty";
        }
        if (input.trim().length < 20) {
          return "API key seems too short. Please check and try again.";
        }
        return true;
      },
    },
  ]);

  // Test the API key
  const spinner = ora("Validating API key...").start();
  try {
    const testAI = new GoogleGenerativeAI(apiKey.trim());
    const model = testAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    await model.generateContent("Say 'OK'");
    spinner.succeed("API key is valid!");
    return apiKey.trim();
  } catch (error: any) {
    spinner.fail("API key validation failed");
    console.error("\nError:", error.message);
    console.log("\nPlease check your API key and try again.\n");
    process.exit(1);
  }
}

// Initialize API key (from env, config, or setup)
async function initializeApiKey(): Promise<string> {
  // Priority 1: Environment variable (for CI/CD or advanced users)
  const envKey = process.env.GEMINI_API_KEY;
  if (envKey && envKey.trim()) {
    return envKey.trim();
  }

  // Priority 2: Stored config file
  const config = loadConfig();
  
  // Show welcome message for first-time users
  if (!config.hasSeenWelcome) {
    showWelcomeMessage();
    config.hasSeenWelcome = true;
    saveConfig(config);
  }

  if (config.apiKey) {
    return config.apiKey;
  }

  // Priority 3: Interactive setup for new users
  const apiKey = await setupApiKey();
  config.apiKey = apiKey;
  saveConfig(config);
  
  console.log("\nSetup complete! Your API key has been saved securely.\n");
  return apiKey;
}

let genAI: GoogleGenerativeAI;

// Parse CLI flags
const args = process.argv.slice(2);
const FORCE_README_UPDATE = args.includes('--update-readme') || args.includes('-r');
const RESET_CONFIG = args.includes('--reset-key') || args.includes('--config');

async function main() {
  try {
    // Handle config reset
    if (RESET_CONFIG) {
      console.log("\nResetting API key configuration...\n");
      const apiKey = await setupApiKey();
      const config = loadConfig();
      config.apiKey = apiKey;
      saveConfig(config);
      console.log("\nAPI key has been updated successfully!\n");
      return;
    }

    // Initialize API key (interactive setup on first run)
    const apiKey = await initializeApiKey();
    genAI = new GoogleGenerativeAI(apiKey);

    // Handle README-only update flag
    if (FORCE_README_UPDATE) {
      await checkAndUpdateReadme();
      return;
    }

    // 2. Verify Git Repo
    try {
      execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
    } catch {
      console.error("Error: This is not a git repository.");
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
      console.log("No staged changes found (excluding lockfiles).");
      
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
            console.log("Still no changes to commit.");
            return;
          }
          
          // Continue with the newly staged changes
          return processDiffAndCommit(newDiff);
        } catch (error: any) {
          console.error("Error staging files:", error.message);
          return;
        }
      } else {
        console.log("Please run 'git add' manually and try again.");
        return;
      }
    }

    // Process the diff and commit
    await processDiffAndCommit(diff);

  } catch (error: any) {
    console.error("\nError:", error.message || error);
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
      console.log("\x1b[32m%s\x1b[0m", "README.md updated"); // Green color
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
      console.log("Operation cancelled.");
    }

  } catch (error: any) {
    spinner.stop();
    console.error("\nError:", error.message || error);
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
      console.log("No significant README updates needed.");
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
    console.error("\nREADME update failed:", error.message);
    return false;
  }
}

// Standalone README update checker
async function checkAndUpdateReadme() {
  const spinner = ora("Analyzing README alignment with codebase...").start();
  
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    // Read current README
    let currentReadme = "";
    try {
      currentReadme = await Bun.file("README.md").text();
    } catch {
      spinner.fail("README.md not found");
      return;
    }

    // Get current codebase snapshot
    const mainFiles = [];
    try {
      const indexFile = await Bun.file("index.ts").text();
      mainFiles.push(`index.ts:\n${indexFile.slice(0, 15000)}`);
    } catch {}
    
    try {
      const pkg = await Bun.file("package.json").text();
      mainFiles.push(`package.json:\n${pkg}`);
    } catch {}

    if (mainFiles.length === 0) {
      spinner.fail("No code files found to analyze");
      return;
    }

    const alignmentPrompt = `
You are a technical documentation expert.

CURRENT README.md:
${currentReadme}

CURRENT CODEBASE:
${mainFiles.join('\n\n')}

TASK:
Analyze if the README accurately reflects the current codebase.
Check for:
1. Missing features/commands mentioned in code but not in README
2. Outdated installation or usage instructions
3. Missing dependencies or setup steps
4. Incorrect or obsolete information

If updates are needed, provide an updated README.
If README is accurate, respond with "README_IS_ACCURATE"

Return ONLY the updated README content or "README_IS_ACCURATE" (no explanations, no markdown code blocks):`;

    const result = await model.generateContent(alignmentPrompt);
    let analysis = result.response.text().trim();
    analysis = analysis.replace(/^```markdown\n?/gm, '').replace(/^```\n?/gm, '').trim();

    spinner.stop();

    if (analysis === "README_IS_ACCURATE" || analysis === currentReadme) {
      console.log("README.md is up-to-date with the codebase.");
      return;
    }

    // Show proposed changes
    console.log("\n" + "=".repeat(60));
    console.log("\x1b[33m%s\x1b[0m", "README Updates Recommended:");
    console.log("=".repeat(60));
    console.log(analysis.slice(0, 800) + (analysis.length > 800 ? '...\n' : '\n'));
    console.log("=".repeat(60) + "\n");

    const answer = await inquirer.prompt([
      {
        type: "confirm",
        name: "apply",
        message: "Apply these README updates?",
        default: true,
      },
    ]);

    if (answer.apply) {
      await Bun.write("README.md", analysis);
      console.log("\nREADME.md updated successfully!");
      
      const stageAnswer = await inquirer.prompt([
        {
          type: "confirm",
          name: "stage",
          message: "Stage and commit README.md?",
          default: true,
        },
      ]);

      if (stageAnswer.stage) {
        execSync("git add README.md", { stdio: "ignore" });
        execSync('git commit -m "docs: update README.md"', { stdio: "inherit" });
        console.log("Committed!");
      }
    } else {
      console.log("README update cancelled.");
    }

  } catch (error: any) {
    spinner.fail("Failed to analyze README");
    console.error("Error:", error.message);
  }
}

async function runCommit(message: string) {
  // Using spawnSync for safe argument handling
  const result = spawnSync("git", ["commit", "-m", message], {
    stdio: "inherit",
  });

  if (result.status === 0) {
    console.log("\nCommitted!");
    
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
        console.error("Error:", error.message);
      }
    }
  } else {
    console.log("\nFailed.");
  }
}

main();