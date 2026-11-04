import { describe, expect, it } from 'vitest';
import { angleName, chooseNewAdapter, findMadeOn, parseAdapterLines, plainName } from './gpu.js';

// A tester's laptop (2026-11-04): DXGI lists the power-saving AMD chip first, the one his
// Firefox 158 used; Win32_VideoController listed the NVIDIA card first.
const laptop = parseAdapterLines(
  'AMD Radeon(TM) Graphics\t1681\nNVIDIA GeForce RTX 3080 Laptop GPU\t249c\nMicrosoft Basic Render Driver\t008C\n',
);

describe('graphics adapters', () => {
  it('reads DXGI lines and drops adapters that cannot render a browser', () => {
    expect(laptop).toEqual([
      { name: 'AMD Radeon(TM) Graphics', deviceId: '1681' },
      { name: 'NVIDIA GeForce RTX 3080 Laptop GPU', deviceId: '249C' },
    ]);
  });

  it('names an adapter as Firefox ANGLE does, id included', () => {
    expect(angleName({ name: 'Intel(R) HD Graphics 620', deviceId: '5916' })).toBe(
      'Intel(R) HD Graphics 620 (0x00005916)',
    );
    expect(angleName({ name: 'Some GPU', deviceId: null })).toBe('Some GPU');
    expect(plainName('AMD Radeon(TM) Graphics (0x00001681)')).toBe('AMD Radeon(TM) Graphics');
  });

  it('gives a new profile the adapter a browser gets, or the one ENCLAVE_GPU names', () => {
    expect(chooseNewAdapter(laptop)?.name).toBe('AMD Radeon(TM) Graphics');
    expect(chooseNewAdapter(laptop, 'nvidia')?.name).toBe('NVIDIA GeForce RTX 3080 Laptop GPU');
    expect(chooseNewAdapter([], undefined)).toBeNull();
  });

  it('keeps a profile on the adapter it was made on, wherever Windows lists it', () => {
    // Made on the NVIDIA card before this change (saved without its id).
    expect(findMadeOn(laptop, 'NVIDIA GeForce RTX 3080 Laptop GPU')?.deviceId).toBe('249C');
    // Made since, with the id.
    expect(findMadeOn(laptop, 'AMD Radeon(TM) Graphics (0x00001681)')?.deviceId).toBe('1681');
    // The order changed after a driver update: still found.
    expect(findMadeOn([...laptop].reverse(), 'AMD Radeon(TM) Graphics (0x00001681)')?.name).toBe(
      'AMD Radeon(TM) Graphics',
    );
    // A PC without it.
    expect(findMadeOn(laptop, 'Intel(R) HD Graphics 620')).toBeNull();
  });
});
