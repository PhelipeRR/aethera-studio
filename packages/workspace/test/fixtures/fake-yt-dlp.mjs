// FAKE yt-dlp for tests: speaks the same arguments and output lines the Studio relies on, never touches the network.
// Mode comes from FAKE_YTDLP_MODE: ok | fail-once | hang | forbidden | unavailable. Metadata entries are synthetic.
import { appendFileSync, copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const mode = process.env.FAKE_YTDLP_MODE ?? 'ok';
const log = process.env.FAKE_YTDLP_LOG;
const note = (text) => { if (log) appendFileSync(log, `${text}\n`); };

if (args.includes('-j')) {
  const targets = args.slice(args.indexOf('--') + 1);
  for (const target of targets) {
    if (target.startsWith('ytsearch')) {
      const query = target.slice(target.indexOf(':') + 1);
      for (let index = 0; index < 2; index += 1) {
        const id = `synth${index}${query.length}`.padEnd(11, 'x').slice(0, 11);
        process.stdout.write(`${JSON.stringify({ id, webpage_url: `https://www.youtube.com/watch?v=${id}`, title: `${query} #${index + 1}`, channel: index === 0 ? 'Fixture Publishing' : 'Random Clips', channel_is_verified: index === 0, duration: index === 0 ? 120 : 1500, upload_date: '20260601', formats: [{ height: index === 0 ? 2160 : 720, vcodec: 'avc1' }], thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` })}\n`);
      }
    } else if (target.includes('unavailable')) {
      process.stderr.write('ERROR: [youtube] x: Video unavailable\n');
    } else {
      const id = new URL(target).searchParams.get('v') ?? 'unknown';
      process.stdout.write(`${JSON.stringify({ id, webpage_url: target, title: `Fixture Quest - Official Trailer (${id})`, channel: 'Fixture Publishing', channel_is_verified: true, duration: 95, upload_date: '20260115', formats: [{ height: 1080, vcodec: 'avc1' }, { height: 360, vcodec: 'avc1' }], license: 'Standard YouTube License' })}\n`);
    }
  }
  process.exit(targets.some((target) => target.includes('unavailable')) ? 1 : 0);
}

const directory = args[args.indexOf('-P') + 1];
const stem = args[args.indexOf('-o') + 1].replace('.%(ext)s', '');
const final = join(directory, `${stem}.mp4`);
const part = `${final}.part`;
const source = process.env.FAKE_YTDLP_SOURCE;
const content = source ? readFileSync(source) : Buffer.from('synthetic-video-bytes'.repeat(100));
const total = content.length;

if (mode === 'forbidden') { process.stderr.write('ERROR: unable to download video data: HTTP Error 403: Forbidden\n'); process.exit(1); }
if (mode === 'unavailable') { process.stderr.write('ERROR: [youtube] x: Video unavailable\n'); process.exit(1); }
if (mode === 'hang') { writeFileSync(part, content.subarray(0, 10)); process.stdout.write(`NBPROG 10 ${total} NA\n`); setInterval(() => undefined, 1_000); }
else {
  const marker = join(directory, '.fake-failed-once');
  if (mode === 'fail-once' && !existsSync(marker)) {
    writeFileSync(marker, 'x');
    writeFileSync(part, content.subarray(0, Math.floor(total / 2)));
    process.stdout.write(`NBPROG ${Math.floor(total / 2)} ${total} NA\n`);
    process.stderr.write('ERROR: Read timed out.\n');
    process.exit(1);
  }
  if (args.includes('--continue') && existsSync(part)) note(`resumed-from ${statSync(part).size}`);
  process.stdout.write(`NBPROG ${total} ${total} NA\n`);
  if (source) copyFileSync(source, part); else writeFileSync(part, content);
  renameSync(part, final);
  process.stdout.write(`${final}\n`);
  note(`downloaded ${stem}`);
}
