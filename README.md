# smart-commit

A CLI tool that leverages Google's Gemini AI to generate meaningful commit messages from staged Git changes and optionally update the README.

## 🌟 Features

- ✨ **AI-Powered Commits**: Generate conventional commit messages automatically
- 📝 **Smart README Updates**: Keep your documentation in sync with code changes
- 🔒 **Secure Setup**: Interactive first-run setup with encrypted API key storage
- ⚙️ **Customizable**: Edit AI suggestions before committing
- 🚀 **Fast & Free**: Uses Google's Gemini AI free tier (1,500 requests/day)

## Installation

### Global Installation (Recommended)

```bash
npm install -g @amaechina-ikechukwu/smart-commit
```

### Using npx (No Installation Required)

```bash
npx @amaechina-ikechukwu/smart-commit
```

## 🔑 First-Time Setup

When you run `smart-commit` for the first time, it will guide you through an interactive setup:

1. **Welcome Screen**: Learn about smart-commit's features
2. **API Key Setup**: Get step-by-step instructions to obtain your free Gemini API key
3. **Secure Storage**: Your key is encrypted and stored locally at `~/.smart-commit/config.json`

### Getting Your Free API Key

Smart-commit uses Google's Gemini AI, which offers a **generous FREE tier**:
- ✅ **1,500 requests per day**
- ✅ **1 million tokens per month**  
- ✅ **No credit card required**
- 💰 **Costs almost nothing** even with heavy usage

**Get your key in 30 seconds:** [Google AI Studio](https://aistudio.google.com/app/apikey)

> 🔒 **Privacy Note**: Your API key is stored securely on your local machine only. It's never sent to any third-party servers except Google's Gemini API.

## Usage

### Basic Usage

1. Stage your changes:
```bash
git add .
```

2. Run smart-commit:
```bash
smart-commit
```

3. Review the AI-generated message, edit if needed, and commit!

### Update README

Check if your README is in sync with the codebase:

```bash
smart-commit --update-readme
# or
smart-commit -r
```

### Reconfigure API Key

If you need to change your API key:

```bash
smart-commit --reset-key
# or
smart-commit --config
```

## 🛠️ Advanced Configuration

### Manual Environment Variable Setup (Optional)

If you prefer using environment variables instead of the interactive setup:

#### Windows (PowerShell):
```powershell
# Temporary (current session only)
$env:GEMINI_API_KEY="YOUR_API_KEY"

# Permanent (all sessions)
[System.Environment]::SetEnvironmentVariable('GEMINI_API_KEY', 'YOUR_API_KEY', 'User')
```

#### macOS/Linux:
```bash
# Temporary (current session)
export GEMINI_API_KEY=YOUR_API_KEY

# Permanent (add to ~/.bashrc, ~/.zshrc, or ~/.bash_profile)
echo 'export GEMINI_API_KEY=YOUR_API_KEY' >> ~/.bashrc
source ~/.bashrc
```

> 💡 **Tip**: Environment variables take priority over the stored config file.

## Workflow

1. **Stage your changes:** Use `git add .` or `git add <file>` to stage the changes you want to commit.
2. **Run `smart-commit`:** Execute the CLI tool.
3. **Review the generated commit message:** The AI will display a conventional commit message.
4. **Choose an action:**
   - **Yes:** Commit with the generated message.
   - **Edit:** Modify the message before committing.
   - **Cancel:** Abort the commit.
5. **Push to GitHub (optional):** After committing, you'll be asked if you want to push your changes.

## Why Get Your Own API Key?

While it might be tempting to share API keys, getting your own has significant benefits:

- ✅ **It's completely FREE** - No credit card required
- ⚡ **Takes only 30 seconds** to set up
- 🔒 **Your data stays private** - No shared rate limits
- 💰 **Costs almost nothing** - Even with heavy usage, you'll stay within the free tier
- 🚀 **1,500 requests/day** is plenty for daily development work
- 📊 **Track your own usage** in Google AI Studio

The free tier is extremely generous and designed for developers like you!

## Development

### Local Development Setup

```bash
git clone https://github.com/Amaechina-Ikechukwu/smart-commit.git
cd smart-commit
npm install
npm run build
npm start
```

## Dependencies

- `@google/generative-ai`: For interacting with the Gemini AI model
- `inquirer`: For interactive command-line prompts
- `ora`: For displaying spinners in the console

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.