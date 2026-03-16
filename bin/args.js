export function normalizeCliArgs(argv) {
  if (argv.length === 0) return ['_interactive']

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

  return ['_interactive', ...argv]
}
