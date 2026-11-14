/** Keep direct Git fixture commands non-interactive in every Vitest worker. */
process.env.GIT_TERMINAL_PROMPT ??= '0';
process.env.GIT_ASKPASS ??= 'true';
process.env.GIT_EDITOR ??= 'cmd.exe /c exit 0';
