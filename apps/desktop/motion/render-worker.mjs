// Isolated Remotion process: one per job, so a crash or cancel never touches the main process.
// Reads a JSON job on stdin and reports JSON lines on stdout. It renders only with the browser it is given:
// the single download happens in install mode, which the user starts explicitly.
import { ensureBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const job = JSON.parse(input);
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

if (job.install) {
  await ensureBrowser({ logLevel: 'error', onBrowserDownload: () => ({ version: null, onProgress: ({ percent }) => send({ progress: percent }) }) });
} else {
  const { serveUrl, project, timelineProps, output, browserExecutable } = job;
  const inputProps = timelineProps ? { props: timelineProps } : { project };
  const compositionId = timelineProps ? 'aethera-timeline' : project.templateId;
  const composition = await selectComposition({ serveUrl, id: compositionId, inputProps, browserExecutable, logLevel: 'error' });
  if (job.still) await renderStill({ composition, serveUrl, frame: job.frame, output, inputProps, browserExecutable, logLevel: 'error' });
  else await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: output, inputProps, browserExecutable, concurrency: 2, logLevel: 'error', onProgress: ({ progress }) => send({ progress }) });
}
send({ done: true });
