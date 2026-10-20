// Turns the Jest JSON result (jest.json) into workflow error annotations, including suite-level failures
// that the github-actions reporter does not annotate. Used by CI after a failed test run.
const fs = require('fs');

const escape = text => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
let result;
try {
    result = JSON.parse(fs.readFileSync('jest.json', 'utf8'));
} catch (error) {
    console.log(`::error title=jest.json::${escape(error.message)}`);
    process.exit(0);
}
console.log(`::error title=jest summary::${escape(JSON.stringify({
    suites: [result.numTotalTestSuites, result.numFailedTestSuites, result.numRuntimeErrorTestSuites],
    tests: [result.numTotalTests, result.numFailedTests],
    success: result.success, wasInterrupted: result.wasInterrupted,
}))}`);
for (const suite of result.testResults.filter(s => s.status !== 'passed')) {
    const failed = suite.assertionResults.filter(a => a.status === 'failed').map(a => `${a.fullName}: ${(a.failureMessages || []).join('\n').slice(0, 400)}`);
    console.log(`::error title=${escape(suite.name.slice(-70))}::${escape([suite.message.slice(0, 800), ...failed].join('\n').slice(0, 3000))}`);
}
