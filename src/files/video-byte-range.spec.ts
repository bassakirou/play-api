import { videoByteRange } from './video-byte-range';

describe('video byte ranges', () => {
  it.each([
    ['bytes=0-31', { start: 0, end: 31 }],
    ['bytes=90-', { start: 90, end: 99 }],
    ['bytes=-10', { start: 90, end: 99 }],
    ['bytes=90-999', { start: 90, end: 99 }],
    ['bytes=-999', { start: 0, end: 99 }],
    ['bytes=100-', 'unsatisfiable'],
    ['bytes=10-9', 'unsatisfiable'],
    ['bytes=-0', 'unsatisfiable'],
    ['bytes=0-1,3-4', undefined],
    ['bytes=-', undefined],
    ['bytes=9007199254740993-', undefined],
    ['items=0-1', undefined],
  ])('%s', (header, expected) => expect(videoByteRange(header, 100)).toEqual(expected));
  it('rejects ranges on an empty object', () => expect(videoByteRange('bytes=0-', 0)).toBe('unsatisfiable'));
});
