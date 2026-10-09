import test from 'node:test';
import assert from 'node:assert/strict';

for (const id of ['ADM-004', 'ADM-005', 'ADM-006', 'ADM-007']) {
  test(`${id} violating admin theme example`, () => {
    assert.fail('The example allows an invalid admin theme outcome.');
  });
}
