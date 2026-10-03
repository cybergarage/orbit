# Apple Foundation Models

Orbit includes an optional `apple` provider for local text conversations through a small Swift helper. There is no Node.js Foundation Models API dependency, install hook, cloud fallback or API billing. Installing Orbit and importing its API remain portable; selecting Apple requires a compatible Mac and a separately compiled helper.

This adapter is a draft with Node-side tests. Native compilation and inference have not been verified because the inspected Mac's Xcode license is unaccepted. Do not interpret a successful Node build as native or model validation.

## Prerequisites

- Apple silicon Mac, macOS 26 or newer.
- Xcode 26 or newer with the macOS SDK and Swift compiler providing FoundationModels.
- The user has reviewed and accepted the Xcode license. If `xcrun swift --version` asks for agreement, review it yourself with `sudo xcodebuild -license` in Terminal. Orbit never accepts terms or changes Xcode selection.
- Apple Intelligence must already be enabled in a supported region and its on-device model must be ready. Orbit does not enable it or download model assets.

Build explicitly from the repository, or use the source included under `node_modules/@cybergarage/orbit/native/apple-foundation-models/main.swift`:

```sh
mkdir -p .local/apple
xcrun swiftc -parse-as-library -O -target arm64-apple-macos26.0 \
  native/apple-foundation-models/main.swift -o .local/apple/orbit-apple-helper
export ORBIT_APPLE_HELPER_PATH="$PWD/.local/apple/orbit-apple-helper"
printf '%s' '{"version":1,"operation":"availability"}' | "$ORBIT_APPLE_HELPER_PATH"
```

Only `{"version":1,"available":true}` confirms current model availability. A false result reports `device_not_eligible`, `apple_intelligence_not_enabled`, `model_not_ready` or `model_unavailable`. Recheck after user-managed setup; do not infer readiness from the machine's hardware or OS version.

## Local usage

```ts
import {AppleFoundationModelsAgent, createProvider, Message, MessageType} from '@cybergarage/orbit'

const model = new AppleFoundationModelsAgent('system', createProvider('apple'))
const availability = await model.probeAvailability()
if (!availability.available) throw new Error(`Apple model unavailable: ${availability.reason}`)
const reply = await model.invoke(
  [
    new Message(MessageType.Session, {content: 'Summarize text briefly.'}),
    new Message(MessageType.User, {content: 'Summarize: The meeting moved to Friday.'}),
  ],
  {maxOutputTokens: 128},
)
console.log(reply.content)
```

Settings select `"provider": "apple", "model": "system"`. The helper path comes from `ORBIT_APPLE_HELPER_PATH` or the adapter's explicit `helperPath` option, never from model output. Use a trusted absolute executable path. The helper runs with the user's privileges. Do not configure `host`, API keys or `contextWindow` for Apple. Construct a text-only Agent with no tools and no MCP manager if using the agent runtime; default coding tools are unsupported and produce an explicit error.

## Capability boundary

| Capability                     | Apple framework               | Orbit adapter                                     |
| ------------------------------ | ----------------------------- | ------------------------------------------------- |
| Text generation                | Supported                     | Supported draft                                   |
| Multiple turns                 | Session transcript            | Replays alternating text turns in a fresh session |
| Streaming                      | Supported                     | No streaming API or emulation                     |
| Guided/structured generation   | Supported                     | `responseFormat: 'json'` rejected                 |
| Tool invocation                | Swift `Tool` callbacks        | Tool specs and tool history rejected              |
| Images, audio, reasoning parts | Depends on system API/version | Rejected                                          |
| Context-window enlargement     | System managed                | Overrides rejected                                |

System and developer instructions must precede alternating user/assistant turns; the final turn must be from the user. Developer text is combined into Apple instructions, so a separate developer priority is not preserved. Only the `system` model is selectable. Token usage and stop reasons are not fabricated. The default output cap is 1024, with a 1–4096 token accepted range; this does not promise that a generation fits the model's context. Context overflow maps to Orbit's ContextOverflowError. Refusals and guardrail failures are explicit errors.

Apple describes this model as suitable for summarization, extraction, classification and creative text. It cautions against code generation, math and complex reasoning. It is not a verified substitute for Orbit's coding providers. See [Apple's guidance](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models).

## Protocol and ownership

One invocation spawns one executable with no arguments and `shell: false`. It writes one UTF-8 JSON object to stdin and closes input; the helper writes one protocol-v1 response and exits. The helper checks availability before every generation. No daemon, socket, persistent model session or subprocess command is created by the helper. Each caller owns its process, so cancellation does not interrupt other invocations.

Input and stdout are limited to 1 MiB, stderr to 16 KiB, messages to 256 and the default process deadline to 120 seconds (configurable up to 600 seconds). Abort/deadline/oversize failure sends SIGTERM, then SIGKILL after 250 ms, and waits for process closure before settling. Transport failures never print helper stderr or model input. Normal Orbit diagnostic policies still apply to model requests and outputs.

Requests are `{"version":1,"operation":"availability"}` or `{"version":1,"operation":"generate","messages":[{"role":"user","content":"Hello"}],"maxOutputTokens":128}`. Responses contain `version: 1` and either availability, `text`, or a stable `error` code. Unknown operations and top-level fields are rejected. Model output is always data and is never executed as a shell command.

## Validation

```sh
npm run headers:check
npm run build
TS_NODE_PROJECT=tsconfig.test.json npx mocha --forbid-only test/core/apple-foundation-models.test.ts
npm test
npm run test:package
```

The process tests use temporary Node fixtures and do not call an Apple model or touch user settings. After compiling and confirming availability, run the usage example and an alternating two-turn conversation. Native inference and transcript replay remain required follow-up checks. A tool roundtrip is not supported by this adapter; do not claim one based on text generation or a mocked transport.

[Proposed architecture and evidence](adr/2026-10-03-apple-foundation-models.md).
