text
# smart-commit

A CLI tool that leverages Google's Gemini AI to generate commit messages from staged Git changes and optionally update the README.

## Installation

To install dependencies:

bash
bun install

You will also need to set the `GEMINI_API_KEY` environment variable. Get an API key from Google AI Studio and add it to your `.env` file:

GEMINI_API_KEY=YOUR_API_KEY

## Usage

To run:

bash
bun run index.ts

This will analyze your staged changes, generate a commit message using Gemini, and prompt you to commit, edit, or cancel.

### Options

*   `--update-readme` or `-r`:  Checks the current codebase against the `README.md` and prompts to update it if it's out of sync. It does not analyze staged git changes.

### Workflow

1.  **Stage your changes:** Use `git add .` or `git add <file>` to stage the changes you want to commit.
2.  **Run `smart-commit`:** Execute `bun run index.ts` in your terminal.
3.  **Review the generated commit message:** The tool will display the AI-generated commit message.
4.  **Choose an action:**
    *   **Yes:** Commit with the generated message.
    *   **Edit:** Modify the message before committing.
    *   **Cancel:** Abort the commit.
5.  **Push to GitHub (optional):** After committing, the tool will ask if you want to push your changes to GitHub.

## Dependencies

*   `@google/generative-ai`: For interacting with the Gemini AI model.
*   `inquirer`: For interactive command-line prompts.
*   `ora`: For displaying spinners in the console.

This project was created using `bun init` in bun v1.2.23. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.