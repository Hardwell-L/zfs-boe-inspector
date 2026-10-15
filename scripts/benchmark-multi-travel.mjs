/** 本地合成数据基准：先 pnpm build:packages，再 node scripts/benchmark-multi-travel.mjs。不是浏览器性能验收。 */
import { performance } from 'node:perf_hooks';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deepStrictEqual } from 'node:assert';
import { createServer } from 'vite';

const baselineDir = await mkdtemp(join(tmpdir(), 'inspector-travel-baseline-'));
const server = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null } });
try {
  const { createTravelCollector } = await server.ssrLoadModule('/packages/adapter-vue3/src/collector.ts');
  const { buildTravelView } = await server.ssrLoadModule('/packages/core/src/travelView.ts');
  const { evaluateTravelRules } = await server.ssrLoadModule('/packages/rule-base/src/travelRules.ts');
  function fixture(personCount, rowCount) {
    let reads = 0;
    const persons = Array.from({ length: personCount }, (_, index) => ({ employeeId: `E${index}`, employeePost: `P${index}`, employeeName: `人员${index}` }));
    const cost = Array.from({ length: rowCount }, (_, index) => ({
      employeeId: persons[index % personCount].employeeId, attribute: 'CLJT', billTypeInvoice: '6',
      operationSubTypeCode: 'RAIL', tripDate: '2026-10-01', arriveCityName: '武汉', seatLevel: '2',
    }));
    const calendar = cost.map(({ employeeId }) => ({ employeeId, expenseDate: '2026-10-01', travelSite: '武汉', amount: 100 }));
    const refs = Object.fromEntries(persons.map((person) => {
      const fields = {
        person, standardAmount: { '武汉_2026-10-01': [{ standardAmount: 200, attribute: 'CLJT', bizCategorySmallCode: 'RAIL', controlType: 'ALLOW', transportation: '2' }] },
        standardDates: [], calendarData: calendar.filter((row) => row.employeeId === person.employeeId), travelList: [],
        standardAmountParamsObj: { key: [{ boeDate: '2026-10-01' }] },
      };
      const card = Object.defineProperties({}, Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { get() { reads += 1; return value; } }])));
      return [person.employeeId, [card]];
    }));
    return { owner: { $options: { name: 'MULTITRAVELBOE' }, personList: persons, $refs: refs, data: { cost, zfsBoeCalendarDTOS: calendar } }, reads: () => reads };
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const timed = (fn) => { const start = performance.now(); const value = fn(); return { value, ms: performance.now() - start }; };
  const rows = [];
  for (const legacyMode of [false, true]) {
    for (const [persons, details] of [[1, 100], [10, 100], [50, 100], [1, 1000], [10, 1000], [50, 1000], [50, 5000]]) {
      const fixtureData = fixture(persons, details);
      const collector = createTravelCollector(fixtureData.owner, { legacyMode });
      for (let warmup = 0; warmup < 3; warmup += 1) collector.collect();
      const collectTimes = [], ruleTimes = [], switchTimes = [];
      const before = fixtureData.reads();
      let travel;
      let extraHostReads = 0;
      for (let iteration = 0; iteration < 10; iteration += 1) {
        const collected = timed(() => collector.collect().travel);
        travel = collected.value;
        collectTimes.push(collected.ms);
        const snapshot = { schemaVersion: 1, instanceId: 'bench', capturedAt: '', meta: {}, runtime: { rawBillData: {} }, config: { template: [] }, travel };
        ruleTimes.push(timed(() => evaluateTravelRules(snapshot)).ms);
        const beforeSwitch = fixtureData.reads();
        switchTimes.push(timed(() => {
          buildTravelView(travel.persons[0]?.data);
          buildTravelView(travel.persons.at(-1)?.data);
        }).ms / 2);
        extraHostReads += fixtureData.reads() - beforeSwitch;
      }
      rows.push({ mode: legacyMode ? 'legacy' : 'modern', persons, details,
        collectMedianMs: +median(collectTimes).toFixed(3), collectMaxMs: +Math.max(...collectTimes).toFixed(3),
        ruleMedianMs: +median(ruleTimes).toFixed(3), switchModelMedianMs: +median(switchTimes).toFixed(3),
        readsPerSnapshot: (fixtureData.reads() - before) / 10, switchHostReads: extraHostReads,
        nodes: travel.diagnostics.nodes, bytes: Buffer.byteLength(JSON.stringify(travel)), status: travel.collection.status,
      });
    }
  }
  // 使用 Git HEAD 的采集与序列化实现，对照本次工作区修改；不改动工作区或安装依赖。
  const originalSerialize = execFileSync('git', ['show', 'HEAD:packages/adapter-vue3/src/serialize.ts'], { encoding: 'utf8' });
  const originalCollector = execFileSync('git', ['show', 'HEAD:packages/adapter-vue3/src/collector.ts'], { encoding: 'utf8' })
    .replaceAll("'@zfs-boe-inspector/shared-types'", JSON.stringify(resolve('packages/shared-types/src/index.ts')));
  await writeFile(join(baselineDir, 'serialize.ts'), originalSerialize);
  await writeFile(join(baselineDir, 'collector.ts'), originalCollector);
  const baseline = await server.ssrLoadModule(join(baselineDir, 'collector.ts'));
  const singleBaseline = [];
  for (const legacyMode of [false, true]) {
    const data = fixture(1, 1000).owner;
    const single = { ...data.$refs.E0[0], $options: { name: 'NEWTRAVELBOE' }, data: data.data };
    const original = baseline.createTravelCollector(single, { legacyMode });
    const current = createTravelCollector(single, { legacyMode });
    deepStrictEqual(current.collect(), original.collect());
    const originalTimes = [], currentTimes = [];
    for (let i = 0; i < 23; i += 1) {
      const oldMs = timed(() => original.collect()).ms;
      const newMs = timed(() => current.collect()).ms;
      if (i >= 3) { originalTimes.push(oldMs); currentTimes.push(newMs); }
    }
    singleBaseline.push({ mode: legacyMode ? 'legacy' : 'modern', details: 1000, sameOutput: true,
      originalMedianMs: +median(originalTimes).toFixed(3), currentMedianMs: +median(currentTimes).toFixed(3) });
  }
  console.log(JSON.stringify({ node: process.version, platform: `${process.platform}/${process.arch}`, repetitions: 10, rows, singleBaseline }, null, 2));
} finally {
  await server.close();
  await rm(baselineDir, { recursive: true, force: true });
}
