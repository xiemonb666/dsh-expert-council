// Entry point used when the test directory itself is passed to `node --test`
// (`node --test tests/protocols`), because Node >= 22 resolves a positional
// path as a glob/module rather than expanding a directory. Importing the test
// files registers their tests with the active test runner, so the documented
// acceptance command keeps working on Node 24.
//
// Running the files directly (`node --test "tests/protocols/*.test.js"`) skips
// this module entirely and produces the same test set.

import './base-url.test.js'
import './request-body.test.js'
import './openai-response.test.js'
import './anthropic-response.test.js'
import './errors.test.js'
import './timeouts.test.js'
import './secrets.test.js'
import './robustness.test.js'
import './registry.test.js'
