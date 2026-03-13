// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SealerCommitment
 * @notice Soulbound NFT representing an onchain commitment to a verifiable goal.
 *         Minted when an agent pays and submits a commitment.
 *         Immutable after mint — the promise is permanent.
 *
 *         Agents can hold multiple commitments (different claimTypes, different windows).
 *         When verification completes, SealerCertificate is minted separately.
 *         This token stays in the wallet as the permanent "I made this promise" record.
 *
 *         claimType is stored onchain so explorers and the leaderboard can
 *         filter commitments by category without decoding tokenURI.
 */
contract SealerCommitment is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    struct CommitmentData {
        string  claimType;           // e.g. "x402_payment_reliability"
        string  attestationTx;       // EAS commitment attestation TX hash
        address originalRecipient;
        uint64  mintedAt;            // unix seconds
        uint64  deadline;            // unix seconds
    }

    mapping(uint256 => CommitmentData) public commitments;

    // Reverse lookup: EAS attestation TX → tokenId
    // Useful when attest-achievement needs to reference the commitment token
    mapping(string => uint256) public txHashToTokenId;

    event CommitmentMinted(
        uint256 indexed tokenId,
        address indexed recipient,
        string  claimType,
        string  attestationTx,
        uint64  deadline,
        string  tokenURI
    );

    constructor(address initialOwner)
        ERC721("Sealer Commitment", "COMMIT")
        Ownable(initialOwner)
    {}

    /**
     * @notice Mint a commitment NFT. Called once per commitment at payment time.
     * @param recipient     Agent wallet
     * @param uri           Permalink → /api/commitment?uid=...
     * @param claimType     Achievement category string
     * @param attestationTx EAS attestation TX hash
     * @param deadline      Unix timestamp of commitment window end
     */
    function mint(
        address recipient,
        string calldata uri,
        string calldata claimType,
        string calldata attestationTx,
        uint64 deadline
    ) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(recipient, tokenId);
        _setTokenURI(tokenId, uri);

        commitments[tokenId] = CommitmentData({
            claimType:         claimType,
            attestationTx:     attestationTx,
            originalRecipient: recipient,
            mintedAt:          uint64(block.timestamp),
            deadline:          deadline
        });

        txHashToTokenId[attestationTx] = tokenId;

        emit CommitmentMinted(tokenId, recipient, claimType, attestationTx, deadline, uri);
        return tokenId;
    }

    /**
     * @notice Get commitment data for a token.
     */
    function getCommitment(uint256 tokenId)
        external view returns (CommitmentData memory)
    {
        require(_ownerOf(tokenId) != address(0), "SealerCommitment: nonexistent token");
        return commitments[tokenId];
    }

    /**
     * @notice Look up tokenId by EAS attestation TX hash.
     */
    function getTokenIdByTx(string calldata attestationTx)
        external view returns (uint256)
    {
        return txHashToTokenId[attestationTx];
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
            revert("SealerCommitment: soulbound - non-transferable");
        }
        return super._update(to, tokenId, auth);
    }
}
