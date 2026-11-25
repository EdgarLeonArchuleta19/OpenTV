import { describe, expect, it } from 'vitest';
import { orderSearchResults } from './searchRank';

const item = (id: string, title: string, year: string, originalTitle?: string) => ({ id, title, year, originalTitle });

describe('orderSearchResults', () => {
  it('ranks by how well the title matches, newest first inside each group', () => {
    const out = orderSearchResults(
      [
        item('a', 'Flash', '1990', 'The Flash'),
        item('b', 'Ricki and the Flash', '2015'),
        item('c', 'Flash', '2014', 'The Flash'),
        item('d', 'Flash', '2023', 'The Flash'),
        item('e', 'The Flash II: Revenge of the Trickster', '1991'),
        item('f', 'The Flash III', '1992'),
      ],
      'the flash',
    );
    expect(out.map((x) => x.id)).toEqual(['d', 'c', 'a', 'f', 'e', 'b']);
  });

  it('puts titles without a year last in their group and drops duplicates', () => {
    const out = orderSearchResults([item('x', 'Dune', ''), item('y', 'Dune', '2021'), item('y', 'Dune', '2021')], 'dune');
    expect(out.map((x) => x.id)).toEqual(['y', 'x']);
  });
});
