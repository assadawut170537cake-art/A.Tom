import { categoryCounts, categoryOf, entriesFor } from '../features/marketplace/marketCatalog';
import type { MarketEntry } from '../features/marketplace/marketplaceModel';
import { parseRegistryPage, registryServerId } from '../features/marketplace/mcpRegistry';

const entry = (over: Partial<MarketEntry>): MarketEntry => ({
  key: over.id ?? 'x',
  kind: 'skill',
  id: 'x',
  title: 'x',
  subtitle: '',
  badge: '',
  installed: true,
  enabled: true,
  details: [],
  removable: false,
  ...over,
});

test('categoryOf: เดาหมวดจากคำ (ไทย/อังกฤษ) · ไม่เข้า = อื่น ๆ', () => {
  expect(categoryOf('GitHub code review')).toBe('code');
  expect(categoryOf('สรุปข้อความเอกสาร')).toBe('files');
  expect(categoryOf('วางแผนวันจากปฏิทิน')).toBe('work');
  expect(categoryOf('อะไรก็ไม่รู้')).toBe('other');
});

test('entriesFor: แท็บ + ของคุณ/สำรวจ + หมวด + ค้นหา + เรียง', () => {
  const list = [
    entry({ id: 'a', title: 'ข', installed: true, enabled: false }),
    entry({ id: 'b', title: 'ก', installed: true, enabled: true }),
    entry({ id: 'c', title: 'แนะนำ', installed: false, details: ['วางแผน'] }),
    entry({ id: 'm', kind: 'mcp', title: 'Demo' }),
    entry({ id: 'd', kind: 'device', title: 'ควบคุมอุปกรณ์' }),
  ];
  expect(entriesFor(list, 'skill', 'mine', '', 'name').map((e) => e.id)).toEqual(['b', 'a']);
  expect(entriesFor(list, 'skill', 'mine', '', 'enabled').map((e) => e.id)).toEqual(['b', 'a']);
  expect(entriesFor(list, 'skill', 'explore', '', 'name').map((e) => e.id)).toEqual(['c']);
  expect(entriesFor(list, 'skill', 'explore', '', 'name', 'work').map((e) => e.id)).toEqual(['c']);
  expect(entriesFor(list, 'plugin', 'mine', '', 'name').map((e) => e.id)).toEqual(['d']);
  expect(entriesFor(list, 'connector', 'mine', 'dem', 'name').map((e) => e.id)).toEqual(['m']);
  expect(categoryCounts(entriesFor(list, 'plugin', 'explore', '', 'name'))).toEqual([
    { id: 'device', label: 'อุปกรณ์และระบบ', icon: '📱', count: 1 },
  ]);
});

test('parseRegistryPage: เอาเฉพาะ streamable-http · ตัดซ้ำ · ต้องใช้ token ถ้ามี header บังคับ', () => {
  const page = parseRegistryPage({
    servers: [
      {
        server: {
          name: 'io.a/x',
          title: 'X',
          description: 'd',
          remotes: [{ type: 'streamable-http', url: 'https://x' }],
        },
      },
      { server: { name: 'io.a/x', remotes: [{ type: 'streamable-http', url: 'https://dup' }] } },
      { server: { name: 'io.a/stdio', packages: [{}] } },
      { server: { name: 'io.a/sse', remotes: [{ type: 'sse', url: 'https://s' }] } },
      {
        server: {
          name: 'io.b/tok',
          remotes: [
            {
              type: 'streamable-http',
              url: 'https://t',
              headers: [{ name: 'Authorization', isRequired: true }],
            },
          ],
        },
      },
      'junk',
    ],
    metadata: { nextCursor: 'c1' },
  });
  expect(page).toEqual({
    servers: [
      { name: 'io.a/x', title: 'X', description: 'd', url: 'https://x', needsToken: false },
      { name: 'io.b/tok', title: 'tok', description: '', url: 'https://t', needsToken: true },
    ],
    nextCursor: 'c1',
  });
  expect(parseRegistryPage(null)).toEqual({ servers: [], nextCursor: null });
});

test('registryServerId: a-z0-9_- · ชนแล้วต่อท้าย', () => {
  expect(registryServerId('io.github.Foo/My Server!', [])).toBe('my-server');
  expect(registryServerId('io.x/notes', ['notes', 'notes-2'])).toBe('notes-3');
});
