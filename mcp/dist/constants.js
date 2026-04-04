"use strict";
// src/constants.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.EAS_EXPLORER_URL = exports.STATUS_DESCRIPTIONS = exports.DIFFICULTY_PARAMS = exports.CHARACTER_LIMIT = exports.SEALER_BASE_URL = void 0;
exports.SEALER_BASE_URL = 'https://thesealer.xyz';
exports.CHARACTER_LIMIT = 8000;
exports.DIFFICULTY_PARAMS = {
    x402_payment_reliability: ['minSuccessRate', 'minTotalUSD', 'requireDistinctRecipients', 'maxGapHours'],
    defi_trading_performance: ['minTradeCount', 'minVolumeUSD', 'minPnlPercent'],
    code_software_delivery: ['minMergedPRs', 'minCommits', 'minLinesChanged'],
    website_app_delivery: ['minPerformanceScore', 'minAccessibility'],
    acp_job_delivery: ['minCompletedJobsDelta', 'minSuccessRate', 'minUniqueBuyersDelta'],
};
exports.STATUS_DESCRIPTIONS = {
    pending: 'Commitment is active — verification window open',
    verifying: 'Verification in progress',
    achieved: 'Commitment verified and certified — certificate issued',
    amended: 'Commitment thresholds were lowered via amendment',
    failed: 'Verification window closed without meeting targets',
    expired: 'Deadline passed with no verification attempt',
};
exports.EAS_EXPLORER_URL = 'https://base.easscan.org/attestation/view';
//# sourceMappingURL=constants.js.map