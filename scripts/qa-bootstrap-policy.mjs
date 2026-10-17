// Read-only QA guard. Unknown/disabled states must never start the application.
export function canBootstrapForQA (wire) {
    return wire?.version === '1' && wire[0] === 49
}
