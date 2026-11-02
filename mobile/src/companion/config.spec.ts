import { normalizeApplianceUrl } from './config';

describe('normalizeApplianceUrl', () => {
  it('gives a bare host https', () => {
    expect(normalizeApplianceUrl('ci-mentra.example.ts.net')).toBe('https://ci-mentra.example.ts.net');
  });

  it('keeps only the origin of a pasted address', () => {
    expect(normalizeApplianceUrl('  https://ci.example.org/some/path?x=1#top ')).toBe('https://ci.example.org');
  });

  it('keeps the port', () => {
    expect(normalizeApplianceUrl('https://ci.example.org:8443')).toBe('https://ci.example.org:8443');
  });

  it('allows plain http only for loopback', () => {
    expect(normalizeApplianceUrl('http://localhost:8080')).toBe('http://localhost:8080');
    expect(normalizeApplianceUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(normalizeApplianceUrl('http://192.168.1.10:8080')).toBeNull();
  });

  it('refuses embedded credentials, other schemes and empty input', () => {
    expect(normalizeApplianceUrl('https://user:secret@ci.example.org')).toBeNull();
    expect(normalizeApplianceUrl('ftp://ci.example.org')).toBeNull();
    expect(normalizeApplianceUrl('   ')).toBeNull();
  });

  it('refuses text that is not an address', () => {
    expect(normalizeApplianceUrl('not an address')).toBeNull();
  });
});
