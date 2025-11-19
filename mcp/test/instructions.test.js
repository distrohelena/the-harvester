import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_INSTRUCTIONS, buildServerInstructions } from '../src/server-instructions.js';
test('buildServerInstructions combines base and plugin instructions', () => {
    const instructions = buildServerInstructions();
    assert.ok(instructions.includes(BASE_INSTRUCTIONS), 'should include the base instructions');
    assert.ok(instructions.includes('git-search-commits'), 'should include git plugin guidance in instructions');
});
//# sourceMappingURL=instructions.test.js.map