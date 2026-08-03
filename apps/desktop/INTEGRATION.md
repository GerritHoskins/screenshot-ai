# Analysis Pipeline Integration

## Overview

The analysis pipeline has been wired into the Electron desktop app, connecting:
- **Capture** → **AI Analysis** → **Results Display**

## Architecture

```
┌─────────────────┐
│  Hotkey Trigger │ (Ctrl/Cmd+Shift+S)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Screen Capture │ (capture.ts)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Analysis Service│ (analysis.ts)
│  - Provider     │
│  - Prompts      │
│  - Keychain     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  AI Provider    │ (OpenAI/Anthropic)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  AIResponse<T>  │ (Normalized response)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Renderer UI    │ (index.ts + index.html)
│  - Display      │
│  - Retry        │
│  - Copy         │
└─────────────────┘
```

## Files Modified/Created

### Main Process
- **`apps/desktop/src/main/index.ts`**
  - Integrated `AnalysisService`
  - Wired capture → analysis flow
  - Sends `AIResponse<ScreenshotAnalysis>` to renderer
  - Handles processing states and errors

- **`apps/desktop/src/main/analysis.ts`** (NEW)
  - `AnalysisService` class
  - Manages provider lifecycle
  - Loads API keys from keychain
  - Generates prompts using templates
  - Returns normalized `AIResponse`

### Renderer Process
- **`apps/desktop/src/renderer/index.ts`**
  - Handles `AIResponse<ScreenshotAnalysis>` format
  - Displays extracted text, code blocks, structured data
  - Shows metadata (model, latency, tokens)
  - Copy to clipboard functionality
  - Retry with error handling

- **`apps/desktop/src/renderer/index.html`**
  - Enhanced UI with status indicators
  - Styled code blocks and metadata
  - Copy and Retry buttons

## Data Flow

### 1. Capture Flow
```typescript
Hotkey → captureScreenSelection() → Buffer | null
```

### 2. Analysis Flow
```typescript
Buffer → AnalysisService.analyzeScreenshot()
  → getApiKey() [from keychain]
  → generateScreenshotAnalysisPrompt()
  → createProvider() [OpenAI/Anthropic]
  → provider.complete<ScreenshotAnalysis>()
  → AIResponse<ScreenshotAnalysis>
```

### 3. Display Flow
```typescript
AIResponse<ScreenshotAnalysis> → IPC → Renderer
  → Display:
    - Extracted text
    - Code blocks (with language)
    - Structured data
    - Metadata (model, latency, tokens)
```

## IPC Events

### Main → Renderer
- `analysis:processing` - Processing status updates
- `analysis:result` - Success with `AIResponse<ScreenshotAnalysis>`
- `analysis:error` - Error with code, message, retryable flag

### Renderer → Main
- `analysis:retry` - Retry last analysis

## Response Schema

The app uses the standardized `AIResponse<ScreenshotAnalysis>` format:

```typescript
interface AIResponse<ScreenshotAnalysis> {
  success: boolean;
  data?: ScreenshotAnalysis;
  error?: AIError;
  metadata: ResponseMetadata;
}

interface ScreenshotAnalysis {
  text?: string;
  codeBlocks?: CodeBlock[];
  structuredData?: Record<string, unknown>;
  confidence: number;
}
```

## Provider Configuration

Default provider: **OpenAI** (`gpt-4-vision-preview`)

To change provider, modify `apps/desktop/src/main/index.ts`:
```typescript
const analysisService = getAnalysisService({ 
  provider: 'anthropic' // or 'openai'
});
```

## API Key Setup

API keys are stored securely using the keychain:
- macOS: Keychain Access
- Windows: Credential Manager

Keys are loaded automatically via `getApiKey()` from `src/security/keychain.ts`.

## Error Handling

- **AUTH_ERROR**: API key missing/invalid → Not retryable
- **RATE_LIMIT**: Rate limit exceeded → Retryable with backoff
- **TIMEOUT**: Request timeout → Retryable
- **PARSE_ERROR**: JSON parsing failed → Retryable
- **NETWORK_ERROR**: Connection issues → Retryable

## Next Steps

1. **Settings UI**: Add UI to configure provider and API keys
2. **Provider Selection**: Allow switching providers at runtime
3. **Error Recovery**: Implement automatic retry with exponential backoff
4. **Result Persistence**: Save analysis history
5. **Export Options**: Export results as JSON/Markdown
