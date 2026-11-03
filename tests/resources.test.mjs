import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { resourceCounts, TOPICS } from '../scripts/audit-resources.mjs';

test('counts primary direct entries once, skips search links and preserves useful query parameters', () => {
  const input = `# Example

[ref]: https://example.org/ref

## 📘 Learn Spanish

1. [A](https://example.org/a?utm_source=test) and [incidental](https://other.example/extra).
2. [A again](http://example.org/a/).
3. [Search](https://www.youtube.com/results?search_query=spanish).
4. [Reference][ref].

| # | Resource |
| --- | --- |
| 1 | [Video](https://www.youtube.com/watch?v=abc&si=tracking) |
| 2 | [Other video](https://www.youtube.com/watch?v=def) |
| 3 | [Handle](https://www.youtube.com/@Example) |
| 4 | [Same handle](https://www.youtube.com/@example/) |

## 🔗 About this list

1. [Excluded](https://example.org/excluded)
`;
  const result = resourceCounts(input);
  assert.equal(result.counts['Learn Spanish'], 5);
  assert.ok(result.missing.includes('Reading & stories'));
});

test('normalizes YouTube aliases without collapsing different videos or playlists', () => {
  const input = `## 🎮 Nintendo & gaming

1. [Video](https://youtu.be/abc?si=tracking)
2. [Same video](https://m.youtube.com/watch?v=abc)
3. [Another video](https://www.youtube.com/watch?v=def)
4. [Playlist one](https://youtube.com/playlist?list=one)
5. [Playlist two](https://youtube.com/playlist?list=two)
6. [Handle](https://music.youtube.com/@ExAmPle/videos)
7. [Same handle](https://www.youtube.com/@example/)
8. [Search](https://m.youtube.com/results/?search_query=games)
`;
  assert.equal(resourceCounts(input).counts['Nintendo & gaming'], 5);
});

test('does not count supporting links or practice-table cells as resources', () => {
  const entries = Array.from({ length: 29 }, (_, i) => `${i + 1}. [Resource](https://example.org/${i})`).join('\n');
  const input = `## 📘 Learn Spanish

${entries}
30. [Local primary](./local) with [external explanation](https://example.org/support).

| Español | English |
| --- | --- |
| [Practice phrase](https://example.org/phrase) | Phrase |

| # | Resource | Detail |
| --- | --- | --- |
| 1 | [Local primary](./local) | [External support](https://example.org/detail) |
`;
  assert.equal(resourceCounts(input).counts['Learn Spanish'], 29);
});

test('requires a leading primary link even when references are unresolved or names are plain text', () => {
  const entries = Array.from({ length: 29 }, (_, i) => `${i + 1}. [Resource](https://example.org/${i})`).join('\n');
  const input = `## 📘 Learn Spanish

${entries}
30. [Missing][undefined] with [support](https://example.org/support).
31. Plain resource with [support](https://example.org/other-support).

| # | Resource |
| --- | --- |
| 1 | [Missing][undefined] with [support](https://example.org/table-support) |
| 2 | Plain resource with [support](https://example.org/table-other-support) |
`;
  assert.equal(resourceCounts(input).counts['Learn Spanish'], 29);
  const formatted = `## 📘 Learn Spanish

1. **[Bold resource](https://example.org/bold)** with [support](https://example.org/support).
2. *[Italic resource](https://example.org/italic)*
`;
  assert.equal(resourceCounts(formatted).counts['Learn Spanish'], 2);
});

test('deduplicates video and channel aliases and excludes dotted-host searches', () => {
  const entries = Array.from({ length: 28 }, (_, i) => `${i + 1}. [Resource](https://example.org/${i})`).join('\n');
  const input = `## 🎮 Nintendo & gaming

${entries}
29. [Video](https://www.youtube.com/watch?v=abc)
30. [Same via shorts](https://youtube.com/shorts/abc?feature=share)
31. [Same via live](https://youtube.com/live/abc?si=abc)
32. [Same via embed](https://youtube.com/embed/abc?pp=tracking)
32. [Same via privacy-enhanced embed](https://www.youtube-nocookie.com/embed/abc)
33. [Search](https://www.youtube.com./results?search_query=games)
34. [Channel](https://www.youtube.com/channel/ABC)
35. [Same channel tab](https://youtube.com/channel/ABC/featured)
36. [Same with subscribe prompt](https://youtube.com/channel/ABC?sub_confirmation=1)
`;
  assert.equal(resourceCounts(input).counts['Nintendo & gaming'], 30);
});

test('closes at H1 boundaries and reports duplicate topic headings', () => {
  const input = `## 📘 Learn Spanish

1. [One](https://example.org/one)

# Another document

1. [Not a resource](https://example.org/not-in-topic)

## 📘 Learn Spanish

1. [Two](https://example.org/two)
`;
  const result = resourceCounts(input);
  assert.equal(result.counts['Learn Spanish'], 2);
  assert.deepEqual(result.duplicates, ['Learn Spanish']);
});

test('counts nested resource entries individually without counting a group twice', () => {
  const input = `## 📘 Learn Spanish

1. A group:
   1. [One](https://example.org/one)
   2. [Two](https://example.org/two)
2. [Three](https://example.org/three)
   - [Four](https://example.org/four)
`;
  assert.equal(resourceCounts(input).counts['Learn Spanish'], 4);
});

test('preserves non-YouTube query values and hash-based application routes', () => {
  const input = `## 📘 Learn Spanish

1. [One](https://example.org/?si=one)
2. [Two](https://example.org/?si=two)
3. [First route](https://example.org/#/books)
4. [Second route](https://example.org/#/articles)
`;
  assert.equal(resourceCounts(input).counts['Learn Spanish'], 4);
});

test('each main resource topic has at least 30 distinct direct entries', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const result = resourceCounts(readme);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.duplicates, []);
  for (const topic of TOPICS) assert.ok(result.counts[topic] >= 30, `${topic}: ${result.counts[topic]}`);
});
