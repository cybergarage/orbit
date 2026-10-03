---
status: proposed
proposed-date: 2026-10-04
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Windows Storage Acknowledgement

## Purpose

Allow the shared durable runtime to operate on Windows with an honest filesystem acknowledgement level, while retaining Unix directory synchronization and all identity, exclusion and atomic replacement checks.

## Decision

Use `file-sync` by default on Windows and `file-and-directory-sync` elsewhere. Reject an explicit directory-sync requirement on Windows before journal or deletion mutations; never silently downgrade it. Registration, writer coordination and offline migration synchronize regular files on every platform and directories only where Node supports that operation. Their Windows acknowledgement does not claim namespace durability across power loss. Existing files being synchronized require writable descriptors on Windows. Preserve single-file atomic rename, retained recovery artifacts, synchronous ordering, identity checks and error propagation.

Canonical paths remain filesystem-derived. Correct Windows short-path spelling at the boundary, without lowercasing paths or weakening traversal and symlink checks.

## Consequences

- Windows can use durable runs with explicit file-flush evidence rather than fail at directory fsync.
- Windows namespace changes have a weaker power-loss guarantee. The selected level remains visible in recording metadata; explicit stronger requests fail.
- Unix acknowledgement behavior and error handling remain unchanged. No administrative volume flush or native dependency is introduced.

## Context and Problem Statement

At main `839ca4f70a816c0d997083e8e264caaee576f0cf`, registration and coordination unconditionally synchronize directory handles. Windows run 37147164070 reports 181 directory-fsync EPERM failures per job; remaining path failures include short versus expanded temporary paths. Scheduled-work persistence and the SQLite catalog already omit Windows directory fsync explicitly. This change aligns shared storage with that stated limitation, without interpreting errors as success.

## Decision Drivers

Honest acknowledgements; no blanket fsync catches; preserved atomic replacement and exclusion; no user settings changes; supported Node versions; actual Windows and Linux validation.

## External Implementation Research

Microsoft documents that `FlushFileBuffers` requires a handle with `GENERIC_WRITE`. In libuv v1.51.0, `src/win/fs.c` implements fsync with `FlushFileBuffers`; rename uses `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`. Neither supplies POSIX directory synchronization. `MOVEFILE_WRITE_THROUGH` describes flushing a copy-and-delete operation and does not establish a portable Node directory acknowledgement.

Codex and Pi agent policy comparisons are not applicable to this narrow kernel/filesystem compatibility correction: no model, permission or agent workflow semantics change. Microsoft and the pinned libuv implementation define the relevant platform contract.

## Considered Options

Keep rejecting Windows default storage (prevents ordinary providers from running); suppress fsync EPERM (falsely acknowledges failures); add privileged volume flush or native bindings (unnecessary privileges and packaging complexity); select truthful platform defaults and reject explicit unsupported guarantees (chosen).

## Implementation and Confirmation

Not started. Required confirmation: Linux and Windows full suites on the same head, writable-file acknowledgement and failure tests, canonical identity tests, cleanup and process-exit behavior, independent package consumer tests. Physical power-loss durability is not verified by unit tests.

## Follow-up Work

Preserve existing deferred physical-media and deployment trials. Do not infer them from CI.

## References

- [Execution acknowledgement levels](../execution.md)
- [Session storage identities and maintenance](../session-storage.md)
- [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)
- [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)
- [libuv v1.51.0 Windows filesystem implementation](https://github.com/libuv/libuv/blob/v1.51.0/src/win/fs.c)
