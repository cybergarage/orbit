// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import Foundation
import FoundationModels

private let byteLimit = 1_048_576

private struct InputMessage: Decodable {
    let role: String
    let content: String
}

private struct Request: Decodable {
    let version: Int
    let operation: String
    let messages: [InputMessage]?
    let maxOutputTokens: Int?
}

private func emit(_ response: [String: Any]) {
    let data = (try? JSONSerialization.data(withJSONObject: response)) ?? Data()
    guard data.count <= byteLimit else {
        FileHandle.standardOutput.write(Data("{\"version\":1,\"error\":\"output_too_large\"}".utf8))
        return
    }
    FileHandle.standardOutput.write(data)
}

@available(macOS 26.0, *)
private func availability() -> String? {
    switch SystemLanguageModel.default.availability {
    case .available: return nil
    case .unavailable(.deviceNotEligible): return "device_not_eligible"
    case .unavailable(.appleIntelligenceNotEnabled): return "apple_intelligence_not_enabled"
    case .unavailable(.modelNotReady): return "model_not_ready"
    case .unavailable: return "model_unavailable"
    @unknown default: return "model_unavailable"
    }
}

@available(macOS 26.0, *)
private func generate(_ request: Request) async throws -> String {
    guard let messages = request.messages, !messages.isEmpty, messages.count <= 256,
          let cap = request.maxOutputTokens, (1...4096).contains(cap) else {
        throw ProtocolError.invalidRequest
    }
    var entries: [Transcript.Entry] = []
    var instructions: [String] = []
    var lastRole = ""
    for message in messages {
        guard message.content.utf8.count <= byteLimit else { throw ProtocolError.invalidRequest }
        switch message.role {
        case "system":
            guard lastRole.isEmpty else { throw ProtocolError.invalidRequest }
            instructions.append(message.content)
        case "user", "assistant":
            guard message.role != lastRole, !lastRole.isEmpty || message.role == "user" else {
                throw ProtocolError.invalidRequest
            }
            lastRole = message.role
        default: throw ProtocolError.invalidRequest
        }
    }
    guard lastRole == "user", let prompt = messages.last else { throw ProtocolError.invalidRequest }
    if !instructions.isEmpty {
        entries.append(.instructions(.init(segments: [.text(.init(content: instructions.joined(separator: "\n\n")))], toolDefinitions: [])))
    }
    for message in messages.dropLast() where message.role != "system" {
        let segments: [Transcript.Segment] = [.text(.init(content: message.content))]
        if message.role == "user" {
            entries.append(.prompt(.init(segments: segments)))
        } else {
            entries.append(.response(.init(assetIDs: [], segments: segments)))
        }
    }
    let session = LanguageModelSession(model: .default, tools: [], transcript: Transcript(entries: entries))
    return try await session.respond(to: prompt.content, options: GenerationOptions(maximumResponseTokens: cap)).content
}

private enum ProtocolError: Error { case invalidRequest }

@main
struct AppleHelper {
    static func main() async {
        guard CommandLine.arguments.count == 1 else {
            emit(["version": 1, "error": "invalid_arguments"])
            return
        }
        var data = Data()
        do {
            while let chunk = try FileHandle.standardInput.read(upToCount: 8192), !chunk.isEmpty {
                guard data.count + chunk.count <= byteLimit else {
                    emit(["version": 1, "error": "input_too_large"])
                    return
                }
                data.append(chunk)
            }
            // Reject unknown protocol fields rather than interpreting them as capabilities.
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  Set(object.keys).isSubset(of: ["version", "operation", "messages", "maxOutputTokens"]) else {
                throw ProtocolError.invalidRequest
            }
            if let messages = object["messages"] as? [[String: Any]] {
                guard messages.allSatisfy({ Set($0.keys) == ["role", "content"] }) else {
                    throw ProtocolError.invalidRequest
                }
            }
            let request = try JSONDecoder().decode(Request.self, from: data)
            guard request.version == 1, ["availability", "generate"].contains(request.operation) else {
                throw ProtocolError.invalidRequest
            }
            guard #available(macOS 26.0, *) else {
                emit(["version": 1, "error": "unsupported_os"])
                return
            }
            let reason = availability()
            if request.operation == "availability" {
                guard request.messages == nil, request.maxOutputTokens == nil else { throw ProtocolError.invalidRequest }
                var response: [String: Any] = ["version": 1, "available": reason == nil]
                if let reason { response["reason"] = reason }
                emit(response)
                return
            }
            if let reason {
                emit(["version": 1, "error": reason])
                return
            }
            emit(["version": 1, "text": try await generate(request)])
        } catch is DecodingError {
            emit(["version": 1, "error": "invalid_request"])
        } catch is ProtocolError {
            emit(["version": 1, "error": "invalid_request"])
        } catch let error as LanguageModelSession.GenerationError {
            switch error {
            case .exceededContextWindowSize: emit(["version": 1, "error": "context_overflow"])
            case .guardrailViolation: emit(["version": 1, "error": "guardrail_violation"])
            case .refusal: emit(["version": 1, "error": "refusal"])
            default: emit(["version": 1, "error": "generation_failed"])
            }
        } catch {
            // Never leak prompts or private framework error details through IPC.
            emit(["version": 1, "error": "generation_failed"])
        }
    }
}
