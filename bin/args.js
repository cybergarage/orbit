export function normalizeCliArgs(argv, stdinIsTTY) {
  const defaultCommand = stdinIsTTY === true ? '_interactive' : 'exec'
  if (argv.length === 0) return [defaultCommand]

  const standaloneFlags = new Set(['--help', '--version', '-h', '-v'])
  if (argv.some((arg) => standaloneFlags.has(arg))) return argv

  const flagsWithValues = new Set(['--lang', '--model', '--provider'])
  let expectsValue = false

  for (const arg of argv) {
    if (expectsValue) {
      expectsValue = false
      continue
    }

    if (arg === '--') break

    if (!arg.startsWith('-')) return argv
    if (flagsWithValues.has(arg)) expectsValue = true
  }

  return [defaultCommand, ...argv]
}
