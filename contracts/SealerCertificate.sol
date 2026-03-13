// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SealerCertificate
 * @notice Soulbound NFT minted when a commitment is resolved — pass, partial, or fail.
 *         This is the primary achievement credential. Immutable after mint.
 *
 *         Every commitment resolves to exactly one certificate.
 *         The certificate tokenURI points to /api/certificate which renders
 *         the full proof document with scores, metrics, and outcome.
 *
 *         Key onchain fields (queryable without decoding tokenURI):
 *           claimType    — for leaderboard filtering by category
 *           outcome      — 0=Failed 1=Partial 2=Full
 *           difficulty   — 0–100, for ranking
 *           proofPoints  — (achievementScore × difficulty) / 100, primary ranking metric
 *           metricsMet   — e.g. 2
 *           metricsTotal — e.g. 3
 *
 *         These fields allow the leaderboard to be rebuilt entirely from
 *         contract events + EAS attestations, no Redis dependency.
 */
contract SealerCertificate is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    // Outcome enum
    enum Outcome { Failed, Partial, Full }

    struct CertificateData {
        string  claimType;           // achievement category
        string  commitmentTx;        // EAS commitment attestation TX
        string  achievementTx;       // EAS achievement attestation TX
        address originalRecipient;
        uint64  achievedAt;          // unix seconds
        uint64  deadline;            // original commitment deadline
        int16   daysEarly;           // negative = late, 0 = on deadline, positive = early
        uint8   difficulty;          // 0–100
        uint32  proofPoints;         // leaderboard ranking value
        uint8   metricsMet;          // metrics that passed
        uint8   metricsTotal;        // total metrics in commitment
        bool    onTime;
        Outcome outcome;             // Failed / Partial / Full
    }

    mapping(uint256 => CertificateData) public certificates;

    // One certificate per commitment attestation TX — enforce uniqueness
    mapping(string => bool) public commitmentTxUsed;

    // Best certificate per wallet per claimType (highest proofPoints)
    // Used by leaderboard for quick per-agent queries
    mapping(address => mapping(string => uint256)) public bestCertificate;
    mapping(address => mapping(string => bool))    public hasCertificate;

    event CertificateMinted(
        uint256 indexed tokenId,
        address indexed recipient,
        string  claimType,
        Outcome outcome,
        uint8   difficulty,
        uint32  proofPoints,
        uint8   metricsMet,
        uint8   metricsTotal,
        bool    onTime,
        string  achievementTx
    );

    constructor(address initialOwner)
        ERC721("Sealer Certificate", "CERT")
        Ownable(initialOwner)
    {}

    /**
     * @notice Mint a certificate on commitment resolution.
     *         Called by the platform after EAS achievement attestation.
     *         One certificate per commitment — enforced via commitmentTx uniqueness.
     *
     * @param recipient      Agent wallet
     * @param uri            Certificate permalink → /api/certificate?uid=...
     * @param claimType      Achievement category
     * @param outcome        0=Failed 1=Partial 2=Full
     * @param difficulty     0–100
     * @param proofPoints    Leaderboard ranking value
     * @param metricsMet     How many metrics passed
     * @param metricsTotal   Total metrics in commitment
     * @param onTime         Achieved before deadline
     * @param daysEarly      Days before deadline (negative if late)
     * @param deadline       Original commitment deadline (unix seconds)
     * @param commitmentTx   EAS commitment attestation TX (must be unique)
     * @param achievementTx  EAS achievement attestation TX
     */
    function mint(
        address recipient,
        string calldata uri,
        string calldata claimType,
        uint8  outcome,
        uint8  difficulty,
        uint32 proofPoints,
        uint8  metricsMet,
        uint8  metricsTotal,
        bool   onTime,
        int16  daysEarly,
        uint64 deadline,
        string calldata commitmentTx,
        string calldata achievementTx
    ) external onlyOwner returns (uint256) {
        require(outcome <= 2,                           "SealerCertificate: invalid outcome");
        require(metricsMet <= metricsTotal,             "SealerCertificate: metricsMet > metricsTotal");
        require(!commitmentTxUsed[commitmentTx],        "SealerCertificate: commitment already has a certificate");

        commitmentTxUsed[commitmentTx] = true;

        uint256 tokenId = _nextTokenId++;
        _safeMint(recipient, tokenId);
        _setTokenURI(tokenId, uri);

        Outcome o = Outcome(outcome);

        certificates[tokenId] = CertificateData({
            claimType:         claimType,
            commitmentTx:      commitmentTx,
            achievementTx:     achievementTx,
            originalRecipient: recipient,
            achievedAt:        uint64(block.timestamp),
            deadline:          deadline,
            daysEarly:         daysEarly,
            difficulty:        difficulty,
            proofPoints:       proofPoints,
            metricsMet:        metricsMet,
            metricsTotal:      metricsTotal,
            onTime:            onTime,
            outcome:           o
        });

        // Track best certificate per wallet per claimType
        if (!hasCertificate[recipient][claimType] ||
            proofPoints > certificates[bestCertificate[recipient][claimType]].proofPoints
        ) {
            bestCertificate[recipient][claimType] = tokenId;
            hasCertificate[recipient][claimType]  = true;
        }

        emit CertificateMinted(
            tokenId, recipient, claimType,
            o, difficulty, proofPoints,
            metricsMet, metricsTotal, onTime, achievementTx
        );

        return tokenId;
    }

    /**
     * @notice Get certificate data for a token.
     */
    function getCertificate(uint256 tokenId)
        external view returns (CertificateData memory)
    {
        require(_ownerOf(tokenId) != address(0), "SealerCertificate: nonexistent token");
        return certificates[tokenId];
    }

    /**
     * @notice Get the best certificate for a wallet + claimType.
     *         "Best" = highest proofPoints. Used by leaderboard.
     */
    function getBestCertificate(address wallet, string calldata claimType)
        external view returns (uint256 tokenId, CertificateData memory data)
    {
        require(
            hasCertificate[wallet][claimType],
            "SealerCertificate: no certificate for this wallet + claimType"
        );
        tokenId = bestCertificate[wallet][claimType];
        data    = certificates[tokenId];
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    // ── Soulbound: block all transfers after mint ──────────────────────────
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            revert("SealerCertificate: soulbound - non-transferable");
        }
        return super._update(to, tokenId, auth);
    }
}
