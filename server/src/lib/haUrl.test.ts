import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHaUrl, parseAllowedHosts } from './haUrl.ts';

const list = (s: string) => parseAllowedHosts(s);
const code = (url: string, l: string) => {
  try {
    checkHaUrl(url, list(l));
    return 'ok';
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERR';
  }
};

test('liste bos: http/https gecer', () => {
  assert.equal(code('http://192.168.1.10:8123', ''), 'ok');
  assert.equal(code('https://ha.example.com', ' , '), 'ok');
});

test('u:p@ ve ftp her durumda reddedilir', () => {
  assert.equal(code('https://u:p@host', ''), 'BAD_REQUEST');
  assert.equal(code('https://u@host', 'host'), 'BAD_REQUEST');
  assert.equal(code('ftp://host', ''), 'BAD_REQUEST');
  assert.equal(code('ftp://host', 'host'), 'BAD_REQUEST');
  assert.equal(code('bozuk', ''), 'BAD_REQUEST');
});

test('host eslesmesi: buyuk/kucuk harf, port', () => {
  assert.equal(code('http://HomeAssistant.LOCAL:8123', ' HomeAssistant.local '), 'ok');
  assert.equal(code('http://ha.local:9999', 'ha.local'), 'ok');
  assert.equal(code('http://ha.local:8123', 'ha.local:8123'), 'ok');
  assert.equal(code('http://ha.local:9999', 'ha.local:8123'), 'HA_HOST_NOT_ALLOWED');
  assert.equal(code('http://ha.local', 'ha.local:80'), 'ok');
  assert.equal(code('https://ha.local', 'ha.local:443'), 'ok');
  assert.equal(code('http://evil.local', 'ha.local'), 'HA_HOST_NOT_ALLOWED');
  assert.equal(code('http://ha.local.evil.com', 'ha.local'), 'HA_HOST_NOT_ALLOWED');
});

test('joker yalniz alt alan adlari', () => {
  assert.equal(code('http://a.example.com', '*.example.com'), 'ok');
  assert.equal(code('http://a.b.example.com', '*.example.com'), 'ok');
  assert.equal(code('http://example.com', '*.example.com'), 'HA_HOST_NOT_ALLOWED');
  assert.equal(code('http://badexample.com', '*.example.com'), 'HA_HOST_NOT_ALLOWED');
  assert.equal(code('http://example.com', '*.example.com,example.com'), 'ok');
  assert.equal(code('http://a.example.com:1', '*.example.com:2'), 'HA_HOST_NOT_ALLOWED');
});

test('IPv6 ve IDN', () => {
  assert.equal(code('http://[::1]:8123', '[::1]:8123'), 'ok');
  assert.equal(code('http://[::1]:1', '[::1]:8123'), 'HA_HOST_NOT_ALLOWED');
  assert.equal(code('http://[::1]:1', '[::1]'), 'ok');
  assert.equal(code('http://[0:0:0:0:0:0:0:1]', '[::1]'), 'ok');
  assert.equal(code('http://münih.example', 'MÜNIH.example'), 'ok');
  assert.equal(code('http://xn--mnih-0ra.example', 'münih.example'), 'ok');
});

test('gecersiz liste girdileri hata verir', () => {
  for (const bad of [
    'http://a.com',
    'a.com/yol',
    'a b.com',
    'a.*.com',
    'foo*',
    '*',
    'a.com:99999',
    'a.com:abc',
    'u@a.com',
    '[::1',
  ]) {
    assert.throws(() => parseAllowedHosts(bad), Error, bad);
  }
  assert.equal(parseAllowedHosts('a.com, b.com:1,').length, 2);
  assert.equal(parseAllowedHosts(undefined).length, 0);
});
