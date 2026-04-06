/**
 * TIER 1 — FEATURE 4: License Risk Flagging
 *
 * Scans AI-generated code for patterns that indicate it was derived from
 * open-source code with a specific license. GPL/AGPL = copyleft risk (high).
 * MIT/Apache = permissive (low risk). Unknown = flagged for manual review.
 */

import { LicenseRisk } from '../core/types';

interface LicensePattern {
    license: string;
    risk: 'copyleft' | 'permissive' | 'unknown';
    patterns: RegExp[];
}

const LICENSE_PATTERNS: LicensePattern[] = [
    {
        license: 'GPL-3.0',
        risk: 'copyleft',
        patterns: [
            /GNU General Public License/i,
            /version 3(,|\s).*GPL/i,
            /gpl[-_ ]?v?3/i,
            /copyleft/i,
        ],
    },
    {
        license: 'GPL-2.0',
        risk: 'copyleft',
        patterns: [
            /GNU General Public License.*version 2/i,
            /gpl[-_ ]?v?2/i,
        ],
    },
    {
        license: 'AGPL-3.0',
        risk: 'copyleft',
        patterns: [
            /GNU Affero General Public License/i,
            /agpl/i,
        ],
    },
    {
        license: 'LGPL',
        risk: 'copyleft',
        patterns: [
            /GNU Lesser General Public License/i,
            /lgpl/i,
        ],
    },
    {
        license: 'MIT',
        risk: 'permissive',
        patterns: [
            /Permission is hereby granted, free of charge/i,
            /MIT License/i,
        ],
    },
    {
        license: 'Apache-2.0',
        risk: 'permissive',
        patterns: [
            /Apache License.*2\.0/i,
            /Licensed under the Apache License/i,
        ],
    },
    {
        license: 'BSD',
        risk: 'permissive',
        patterns: [
            /BSD(?:\s\d+)? License/i,
            /Redistribution and use in source and binary forms/i,
        ],
    },
];

// Structural patterns that suggest code was copied from a library
const STRUCTURAL_FLAGS: { pattern: RegExp; detail: string }[] = [
    { pattern: /^\/\*[\s\S]{0,200}Copyright.*\d{4}/m,      detail: 'Copyright header detected' },
    { pattern: /^\/\*[\s\S]{0,200}All rights reserved/im,  detail: '"All rights reserved" header' },
    { pattern: /SPDX-License-Identifier:\s*([\w\-.+]+)/,   detail: 'SPDX license identifier found' },
    { pattern: /This (file|code|software) is (released|licensed|distributed) under/i, detail: 'License declaration found' },
];

export function detectLicenseRisk(code: string): LicenseRisk {
    // Check explicit license text
    for (const lp of LICENSE_PATTERNS) {
        for (const regex of lp.patterns) {
            if (regex.test(code)) {
                return {
                    detected: true,
                    license: lp.license,
                    confidence: 'high',
                    risk: lp.risk,
                    detail: `Detected ${lp.license} license text in AI-generated code`,
                };
            }
        }
    }

    // Check structural signals
    for (const sf of STRUCTURAL_FLAGS) {
        const match = code.match(sf.pattern);
        if (match) {
            const spdx = code.match(/SPDX-License-Identifier:\s*([\w\-.+]+)/)?.[1];
            return {
                detected: true,
                license: spdx || 'UNKNOWN',
                confidence: 'medium',
                risk: 'unknown',
                detail: sf.detail + (spdx ? ` (${spdx})` : ''),
            };
        }
    }

    return { detected: false, confidence: 'low', risk: 'unknown' };
}
