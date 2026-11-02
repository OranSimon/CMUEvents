import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTesseract } from '../src/lib/media-ocr.mjs';

/**
 * Create an isolated executable for exercising the real child-process boundary.
 * @param {string} folder Temporary test directory.
 * @param {string} name Executable filename.
 * @param {string} body JavaScript executed in the child.
 * @return {Promise<string>} Path to a temporary executable.
 */
async function executableFixture(folder, name, body) {
  const file = join(folder, name);
  await writeFile(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o700 });
  return file;
}

test('ordinary CLI failure records exit status and does not diagnose estimation stderr as a timeout', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'cmu-ocr-exit-test-'));
  try {
    const executable = await executableFixture(folder, 'failure.mjs', "process.stderr.write('Estimating resolution as 357\\n'); process.exit(7);");
    await assert.rejects(runTesseract(join(folder, 'input.png'), join(folder, 'result'), { executable }), error => {
      assert.equal(error.name, 'OcrProcessError');
      assert.equal(error.diagnostics.timedOut, false);
      assert.equal(error.diagnostics.killed, false);
      assert.equal(error.diagnostics.signal, null);
      assert.equal(error.diagnostics.exitCode, 7);
      assert.equal(error.diagnostics.timeoutMs, 90000);
      assert.ok(error.diagnostics.elapsedMs >= 0);
      assert.match(error.message, /Estimating resolution as 357/);
      assert.doesNotMatch(error.message, /Command failed|cmu-ocr-exit-test-/);
      return true;
    });
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('an explicit deadline kills the child and reports timeout separately from stderr and exit code', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'cmu-ocr-timeout-test-'));
  try {
    const executable = await executableFixture(folder, 'blocked.mjs', "process.stderr.write('Estimating resolution as 357\\n'); setTimeout(() => {}, 5000);");
    await assert.rejects(runTesseract('input.png', 'output', { executable, timeoutMs: 300 }), error => {
      assert.equal(error.diagnostics.timedOut, true);
      assert.equal(error.diagnostics.killed, true);
      assert.equal(error.diagnostics.signal, 'SIGKILL');
      assert.equal(error.diagnostics.exitCode, null);
      assert.ok(error.diagnostics.elapsedMs >= 290 && error.diagnostics.elapsedMs < 2500);
      assert.match(error.message, /timeoutMs=300, timedOut=true, killed=true, signal=SIGKILL/);
      return true;
    });
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('missing executables report a launch failure without publishing local paths', async () => {
  await assert.rejects(runTesseract('/private/input.png', '/private/output', { executable: '/nonexistent/private-tesseract' }), error => {
    assert.equal(error.diagnostics.code, 'ENOENT');
    assert.equal(error.diagnostics.timedOut, false);
    assert.equal(error.diagnostics.exitCode, null);
    assert.equal(error.diagnostics.killed, false);
    assert.doesNotMatch(error.message, /private|nonexistent/);
    return true;
  });
});

test('parallel callers globally run at most two single-threaded OCR processes and release failed slots', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'cmu-ocr-queue-test-'));
  try {
    const log = join(folder, 'processes.jsonl');
    const executable = await executableFixture(folder, 'observe.mjs', `import { appendFileSync } from 'node:fs';
const log=${JSON.stringify(log)};
appendFileSync(log,JSON.stringify({type:'start',pid:process.pid,threads:process.env.OMP_THREAD_LIMIT})+'\\n');
setTimeout(()=>{appendFileSync(log,JSON.stringify({type:'end',pid:process.pid})+'\\n'); if(process.argv[2]==='fail')process.exit(3);},200);`);
    const results = await Promise.allSettled(['first', 'fail', 'third', 'fourth', 'fifth'].map(input => runTesseract(input, 'output', { executable })));
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const events = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    let running = 0; let maximum = 0;
    for (const event of events) {
      if (event.type === 'start') { running++; maximum = Math.max(maximum, running); assert.equal(event.threads, '1'); }
      else running--;
      assert.ok(running >= 0 && running <= 2);
    }
    assert.equal(maximum, 2);
    assert.equal(running, 0);
    assert.ok(results.filter(result => result.status === 'fulfilled').some(result => result.value.queueMs >= 150));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
